"use client";

// SC-95 お知らせ一覧（全社閲覧・FR-49・U.1）。published・掲載期間内を pinned→公開日時降順。未読のみ絞り可。
import Link from "next/link";
import { useEffect, useState } from "react";

import { useScrollRestore } from "@/lib/scrollRestore";
import { listAnnouncements, type AnnouncementListItem } from "../api";

export function AnnouncementsListView() {
  const [items, setItems] = useState<AnnouncementListItem[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useScrollRestore(items !== null);

  useEffect(() => {
    const ac = new AbortController();
    listAnnouncements({ limit: 50, unread: unreadOnly }, ac.signal)
      .then((r) => { if (r) { setItems(r.data); setUnreadCount(r.unread_count); } })
      .catch(() => setErr("お知らせの取得に失敗しました。"));
    return () => ac.abort();
  }, [unreadOnly]);

  return (
    <section aria-label="お知らせ一覧">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head">
        <h1>📢 運営からのお知らせ</h1>
      </div>
      <div className="segmented" role="radiogroup" aria-label="絞り込み" style={{ marginBottom: "var(--space-4)" }}>
        <label><input type="radio" name="ann-filter" checked={!unreadOnly} onChange={() => setUnreadOnly(false)} /> すべて</label>
        <label><input type="radio" name="ann-filter" checked={unreadOnly} onChange={() => setUnreadOnly(true)} /> 未読のみ <span className="seg-n">{unreadCount}</span></label>
      </div>

      {err ? (
        <p className="form-error" role="alert">{err}</p>
      ) : items === null ? (
        <p className="muted">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="muted">{unreadOnly ? "未読のお知らせはありません。" : "お知らせはありません。"}</p>
      ) : (
        <ul className="notif-list">
          {items.map((a) => (
            <li key={a.id} className={a.is_read ? undefined : "unread"}>
              <span className="notif-ico">{a.pinned ? "📌" : "📢"}</span>
              <div className="notif-body">
                <div className="notif-head">
                  <Link className="notif-subject" href={`/announcements/${a.id}`}>{a.title}</Link>
                  <span className="notif-time muted">{(a.published_at ?? "").slice(0, 10)}</span>
                  {!a.is_read && <span className="badge badge-danger">未読</span>}
                </div>
                <div className="notif-ctx muted">{a.excerpt}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
