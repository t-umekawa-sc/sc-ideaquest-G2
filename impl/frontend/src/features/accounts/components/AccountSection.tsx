"use client";

// SC-92 アカウント & 所属（この会社）。system_admin 経路（クロステナント）。
// 一覧（DataTable client モード）＋発行/編集は URL 付きモーダル（Parallel@modal＋Intercept・§112）へ分離。
// レイアウト/クラスの正＝doc/画面設計/mocks/SC-92_会社詳細.html（DoD＝モック一致）。
//
// 一覧の操作標準は DataTable に委譲＝検索/絞込/複数ソート/列設定/CSV/ピン/カード切替（§4.5）。
// データ供給は全件クライアント処理（useAllAccounts）＝管理系は小規模。発行/編集の成功は別ルートで起き、
// ACCOUNTS_CHANGED_EVENT（window）を購読して一覧を再取得する（跨ルート更新・handoff §5）。
// 操作可否のセマンティクスは既存 impl を保持（active＝所属・編集/PW再設定/無効化・disabled＝再有効化）。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Avatar, DataTable, RowMenu } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { ACCOUNTS_CHANGED_EVENT, disableAccount, enableAccount, listAccounts, resetPassword } from "../api";
import type { Account } from "../types";
import { useAllAccounts } from "../useAllAccounts";
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

export function AccountSection({ companyId }: { companyId: string }) {
  const router = useRouter();
  // fetcher は companyId に閉じたクロステナント経路（/admin/companies/{id}/accounts）。全件取得は useAllAccounts。
  const fetcher = useCallback(
    (params: { page: number; per_page: number }) => listAccounts(companyId, params),
    [companyId],
  );
  const { accounts, loading, loadError, reload } = useAllAccounts(fetcher);
  const [actionError, setActionError] = useState<string | null>(null);

  // 発行/編集は別ルート（URL モーダル）で行う＝成功時の ACCOUNTS_CHANGED_EVENT を購読して一覧を再取得。
  useEffect(() => {
    const onChanged = () => void reload();
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, onChanged);
  }, [reload]);

  const editHref = (a: Account) => `/admin/companies/${companyId}/accounts/${a.account_id}/edit`;

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
  // 編集は URL モーダルへ遷移（router.push＝ソフト遷移で intercept を差し込む）。
  function accountMenuItems(a: Account): RowMenuItem[] {
    if (a.status === "active") {
      return [
        { label: "所属・編集", onClick: () => router.push(editHref(a)) },
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
        {/* 発行は URL 付きモーダル（別ルート /admin/companies/[id]/accounts/new）。直アクセス/リロードはフルページ。 */}
        <Link href={`/admin/companies/${companyId}/accounts/new`} className="btn btn-primary">
          ＋ アカウント発行
        </Link>
      </div>

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
            if (a.status === "active") router.push(editHref(a)); // §4.5⑪: 主アクション=編集。無効行は割当なし
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
