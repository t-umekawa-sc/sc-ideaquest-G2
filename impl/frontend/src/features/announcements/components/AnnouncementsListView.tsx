"use client";

// SC-95 お知らせ一覧（全社閲覧・FR-49・U.1）。標準の一覧（DataTable＝カード/リスト切替・検索/絞込/ソート）。
// 列＝タイトル/公開日/ピン/状態(未読・既読)/既読日時（本文抜粋は列から除外・カード表示にのみ使用）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { useScrollRestore } from "@/lib/scrollRestore";
import { markAnnouncementFromList } from "@/lib/nav";
import { listAnnouncements, type AnnouncementListItem } from "../api";

type Row = {
  id: string; title: string; excerpt: string;
  published: string; publishedSort: string; pinned: boolean;
  statusLabel: string; readAt: string; readAtSort: string;
};

const fmtDateTime = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 16).replace("T", " ") : "—";

function toRow(a: AnnouncementListItem): Row {
  return {
    id: a.id, title: a.title, excerpt: a.excerpt ?? "",
    published: (a.published_at ?? "").slice(0, 10) || "—", publishedSort: a.published_at ?? "",
    pinned: a.pinned, statusLabel: a.is_read ? "既読" : "未読",
    readAt: fmtDateTime(a.read_at), readAtSort: a.read_at ?? "",
  };
}

const PIN_OPTIONS: [string, string][] = [["📌 ピン", "📌 ピン"], ["—", "—"]];
const STATUS_OPTIONS: [string, string][] = [["未読", "未読"], ["既読", "既読"]];

export function AnnouncementsListView() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  // すべて/未読/既読 スイッチ（ユーザー要望・既定＝すべて）。
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  useScrollRestore(rows !== null);

  useEffect(() => {
    const ac = new AbortController();
    listAnnouncements({ limit: 100 }, ac.signal)
      .then((r) => { if (r) { setRows(r.data.map(toRow)); setUnreadCount(r.unread_count); } })
      .catch(() => setErr("お知らせの取得に失敗しました。"));
    return () => ac.abort();
  }, []);

  const columns = useMemo<DataTableColumn<Row>[]>(() => [
    {
      key: "title", label: "タイトル", locked: true, width: 320, sortable: true, filter: { type: "text" },
      sortVal: (x) => x.title, searchVal: (x) => `${x.title} ${x.excerpt}`, csvVal: (x) => x.title,
      // タイトル先頭の 📌 はダッシュボード表示時のみ（一覧はピン列で表現・ユーザー要望）。
      render: (x) => (
        <span className="row-center" style={{ gap: "var(--space-2)" }}>
          <Link className="idea-title" href={`/announcements/${x.id}`} onClick={() => markAnnouncementFromList()}>{x.title}</Link>
        </span>
      ),
    },
    { key: "published", label: "公開日", width: 120, sortable: true, sortVal: (x) => x.publishedSort, csvVal: (x) => x.published, render: (x) => x.published },
    { key: "pinned", label: "ピン", width: 90, sortable: true, filter: { type: "enum", options: PIN_OPTIONS }, sortVal: (x) => (x.pinned ? 1 : 0), filterVal: (x) => (x.pinned ? "📌 ピン" : "—"), render: (x) => (x.pinned ? "📌" : "—") },
    { key: "status", label: "状態", width: 100, sortable: true, filter: { type: "enum", options: STATUS_OPTIONS }, sortVal: (x) => x.statusLabel, filterVal: (x) => x.statusLabel, render: (x) => <span className={x.statusLabel === "未読" ? "badge badge-danger" : "badge badge-muted"}>{x.statusLabel}</span> },
    { key: "readAt", label: "既読日時", width: 160, sortable: true, sortVal: (x) => x.readAtSort, csvVal: (x) => x.readAt, render: (x) => x.readAt },
  ], []);

  // スイッチの件数と絞り込み後の表示データ（状態＝statusLabel で判定）。
  const counts = useMemo(() => {
    const all = rows ?? [];
    const read = all.filter((x) => x.statusLabel === "既読").length;
    return { all: all.length, unread: all.length - read, read };
  }, [rows]);
  const visibleRows = useMemo(
    () => (rows ?? []).filter((x) => readFilter === "all" || (readFilter === "read" ? x.statusLabel === "既読" : x.statusLabel === "未読")),
    [rows, readFilter],
  );
  const R_FILTERS: [typeof readFilter, string][] = [["all", "すべて"], ["unread", "未読"], ["read", "既読"]];

  return (
    <section aria-label="お知らせ一覧">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head">
        <h1>📢 運営からのお知らせ</h1>
      </div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        運営からの全社お知らせです（未読 {unreadCount} 件）。行をクリックで全文を開きます。
      </p>

      {/* 既読状態スイッチ（すべて/未読/既読・ユーザー要望）。 */}
      {rows !== null && !err && (
        <div className="segmented" role="radiogroup" aria-label="既読状態の絞り込み" style={{ marginBottom: "var(--space-4)" }}>
          {R_FILTERS.map(([k, label]) => (
            <label key={k}>
              <input type="radio" name="ann-read-filter" checked={readFilter === k} onChange={() => setReadFilter(k)} />
              {label} <span className="seg-n">{counts[k]}</span>
            </label>
          ))}
        </div>
      )}

      {err ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows === null ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<Row>
          storageKey="sc95-announcements"
          data={visibleRows}
          columns={columns}
          rowId={(x) => x.id}
          unit="件"
          perPage={12}
          perPageOptions={[12, 24, 48]}
          defaultView="list"
          searchFields="タイトル・本文"
          exportName="お知らせ一覧"
          emptyText="お知らせはありません。"
          onRowClick={(x) => { markAnnouncementFromList(); router.push(`/announcements/${x.id}`); }}
          card={(x) => (
            <>
              <div className="between">
                <span className="card-title">{x.title}</span>
                <span className={x.statusLabel === "未読" ? "badge badge-danger" : "badge badge-muted"}>{x.statusLabel}</span>
              </div>
              <div className="muted text-sm" style={{ margin: "var(--space-2) 0" }}>{x.excerpt}</div>
              <div className="muted text-xs">公開 {x.published}　・　既読 {x.readAt}</div>
            </>
          )}
        />
      )}
    </section>
  );
}
