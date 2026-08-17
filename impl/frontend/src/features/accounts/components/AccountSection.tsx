"use client";

// SC-92 アカウント & 所属（この会社）。system_admin 経路（クロステナント）。
// 一覧（DataTable client モード）＋発行（memberships 所属エディタ込み）＋編集(PATCH)＋disable/enable/PW再設定。
// レイアウト/クラスの正＝doc/画面設計/mocks/SC-92_会社詳細.html（DoD＝モック一致）。
//
// 一覧の操作標準は DataTable に委譲＝検索/絞込/複数ソート/列設定/CSV/ピン/カード切替（§4.5）。
// データ供給は (a) 全件クライアント処理（useAllAccounts）＝管理系は小規模。
// 操作可否のセマンティクスは既存 impl を保持（active＝所属・編集/PW再設定/無効化・disabled＝再有効化）＝
// DataTable 化は UI 枠の移植であり backend 操作可否は変えない（無効行はクリック割当なし＝§4.5⑪）。
import { useCallback, useEffect, useState } from "react";

import { Avatar, Button, DataTable, Field, Modal, ModalBody, ModalFooter, RowMenu } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
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
import { useAllAccounts } from "../useAllAccounts";
import { MembershipsEditor } from "./MembershipsEditor";
import "@/features/companies/companies.css";

const ROLE_LABEL: Record<string, string> = {
  general: "一般",
  company_account_admin: "会社アカウント管理者",
  system_admin: "システム管理者",
};

// 状態バッジ（アカウント状態＝2値。有効/無効＝論理削除）。
function statusBadge(status: string) {
  return status === "active" ? (
    <span className="badge st-active">有効</span>
  ) : (
    <span className="badge st-suspended">無効</span>
  );
}

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
  // fetcher は companyId に閉じたクロステナント経路（/admin/companies/{id}/accounts）。全件取得は useAllAccounts。
  const fetcher = useCallback(
    (params: { page: number; per_page: number }) => listAccounts(companyId, params),
    [companyId],
  );
  const { accounts, loading, loadError, reload } = useAllAccounts(fetcher);
  const [groups, setGroups] = useState<QuestGroup[]>([]);
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

  // 所属エディタの候補（この会社のグループ）は一覧の検索/ページングに依存しない＝会社が変わった時のみ取得。
  useEffect(() => {
    void listQuestGroups(companyId)
      .then((res) => setGroups(res?.data ?? []))
      .catch(() => {}); // 候補取得失敗は一覧表示を妨げない（発行フォームでのみ使用）
  }, [companyId]);

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

  // 行アクション（RowMenu ⋯）。操作可否は既存 impl を保持＝active/disabled で内容が変わる。
  function accountMenuItems(a: Account): RowMenuItem[] {
    if (a.status === "active") {
      return [
        { label: "所属・編集", onClick: () => openEdit(a) },
        {
          label: "パスワード再設定",
          onClick: () => runAction(() => resetPassword(companyId, a.account_id), undefined, "パスワード再設定リンクを送信しました。"),
        },
        {
          label: "無効化",
          danger: true,
          onClick: () => runAction(() => disableAccount(companyId, a.account_id), `「${a.display_name}」を無効化しますか？`),
        },
      ];
    }
    return [{ label: "再有効化", onClick: () => runAction(() => enableAccount(companyId, a.account_id)) }];
  }

  // 列定義（正＝mocks/SC-92 の DataTable columns）。render は ReactNode。
  // 所属クエストグループは AccountListItem 未提供（B.2 一覧項目に無い）＝「—」プレースホルダ。
  const columns: DataTableColumn<Account>[] = [
    {
      key: "name",
      label: "氏名",
      locked: true,
      width: 200,
      sortable: true,
      filter: { type: "text" },
      sortVal: (a) => a.display_name,
      searchVal: (a) => a.display_name,
      csvVal: (a) => a.display_name,
      render: (a) => (
        <span className="co">
          <Avatar name={a.display_name} size="sm" />
          <strong>{a.display_name}</strong>
        </span>
      ),
    },
    {
      key: "login_id",
      label: "ログインID",
      width: 160,
      cellClass: "db-id",
      sortable: true,
      filter: { type: "text" },
      sortVal: (a) => a.login_id,
      searchVal: (a) => a.login_id,
      render: (a) => a.login_id,
    },
    {
      key: "email",
      label: "メールアドレス",
      width: 200,
      cellClass: "db-id",
      sortable: true,
      filter: { type: "text" },
      sortVal: (a) => a.email,
      searchVal: (a) => a.email,
      render: (a) => a.email,
    },
    {
      key: "system_role",
      label: "システムロール",
      width: 150,
      sortable: true,
      filter: {
        type: "enum",
        options: [
          ["general", "一般"],
          ["company_account_admin", "会社アカウント管理者"],
          ["system_admin", "システム管理者"],
        ],
      },
      sortVal: (a) => ROLE_LABEL[a.system_role] ?? a.system_role,
      filterVal: (a) => a.system_role,
      csvVal: (a) => ROLE_LABEL[a.system_role] ?? a.system_role,
      render: (a) => ROLE_LABEL[a.system_role] ?? a.system_role,
    },
    { key: "groups", label: "所属クエストグループ", width: 220, render: () => <span className="muted">—</span>, csvVal: () => "—" },
    {
      key: "status",
      label: "状態",
      width: 100,
      sortable: true,
      filter: {
        type: "enum",
        options: [
          ["active", "有効"],
          ["disabled", "無効"],
        ],
      },
      sortVal: (a) => a.status,
      filterVal: (a) => a.status,
      csvVal: (a) => (a.status === "active" ? "有効" : "無効"),
      render: (a) => statusBadge(a.status),
    },
    {
      key: "_actions",
      label: "",
      actions: true,
      locked: true,
      width: 90,
      render: (a) => <RowMenu items={accountMenuItems(a)} />,
    },
  ];

  return (
    <section className="card admin-create admin-create--table" aria-label="この会社のアカウント管理">
      <div className="admin-toolbar">
        <h2>アカウント &amp; 所属（この会社）</h2>
        <Button type="button" variant="primary" onClick={openIssue}>
          ＋ アカウント発行
        </Button>
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

      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      {loadError ? (
        <div className="form-error" role="alert">{loadError}</div>
      ) : loading ? (
        <p className="admin-muted">読み込み中…</p>
      ) : (
        <DataTable<Account>
          storageKey={`sc92-accounts-${companyId}`}
          data={accounts}
          columns={columns}
          rowId={(a) => a.account_id}
          unit="件"
          perPage={5}
          perPageOptions={[5, 10, 20, 50]}
          searchFields="氏名・ログインID・メール"
          exportName="アカウント"
          emptyText="該当するアカウントがありません。"
          onRowClick={(a) => {
            if (a.status === "active") openEdit(a); // §4.5⑪: 主アクション=編集。無効行は割当なし
          }}
          rowClass={(a) => (a.status === "active" ? undefined : "is-suspended")}
          cardLayout={(a) => ({
            title: a.display_name,
            badges: [
              { label: a.status === "active" ? "有効" : "無効", cls: a.status === "active" ? "st-active" : "st-suspended" },
              { label: ROLE_LABEL[a.system_role] ?? a.system_role },
            ],
            meta: [a.login_id, a.email],
            stats: ["—"],
          })}
        />
      )}
    </section>
  );
}
