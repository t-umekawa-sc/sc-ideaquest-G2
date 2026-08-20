"use client";

// SC-91 システム管理（会社一覧）。system_admin 専用（ページ側でガード）。
// 一覧取得＋会社作成（B.1）。業務層クリーン＝表示/UX のみ、判定はサーバー（403/409/422 を文言化）。
// レイアウト/クラスは正＝doc/画面設計/mocks/SC-91_システム管理.html（DoD＝モック一致）。
//
// 一覧の操作標準は DataTable の **サーバー駆動モード**に委譲＝検索/複数ソート/項目別フィルタ/ページ/ピン/CSV は
// backend `GET /admin/companies`（§1.8.1 契約）が確定する。フロントは QueryState を送り {rows,total,pinned} を描画するだけ。
// ソート可能キー/フィルタ可能フィールドは backend ホワイトリストに一致させる（下記 COLUMNS のフラグ）。
// 表示状態（列順/幅/密度/ビュー/ピンID）は localStorage 専管（サーバーへ送らない）。
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { companiesCsvUrl, queryCompanies } from "../api";
import type { Company } from "../types";
import "../companies.css";

// 会社の変更（作成など）通知イベント名。URL モーダル（別ルート）からの作成成功時に window へ発火し、
// 一覧（本コンポーネント）が購読して再取得する（跨ルートの疎結合ブリッジ）。作成フォームは
// CompanyCreateForm（URL モーダル／フルページで共有）。
export const COMPANIES_CHANGED_EVENT = "ideaquest:companies-changed";

// 状態バッジ（会社状態＝2値。有効/停止）。
function statusBadge(status: string): ReactNode {
  return status === "active" ? (
    <span className="badge st-active">有効</span>
  ) : (
    <span className="badge st-suspended">停止</span>
  );
}

// 列定義（正＝mocks/SC-91 の DataTable columns）。render は ReactNode（HTML 文字列でない）。
// **サーバー駆動モード**では sortable/filter フラグが backend の受け入れ範囲を表す（§1.8.1 ホワイトリスト）:
//  ・ソート可＝name / company_code / account_count（created_at は列を出さない）。status / db_identifier は非ソート。
//  ・フィルタ可＝status(enum) / account_count(number)。name/company_code/db_identifier は横断検索 q が担う
//    （backend に per-field contains が無いため列別 text フィルタは付けない）。
// グループ数・作成日は CompanyListItem 未提供（group_count＝ドメインC／created_at＝一覧項目未返却）＝「—」プレースホルダ。
const COLUMNS: DataTableColumn<Company>[] = [
  {
    key: "name",
    label: "会社名",
    locked: true,
    width: 240,
    sortable: true,
    render: (r) => (
      <span className="co">
        <QuestIcon name={r.name} color={r.color} imageUrl={r.icon_image_url} size="sm" />
        <strong>{r.name}</strong>
      </span>
    ),
  },
  {
    key: "company_code",
    label: "会社コード",
    width: 130,
    cellClass: "db-id",
    sortable: true,
    render: (r) => r.company_code,
  },
  {
    key: "db_identifier",
    label: "DB識別子",
    width: 150,
    cellClass: "db-id",
    render: (r) => r.db_identifier,
  },
  {
    key: "status",
    label: "状態",
    width: 110,
    filter: { type: "enum", options: [["active", "有効"], ["suspended", "停止"]] },
    render: (r) => statusBadge(r.status),
  },
  {
    key: "account_count",
    label: "アカウント",
    width: 110,
    align: "num",
    sortable: true,
    filter: { type: "number" },
    render: (r) => r.account_count,
  },
  { key: "groups", label: "グループ", width: 100, align: "num", render: () => "—", csvVal: () => "—" },
  { key: "created", label: "作成日", width: 130, render: () => "—", csvVal: () => "—" },
  {
    key: "_actions",
    label: "",
    actions: true,
    locked: true,
    width: 130,
    render: (r) => (
      <Link
        href={`/admin/companies/${r.company_id}`}
        className="btn btn-outline btn-sm"
        onClick={(e) => e.stopPropagation()}
      >
        管理する →
      </Link>
    ),
  },
];

// カード表示（🔲カード/☰リスト 切替）。会社アイコン＋名称を活かす。操作は actions 列が右上に自動表示。
function companyCard(c: Company): ReactNode {
  return (
    <>
      <div className="dt-card__title co">
        <QuestIcon name={c.name} color={c.color} imageUrl={c.icon_image_url} size="sm" />
        <span>{c.name}</span>
      </div>
      <div className="dt-card__meta">
        {statusBadge(c.status)}
        <span className="badge badge-muted">{c.company_code}</span>
        <span className="db-id">{c.db_identifier}</span>
      </div>
      <div className="dt-card__stats">
        <span>👥 {c.account_count}</span>
        <span>🗂️ —</span>
        <span>作成 —</span>
      </div>
    </>
  );
}

export function CompanyList() {
  const router = useRouter();
  // 一覧は DataTable のサーバー駆動モードが取得する。作成後の再取得は reloadKey で DataTable を再マウント。
  // 作成は URL モーダル（別ルート /admin/companies/new）で行い、成功時に COMPANIES_CHANGED_EVENT を購読して更新。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const onChanged = () => setReloadKey((k) => k + 1);
    window.addEventListener(COMPANIES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(COMPANIES_CHANGED_EVENT, onChanged);
  }, []);

  return (
    <section aria-label="会社一覧">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="page-title">システム管理（運営）</h1>
      <p className="admin-sub">
        会社（テナント）の一覧・作成。<strong>各会社の設定・アカウント/所属の管理は、会社を選ぶと会社詳細で行います</strong>。
        <strong>システム管理者のみ</strong>。
      </p>

      <div className="section-head">
        <h2>会社（テナント）</h2>
        {/* 作成は URL 付きモーダル（Parallel@modal＋Intercept）。直アクセス/リロードは /admin/companies/new のフルページ。 */}
        <Link href="/admin/companies/new" className="btn btn-primary">
          ＋ 会社を作成
        </Link>
      </div>

      {/* 一覧＝DataTable サーバー駆動モード（ロード/エラー/空表示は DataTable が担う）。
          key=reloadKey で作成後に再マウント＝最新を取り直す。403 は画面ガード（B-TC-112）で遮断済み。 */}
      <DataTable<Company>
        key={reloadKey}
        storageKey="sc91-companies"
        columns={COLUMNS}
        rowId={(r) => r.company_id}
        unit="社"
        perPage={5}
        perPageOptions={[5, 10, 20, 50]}
        maxPins={5}
        searchFields="会社名・会社コード・DB識別子"
        exportName="会社一覧"
        onRowClick={(r) => router.push(`/admin/companies/${r.company_id}`)}
        emptyText="該当する会社がありません。"
        card={companyCard}
        server={{
          query: queryCompanies,
          onExport: (state, columns) => {
            window.location.href = companiesCsvUrl(state, columns);
          },
        }}
      />

      <p className="role-note">
        ※ 各会社のデータは会社ごとに分けて管理されます。一覧の「DB識別子」は会社を識別するための参照キーです。
        会社を選ぶと<strong>会社詳細</strong>で設定・アカウント/所属を管理します。
      </p>
    </section>
  );
}
