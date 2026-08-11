"use client";

// SC-92 アカウント & 所属（この会社）。system_admin 経路（クロステナント）。
// 一覧＋発行（memberships 所属エディタ込み）＋disable/enable/PW再設定。編集(PATCH)は後続（92B-2）。
import { useCallback, useEffect, useState } from "react";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import {
  disableAccount,
  editAccount,
  enableAccount,
  issueAccount,
  listAccounts,
  listQuestGroups,
  resetPassword,
} from "../api";
import type { Account, AccountCreateInput, Membership, QuestGroup } from "../types";
import { MembershipsEditor } from "./MembershipsEditor";
import "@/features/companies/companies.css";

const ROLE_LABEL: Record<string, string> = {
  general: "一般",
  company_account_admin: "会社アカウント管理者",
  system_admin: "システム管理者",
};

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

export function AccountSection({ companyId }: { companyId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"issue" | "edit">("issue");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [email, setEmail] = useState("");
  const [systemRole, setSystemRole] = useState<AccountCreateInput["system_role"]>("general");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [replaceMemberships, setReplaceMemberships] = useState(false); // 編集時に所属を置き換えるか（B.3 一括設定）
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function openIssue() {
    setMode("issue");
    setEditingId(null);
    setDisplayName("");
    setLoginId("");
    setEmail("");
    setSystemRole("general");
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
    setSystemRole(a.system_role as AccountCreateInput["system_role"]);
    setMemberships([]); // 現在の所属は一覧に無い＝置き換え時のみ明示指定
    setReplaceMemberships(false);
    setFormError(null);
    setShowForm(true);
  }

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const [accRes, grpRes] = await Promise.all([listAccounts(companyId), listQuestGroups(companyId)]);
      setAccounts(accRes?.data ?? []);
      setGroups(grpRes?.data ?? []);
    } catch (err) {
      setLoadError(err instanceof ApiError && err.code === "forbidden"
        ? "アカウントを表示する権限がありません。"
        : "アカウント一覧の取得に失敗しました。");
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    try {
      if (mode === "issue") {
        await issueAccount(companyId, { display_name: displayName, login_id: loginId, email, system_role: systemRole, memberships });
      } else if (editingId) {
        // identity は差分。memberships は「置き換える」時のみ送る（未送信＝現状維持・B.3）
        await editAccount(companyId, editingId, {
          display_name: displayName,
          login_id: loginId,
          email,
          system_role: systemRole,
          ...(replaceMemberships ? { memberships } : {}),
        });
      }
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(issueErrorMessage(err));
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
        err instanceof ApiError && err.code === "last_system_admin"
          ? "最後のシステム管理者は無効化できません。"
          : "操作に失敗しました。",
      );
    }
  }

  return (
    <div className="card admin-create">
      <div className="admin-toolbar">
        <h2>アカウント &amp; 所属（この会社）</h2>
        <Button type="button" variant="primary" onClick={() => (showForm ? setShowForm(false) : openIssue())}>
          {showForm ? "閉じる" : "＋ アカウント発行"}
        </Button>
      </div>

      {showForm && (
        <form className="admin-create" onSubmit={onSubmit} noValidate>
          <h3>{mode === "issue" ? "アカウントを発行" : "アカウントを編集"}</h3>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <Field id="a_name" label="氏名" required>
            <input id="a_name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </Field>
          <Field id="a_login" label="ログインID" required>
            <input id="a_login" className="input" value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
          </Field>
          <Field id="a_email" label="メールアドレス" required>
            <input id="a_email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field id="a_role" label="システムロール">
            <select id="a_role" className="input" value={systemRole} onChange={(e) => setSystemRole(e.target.value as AccountCreateInput["system_role"])}>
              <option value="general">一般</option>
              <option value="company_account_admin">会社アカウント管理者</option>
              <option value="system_admin">システム管理者</option>
            </select>
          </Field>
          {mode === "edit" && (
            <label>
              <input type="checkbox" checked={replaceMemberships} onChange={(e) => setReplaceMemberships(e.target.checked)} />{" "}
              所属クエストグループを置き換える（チェック時のみ・指定した内容で全置換）
            </label>
          )}
          {(mode === "issue" || replaceMemberships) && (
            <Field id="a_groups" label="所属クエストグループ">
              <MembershipsEditor value={memberships} groups={groups} onChange={setMemberships} />
            </Field>
          )}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "保存中…" : mode === "issue" ? "発行する（初回PW設定リンク送信）" : "保存する"}
          </Button>
        </form>
      )}

      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">氏名</th>
            <th scope="col">ログインID</th>
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
              <td>{ROLE_LABEL[a.system_role] ?? a.system_role}</td>
              <td>{a.status === "active" ? "有効" : "無効"}</td>
              <td>
                {a.status === "active" ? (
                  <>
                    <button type="button" onClick={() => openEdit(a)}>編集</button>{" "}
                    <button type="button" onClick={() => runAction(() => resetPassword(companyId, a.account_id), undefined, "パスワード再設定リンクを送信しました。")}>PW再設定</button>{" "}
                    <button type="button" className="is-danger" onClick={() => runAction(() => disableAccount(companyId, a.account_id), `「${a.display_name}」を無効化しますか？`)}>無効化</button>
                  </>
                ) : (
                  <button type="button" onClick={() => runAction(() => enableAccount(companyId, a.account_id))}>再有効化</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {accounts.length === 0 && !loadError && <p className="admin-muted">アカウントがありません。</p>}
    </div>
  );
}
