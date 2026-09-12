"use client";

// SC-92/SC-93 アカウント発行/編集フォーム（B.2/B.2.1/B.3）。URL 付きモーダル（intercept）とフルページ（直アクセス）で共有。
// scope=company（SC-92・system_admin クロステナント／system_role 指定可）と scope=own（SC-93・自社固定／general 固定）を
// 内部で出し分け（DRY §2.3）。業務層クリーン＝表示/UX のみ、判定はサーバー（409/422/403 を文言化）。
// レイアウト/コピー/フィールド id の正＝mocks/SC-92・SC-93（DoD＝モック一致・field id は #a_*／#s_* を保持）。
// 成功時は onDone() を呼ぶ（呼び出し側が「モーダルを閉じて一覧更新」or「一覧へ遷移」を担う）。
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button, Field, FormFooterError, ModalBody, ModalFooter, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { readDuplicatePrefill } from "@/lib/forms/duplicate";
import {
  editAccount,
  editOwnAccount,
  findAccountById,
  findOwnAccountById,
  issueAccount,
  issueOwnAccount,
  listOwnCompanyQuestGroups,
  listQuestGroups,
} from "../api";
import type { AccountCreateInput, Membership, QuestGroup } from "../types";
import { MembershipsEditor } from "./MembershipsEditor";
import "@/features/companies/companies.css";

type SystemRole = AccountCreateInput["system_role"];

function issueErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "conflict") {
      const field = (err.body as { errors?: { field?: string }[] } | null)?.errors?.[0]?.field;
      if (field === "login_id") return "このログインID は既に使われています。";
      if (field === "email") return "このメールアドレスは既に使われています。";
      return "指定された値は既に使われています。";
    }
    if (err.code === "validation_error") return "入力内容をご確認ください。";
    if (err.code === "forbidden") return "この操作を行う権限がありません。";
  }
  return "エラーが発生しました。時間をおいて再度お試しください。";
}

type Props = {
  mode: "issue" | "edit";
  scope: "company" | "own";
  companyId?: string; // scope==="company" で必須（クロステナント経路）
  accountId?: string; // mode==="edit" で必須
  onDone: () => void;
  onCancel: () => void;
};

