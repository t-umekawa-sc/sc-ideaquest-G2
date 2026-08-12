"use client";

// SC-93 会社アカウント管理者＝自社（セッション会社固定）のアカウント管理（B.2.1）。
// 一覧（検索/状態フィルタ/ページング）＋発行/編集（identity＋所属 memberships・system_role は付与不可＝general 固定）＋disable/enable/PW再設定。
// 所属の候補は自社グループ一覧（GET /admin/company-quest-groups・B.2.1）。編集時は「置き換える」オプトインで全置換（誤消去防止）。
import { useEffect, useState } from "react";

import { Button, Field, Pager } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import {
  disableOwnAccount,
  editOwnAccount,
  enableOwnAccount,
  issueOwnAccount,
  listOwnAccounts,
  listOwnCompanyQuestGroups,
  resetOwnPassword,
} from "../api";
import type { Account, Membership, QuestGroup } from "../types";
import { useAccountList } from "../useAccountList";
import { AccountsToolbar } from "./AccountsToolbar";
import { MembershipsEditor } from "./MembershipsEditor";
import "@/features/companies/companies.css";

const ROLE_LABEL: Record<string, string> = {
  general: "一般",
  company_account_admin: "会社アカウント管理者",
  system_admin: "システム管理者",
};

function formErrorMessage(err: unknown): string {
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

export function AccountSelfSection() {
  const { accounts, total, page, perPage, q, status, loadError, setPage, apply, reload } =
    useAccountList(listOwnAccounts);
  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"issue" | "edit">("issue");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [replaceMemberships, setReplaceMemberships] = useState(false); // 編集時に所属を置き換えるか（B.3 一括設定）
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 所属エディタの候補（自社グループ）は一覧の検索/ページングに依存しない＝マウント時に一度だけ取得。
  useEffect(() => {
    void listOwnCompanyQuestGroups()
      .then((res) => setGroups(res?.data ?? []))
      .catch(() => {}); // 候補取得失敗は一覧表示を妨げない（発行フォームでのみ使用）
  }, []);

  function openIssue() {
    setMode("issue");
    setEditingId(null);
    setDisplayName("");
    setLoginId("");
    setEmail("");
    setMemberships([]);
    setReplaceMemberships(false);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(a: Account) {
    setMode("edit");
    setEditingId(a.account_id);
    setDisplayName(a.display_name);
    setLoginId(a.login_id);
    setEmail(a.email);
    setMemberships([]); // 現在の所属は一覧に無い＝置き換え時のみ明示指定
    setReplaceMemberships(false);
    setFormError(null);
    setShowForm(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    try {
      if (mode === "issue") {
        await issueOwnAccount({ display_name: displayName, login_id: loginId, email, memberships });
      } else if (editingId) {
        await editOwnAccount(editingId, {
          display_name: displayName,
          login_id: loginId,
          email,
          ...(replaceMemberships ? { memberships } : {}),
        });
      }
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(formErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function runAction(fn: () => Promise<unknown>, confirmMsg?: string, sentMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setActionError(null);
    try {
      await fn();
      if (sentMsg) window.alert(sentMsg);
      await reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.code === "forbidden"
          ? "この操作を行う権限がありません（システム管理者は無効化できません）。"
          : "操作に失敗しました。",
      );
    }
  }

  return (
    <section aria-label="自社アカウント管理">
      <div className="admin-toolbar">
        <h1>アカウント管理（自社）</h1>
        <Button type="button" variant="primary" onClick={() => (showForm ? setShowForm(false) : openIssue())}>
          {showForm ? "閉じる" : "＋ アカウント発行"}
        </Button>
      </div>
      <p className="admin-muted">自社のアカウントを管理します（発行・編集・無効化・PW再設定）。システムロールの付与はできません。</p>

      {showForm && (
        <form className="admin-create card" onSubmit={onSubmit} noValidate>
          <h3>{mode === "issue" ? "アカウントを発行" : "アカウントを編集"}</h3>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <Field id="s_name" label="氏名" required>
            <input id="s_name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </Field>
          <Field id="s_login" label="ログインID" required>
            <input id="s_login" className="input" value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
          </Field>
          <Field id="s_email" label="メールアドレス" required>
            <input id="s_email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {mode === "edit" && (
            <label>
              <input type="checkbox" checked={replaceMemberships} onChange={(e) => setReplaceMemberships(e.target.checked)} />{" "}
              所属クエストグループを置き換える（チェック時のみ・指定した内容で全置換）
            </label>
          )}
          {(mode === "issue" || replaceMemberships) && (
            <Field id="s_groups" label="所属クエストグループ">
              <MembershipsEditor value={memberships} groups={groups} onChange={setMemberships} />
            </Field>
          )}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "保存中…" : mode === "issue" ? "発行する（初回PW設定リンク送信）" : "保存する"}
          </Button>
        </form>
      )}

      <AccountsToolbar q={q} status={status} onApply={apply} />

      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">氏名</th>
            <th scope="col">ログインID</th>
            <th scope="col">メールアドレス</th>
            <th scope="col">システムロール</th>
            <th scope="col">状態</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.account_id}>
              <td>{a.display_name}</td>
              <td className="admin-code">{a.login_id}</td>
              <td className="admin-code">{a.email}</td>
              <td>{ROLE_LABEL[a.system_role] ?? a.system_role}</td>
              <td>{a.status === "active" ? "有効" : "無効"}</td>
              <td>
                {a.status === "active" ? (
                  <>
                    <button type="button" onClick={() => openEdit(a)}>編集</button>{" "}
                    <button type="button" onClick={() => runAction(() => resetOwnPassword(a.account_id), undefined, "パスワード再設定リンクを送信しました。")}>PW再設定</button>{" "}
                    <button type="button" className="is-danger" onClick={() => runAction(() => disableOwnAccount(a.account_id), `「${a.display_name}」を無効化しますか？`)}>無効化</button>
                  </>
                ) : (
                  <button type="button" onClick={() => runAction(() => enableOwnAccount(a.account_id))}>再有効化</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {accounts.length === 0 && !loadError && <p className="admin-muted">アカウントがありません。</p>}
      <Pager page={page} perPage={perPage} total={total} onPageChange={setPage} />
    </section>
  );
}
