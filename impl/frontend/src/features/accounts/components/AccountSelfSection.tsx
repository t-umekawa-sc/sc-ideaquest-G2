"use client";

// SC-93 会社アカウント管理者＝自社（セッション会社固定）のアカウント管理（B.2.1）。
// 一覧（DataTable client モード）＋発行/編集は URL 付きモーダル（Parallel@modal＋Intercept・§112）へ分離。
// レイアウト/クラスの正＝doc/画面設計/mocks/SC-93_会社アカウント管理.html（DoD＝モック一致）。
//
// system_admin 行はこの画面で操作不可（SC-92 で管理＝SoD）＝操作列は 🔒・クリック割当なし（is-rowlocked・§4.5⑪）。
// データ供給は全件クライアント処理（useAllAccounts）。発行/編集の成功は別ルートで起き、
// ACCOUNTS_CHANGED_EVENT（window）を購読して一覧を再取得する（跨ルート更新・handoff §5）。
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Avatar, DataTable, RowMenu } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import {
  ACCOUNTS_CHANGED_EVENT,
  disableOwnAccount,
  enableOwnAccount,
  listOwnAccounts,
  resetOwnPassword,
} from "../api";
import type { Account } from "../types";
import { useAllAccounts } from "../useAllAccounts";
import "@/features/companies/companies.css";

const ROLE_LABEL: Record<string, string> = {
  general: "一般",
  company_account_admin: "会社アカウント管理者",
  system_admin: "システム管理者",
};

// 状態バッジ（アカウント状態＝2値。有効/無効＝論理削除。class の正＝design-system.css st-active/st-suspended）。
function statusBadge(status: string) {
  return status === "active" ? (
    <span className="badge st-active">有効</span>
  ) : (
    <span className="badge st-suspended">無効</span>
  );
}

export function AccountSelfSection({ companyCode }: { companyCode: string }) {
  const router = useRouter();
  const { accounts, loading, loadError, reload } = useAllAccounts(listOwnAccounts);
  const [actionError, setActionError] = useState<string | null>(null);

  // 発行/編集は別ルート（URL モーダル）で行う＝成功時の ACCOUNTS_CHANGED_EVENT を購読して一覧を再取得。
  useEffect(() => {
    const onChanged = () => void reload();
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, onChanged);
  }, [reload]);

  const editHref = (a: Account) => `/admin/accounts/${a.account_id}/edit`;

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

  // 行アクション（RowMenu ⋯）。操作可否は既存 impl を保持＝active/disabled で内容が変わる。
  // 編集は URL モーダルへ遷移（router.push＝ソフト遷移で intercept を差し込む）。
  function accountMenuItems(a: Account): RowMenuItem[] {
    if (a.status === "active") {
      return [
        { label: "編集", onClick: () => router.push(editHref(a)) },
        {
          label: "パスワード再設定",
          onClick: () => runAction(() => resetOwnPassword(a.account_id), undefined, "パスワード再設定リンクを送信しました。"),
        },
        {
          label: "無効化",
          danger: true,
          onClick: () => runAction(() => disableOwnAccount(a.account_id), `「${a.display_name}」を無効化しますか？`),
        },
      ];
    }
    return [{ label: "再有効化", onClick: () => runAction(() => enableOwnAccount(a.account_id)) }];
  }

  // 列定義（正＝mocks/SC-93 の DataTable columns）。所属グループは list 未提供＝「—」プレースホルダ。
  // system_admin 行は操作不可＝🔒（SC-92 で管理・SoD）。
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
      // system_admin は SC-92 で管理＝この画面では操作不可（🔒）。それ以外は RowMenu。
      render: (a) =>
        a.system_role === "system_admin" ? (
          <span className="row-locked" title="システム管理者アカウントはこの画面では操作できません">
            🔒
          </span>
        ) : (
          <RowMenu items={accountMenuItems(a)} />
        ),
    },
  ];

  return (
    <section aria-label="自社アカウント管理">
      <div className="admin-toolbar">
        <h1>会社アカウント管理</h1>
        {/* 発行は URL 付きモーダル（別ルート /admin/accounts/new）。直アクセス/リロードはフルページ。 */}
        <Link href="/admin/accounts/new" className="btn btn-primary">
          ＋ アカウント発行
        </Link>
      </div>
      <p className="admin-sub">
        自社のアカウントの<strong>発行・編集・無効化・パスワード再設定</strong>＋<strong>クエストグループ管理者（QG管理者）の任命</strong>ができます。（会社設定・システムロール付与は<strong>システム管理者</strong>の領分）
      </p>
      <div className="company-ctx">
        <span className="company-ctx__name">{companyCode}</span>
        <span className="company-ctx__note">自社のアカウントを管理しています（会社の切替はできません）。</span>
      </div>

      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      {loadError ? (
        <div className="form-error" role="alert">{loadError}</div>
      ) : loading ? (
        <p className="admin-muted">読み込み中…</p>
      ) : (
        <DataTable<Account>
          storageKey="sc93-accounts"
          data={accounts}
          columns={columns}
          rowId={(a) => a.account_id}
          unit="件"
          perPage={5}
          perPageOptions={[5, 10, 20, 50]}
          searchFields="氏名・ログインID・メール"
          exportName="自社アカウント"
          emptyText="該当するアカウントがありません。"
          onRowClick={(a) => {
            // §4.5⑪: 主アクション=編集。sys_admin（SoD）と無効行は割当なし
            if (a.system_role !== "system_admin" && a.status === "active") router.push(editHref(a));
          }}
          rowClass={(a) =>
            [a.status === "active" ? "" : "is-suspended", a.system_role === "system_admin" ? "is-rowlocked" : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
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