export function AccountFormPanel({ mode, scope, companyId, accountId, onDone, onCancel }: Props) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const isCompany = scope === "company";
  const idPrefix = isCompany ? "a" : "s"; // field id 接頭辞（SC-92=a／SC-93=s・e2e/mock 保持）
  const showRole = isCompany; // system_role は SC-92 のみ（SC-93 は general 固定・付与不可 B.2.1）

  // 複製（発行モードのみ）＝入力項目を全部引き継ぐ（デザイン標準 §4.5 複製・2026-09-06 改定）＝
  // 一意キー（ログインID/メール）も所属クエストグループ（memberships）もプリフィルする（空にしても保存時に一意検証で弾かれるだけのため）。
  const searchParams = useSearchParams();
  const dup = useMemo(
    () =>
      mode === "issue"
        ? readDuplicatePrefill<{
            display_name?: string;
            login_id?: string;
            email?: string;
            system_role?: SystemRole;
            memberships?: Membership[];
          }>(searchParams)
        : null,
    [mode, searchParams],
  );

  const [displayName, setDisplayName] = useState(dup?.display_name ?? "");
  const [loginId, setLoginId] = useState(dup?.login_id ?? "");
  const [email, setEmail] = useState(dup?.email ?? "");
  const [systemRole, setSystemRole] = useState<SystemRole>(dup?.system_role ?? "general");
  const [memberships, setMemberships] = useState<Membership[]>(dup?.memberships ?? []);
  const [currentMemberships, setCurrentMemberships] = useState<Membership[]>([]); // 編集＝現在の所属（読み取り専用表示・B.3）
  const [replaceMemberships, setReplaceMemberships] = useState(false); // 編集時に所属を置き換えるか（B.3 一括設定）
  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ display_name?: string; login_id?: string; email?: string }>({});
  const [pending, setPending] = useState(false);
  // 編集はプリフィルが要る＝取得完了まで loading。発行は即フォーム表示（所属候補は非同期で埋まる）。
  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);

  // 所属エディタの候補（この会社／自社のグループ）。一覧の検索/ページングに依存しない＝マウント時に一度だけ取得。
  useEffect(() => {
    const load = isCompany ? listQuestGroups(companyId!) : listOwnCompanyQuestGroups();
    void load
      .then((res) => setGroups(res?.data ?? []))
      .catch(() => {}); // 候補取得失敗はフォーム表示を妨げない
  }, [isCompany, companyId]);

  // 編集＝既存アカウントを id で解決してプリフィル（単一取得 EP が無いため一覧をループ・api 側 helper）。
  useEffect(() => {
    if (mode !== "edit" || !accountId) return;
    let alive = true;
    const find = isCompany ? findAccountById(companyId!, accountId) : findOwnAccountById(accountId);
    void find
      .then((a) => {
        if (!alive) return;
        if (!a) {
          setNotFound(true);
        } else {
          setDisplayName(a.display_name);
          setLoginId(a.login_id);
          setEmail(a.email);
          setSystemRole(a.system_role as SystemRole);
          // 現在の所属を読み取り専用表示に使う（B.2 一覧応答＝group_id/role/name。role を local 型へ絞る）。
          setCurrentMemberships((a.memberships ?? []).map((m) => ({ group_id: m.group_id, role: m.role === "admin" ? "admin" : "member" })));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mode, scope, companyId, accountId, isCompany]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    // クライアント必須検証（§4.7＝インライン枠＋上部サマリ＋フッター＋スナックバー・空送信で無反応にしない）。
    const fe: { display_name?: string; login_id?: string; email?: string } = {};
    if (!displayName.trim()) fe.display_name = "氏名を入力してください。";
    if (!loginId.trim()) fe.login_id = "ログインIDを入力してください。";
    if (!email.trim()) fe.email = "メールアドレスを入力してください。";
    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) {
      setFormError("入力内容をご確認ください。");
      notify(Object.values(fe));
      return;
    }
    setPending(true);
    try {
      if (mode === "issue") {
        if (isCompany) {
          await issueAccount(companyId!, { display_name: displayName, login_id: loginId, email, system_role: systemRole, memberships });
        } else {
          await issueOwnAccount({ display_name: displayName, login_id: loginId, email, memberships });
        }
      } else if (accountId) {
        // identity は差分。memberships は「置き換える」時のみ送る（未送信＝現状維持・B.3）。
        if (isCompany) {
          await editAccount(companyId!, accountId, {
            display_name: displayName,
            login_id: loginId,
            email,
            system_role: systemRole,
            ...(replaceMemberships ? { memberships } : {}),
          });
        } else {
          await editOwnAccount(accountId, {
            display_name: displayName,
            login_id: loginId,
            email,
            ...(replaceMemberships ? { memberships } : {}),
          });
        }
      }
      snack(
        mode === "issue"
          ? { type: "success", title: "アカウントを発行しました", msg: "初回パスワード設定リンクを送信しました。" }
          : { type: "success", title: "アカウントを更新しました" },
      );
      onDone();
    } catch (err) {
      const m = issueErrorMessage(err);
      setFormError(m);
      // 409 conflict は該当フィールド（ログインID/メール）を赤く（§4b インライン）。
      const field =
        err instanceof ApiError && err.code === "conflict"
          ? (err.body as { errors?: { field?: string }[] } | null)?.errors?.[0]?.field
          : undefined;
      if (field === "login_id") setFieldErrors({ login_id: "このログインID は既に使われています。" });
      else if (field === "email") setFieldErrors({ email: "このメールアドレスは既に使われています。" });
      notify([m]); // スクロール＋エラースナックバー（§4.7）
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <ModalBody>
        <p className="admin-muted">読み込み中…</p>
      </ModalBody>
    );
  }
  if (notFound) {
    return (
      <>
        <ModalBody>
          <div className="form-error" role="alert">対象のアカウントが見つかりませんでした。</div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            閉じる
          </Button>
        </ModalFooter>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody>
        {formError && <div className="form-error" role="alert" ref={summaryRef} tabIndex={-1}>{formError}</div>}
        <Field id={`${idPrefix}_name`} label="氏名" required error={fieldErrors.display_name}>
          <input id={`${idPrefix}_name`} className="input" value={displayName} onChange={(e) => { setDisplayName(e.target.value); if (fieldErrors.display_name) setFieldErrors((p) => ({ ...p, display_name: undefined })); }} required />
        </Field>
        <Field id={`${idPrefix}_login`} label="ログインID" required error={fieldErrors.login_id}>
          <input id={`${idPrefix}_login`} className="input" value={loginId} onChange={(e) => { setLoginId(e.target.value); if (fieldErrors.login_id) setFieldErrors((p) => ({ ...p, login_id: undefined })); }} required />
        </Field>
        <Field id={`${idPrefix}_email`} label="メールアドレス" required error={fieldErrors.email}>
          <input id={`${idPrefix}_email`} className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined })); }} required />
        </Field>
        {showRole && (
          <Field id={`${idPrefix}_role`} label="システムロール">
            <select id={`${idPrefix}_role`} className="select" value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
              <option value="general">一般</option>
              <option value="company_account_admin">会社アカウント管理者</option>
              <option value="system_admin">システム管理者</option>
            </select>
          </Field>
        )}
        {mode === "edit" && (
          <Field id={`${idPrefix}_current_groups`} label="現在の所属クエストグループ">
            {/* 現在の所属を編集不可で常時表示（置き換えチェックの前後を問わず・置き換え時は下の全置換エディタと並ぶ参照用）。 */}
            <MembershipsEditor value={currentMemberships} groups={groups} onChange={() => {}} readOnly />
          </Field>
        )}
        {mode === "edit" && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={replaceMemberships}
              onChange={(e) => {
                const on = e.target.checked;
                setReplaceMemberships(on);
                // 置き換えON＝現在の所属を初期セット（1グループ追加したいだけでも全部選び直す不便を解消）／OFF＝破棄。
                setMemberships(on ? currentMemberships : []);
              }}
            />
            所属クエストグループを置き換える（チェック時のみ・現在の所属を初期表示・指定した内容で全置換）
          </label>
        )}
        {(mode === "issue" || replaceMemberships) && (
          <Field id={`${idPrefix}_groups`} label="所属クエストグループ">
            <MembershipsEditor value={memberships} groups={groups} onChange={setMemberships} />
          </Field>
        )}
      </ModalBody>
      <ModalFooter>
        <FormFooterError show={Boolean(formError)} />
        <Button type="button" variant="outline" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {pending ? "保存中…" : mode === "issue" ? "発行する（初回PW設定リンク送信）" : "保存する"}
        </Button>
      </ModalFooter>
    </form>
  );
}
