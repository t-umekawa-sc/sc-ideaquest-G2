"use client";

// SC-95 お知らせ詳細（全社閲覧・FR-49・U.1）。開くと既読化（POST read・冪等）。本文は RichTextView（サニタイズ済）。
import Link from "next/link";
import { useEffect, useState } from "react";

import { RichTextView } from "@/components/richtext/RichTextView";
import { ANNOUNCEMENTS_CHANGED_EVENT, getAnnouncement, markAnnouncementRead, type AnnouncementDetail } from "../api";

export function AnnouncementDetailView({ announcementId }: { announcementId: string }) {
  const [a, setA] = useState<AnnouncementDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    getAnnouncement(announcementId, ac.signal)
      .then((r) => {
        if (!r) { setNotFound(true); return; }
        setA(r);
        // 開いたら既読化（冪等）＝未読バッジ/数を減らす。真実は次回の read 一覧。
        if (!r.is_read) void markAnnouncementRead(announcementId).then(() => window.dispatchEvent(new Event(ANNOUNCEMENTS_CHANGED_EVENT)));
      })
      .catch(() => setNotFound(true));
    return () => ac.abort();
  }, [announcementId]);

  if (notFound) {
    return (
      <section aria-label="お知らせ詳細">
        <Link className="backlink backlink--float" href="/announcements">← お知らせ一覧へ戻る</Link>
        <p className="muted" style={{ marginTop: "var(--space-6)" }}>このお知らせは見つかりませんでした（公開終了・削除の可能性があります）。</p>
      </section>
    );
  }
  if (!a) return <section aria-label="お知らせ詳細"><p className="hint">読み込み中…</p></section>;

  return (
    <section aria-label="お知らせ詳細">
      <Link className="backlink backlink--float" href="/announcements">← お知らせ一覧へ戻る</Link>
      <article className="card" style={{ marginTop: "var(--space-2)" }}>
        <div className="between">
          <h1 style={{ margin: 0 }}>{a.pinned && <span title="ピン留め">📌 </span>}{a.title}</h1>
        </div>
        <div className="muted text-sm" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
          🗓 {(a.published_at ?? "").slice(0, 10)}　・　{a.created_by?.display_name ?? "運営"}
        </div>
        <RichTextView html={a.body_html} />
      </article>
    </section>
  );
}
