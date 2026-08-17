"use client";

// SC-93 会社アカウント管理者＝自社（セッション会社固定）のアカウント管理（B.2.1）。
// 一覧（検索/状態フィルタ/ページング）＋発行/編集（identity＋所属 memberships・system_role は付与不可＝general 固定）＋disable/enable/PW再設定。
// 所属の候補は自社グループ一覧（GET /admin/company-quest-groups・B.2.1）。編集時は「置き換える」オプトインで全置換（誤消去防止）。
import { useEffect, useState } from "react";

import { Button, Field, Modal, ModalBody, ModalFooter, Pager, RowMenu } from "@/components/ui";
import type { RowMenuItem } from "@/components/ui";
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

export function AccountSelfSection({ companyCode }: { companyCode: string }) {
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
        <h1>会社アカウント管理</h1>
        <Button type="button" variant="primary" onClick={openIssue}>
          ＋ アカウント発行
        </Button>
      </div>
      <p className="admin-sub">
        自社のアカウントの<strong>発行・編集・無効化・パスワード再設定</strong>＋<strong>クエストグループ管理者（QG管理者）の任命</strong>ができます。（会社設定・システムロール付与は<strong>システム管理者</strong>の領分）
      </p>
      <div className="company-ctx">
        <span className="company-ctx__name">{companyCode}</span>
        <span className="company-ctx__note">自社のアカウントを管理しています（会社の切替はできません）。</span>
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={mode === "issue" ? "アカウントを発行" : "アカウントを編集"}
        size="md"
      >
        <form onSubmit={onSubmit} noValidate>
          <ModalBody>
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
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "保存中…" : mode === "issue" ? "発行する（初回PW設定リンク送信）" : "保存する"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <div className="list-toolbar">
        <AccountsToolbar q={q} status={status} onApply={apply} />
        <div className="tools"><span className="list-count">{total} 件</span></div>
      </div>

      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">氏名</th>
              <th scope="col">ログインID</th>
              <th scope="col">メールアドレス</th>
              <th scope="col">システムロール</th>
              <th scope="col">所属クエストグループ</th>
              <th scope="col">状態</th>
              <th scope="col" className="col-actions" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const isSysAdmin = a.system_role === "system_admin";
              const menu: RowMenuItem[] =
                a.status === "active"
                  ? [
                      { label: "編集", onClick: () => openEdit(a) },
                      {
                        label: "パスワード再設定",
                        onClick: () => runAction(() => resetOwnPassword(a.account_id), undefined, "パスワード再設定リンクを送信しました。"),
                      },
                      {
                        label: "無効化",
                        danger: true,
                        onClick: () => runAction(() => disableOwnAccount(a.account_id), `「${a.display_name}」を無効化しますか？`),
                      },
                    ]
                  : [{ label: "再有効化", onClick: () => runAction(() => enableOwnAccount(a.account_id)) }];
              return (
                <tr key={a.account_id} className={a.status !== "active" ? "is-suspended" : undefined}>
                  <td>{a.display_name}</td>
                  <td className="admin-code">{a.login_id}</td>
                  <td className="admin-code">{a.email}</td>
                  <td>{ROLE_LABEL[a.system_role] ?? a.system_role}</td>
                  {/* 所属クエストグループは AccountListItem 未提供（backend 一覧EPに memberships 追加が必要）＝暫定「—」 */}
                  <td className="muted">—</td>
                  <td>
                    {a.status === "active" ? (
                      <span className="badge badge-success">有効</span>
                    ) : (
                      <span className="badge badge-danger">無効</span>
                    )}
                  </td>
                  <td className="col-actions">
                    {isSysAdmin ? (
                      <span className="row-locked">システム管理者は会社詳細で管理</span>
                    ) : (
                      <RowMenu items={menu} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {accounts.length === 0 && !loadError && <p className="list-empty">該当するアカウントがありません。</p>}
      <Pager page={page} perPage={perPage} total={total} onPageChange={setPage} />
    </section>
  );
}
