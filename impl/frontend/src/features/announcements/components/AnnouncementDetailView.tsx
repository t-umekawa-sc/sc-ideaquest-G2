"use client";

// SC-95 お知らせ詳細（全社閲覧・FR-49・U.1）。開くと既読化（POST read・冪等）。本文は RichTextView（サニタイズ済）。
// 戻る＝遷移元へ復帰（router.back）。一覧から来たら「← お知らせ一覧へ戻る」、ダッシュボード/直リンクは「← ダッシュボードへ戻る」。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { RichTextView } from "@/components/richtext/RichTextView";
import { backToListOr, consumeAnnouncementFromList } from "@/lib/nav";
import { ANNOUNCEMENTS_CHANGED_EVENT, getAnnouncement, markAnnouncementRead, type AnnouncementDetail } from "../api";

export function AnnouncementDetailView({ announcementId }: { announcementId: string }) {
  const router = useRouter();
  const [a, setA] = useState<AnnouncementDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  // 来歴（一覧から来たか）はマウント時に1回だけ消費＝戻る先/ラベルの出し分け。
  const [fromList, setFromList] = useState(false);
  const consumed = useRef(false);
  useEffect(() => { if (!consumed.current) { consumed.current = true; setFromList(consumeAnnouncementFromList()); } }, []);

  const backHref = fromList ? "/announcements" : "/";
  const backLabel = fromList ? "← お知らせ一覧へ戻る" : "← ダッシュボードへ戻る";
  const onBack = (e: React.MouseEvent) => { e.preventDefault(); backToListOr(router, backHref); };

  useEffect(() => {
    const ac = new AbortController();
    getAnnouncement(announcementId, ac.signal)
      .then((r) => {
        if (!r) { setNotFound(true); return; }
        setA(r);
        if (!r.is_read) void markAnnouncementRead(announcementId).then(() => window.dispatchEvent(new Event(ANNOUNCEMENTS_CHANGED_EVENT)));
      })
      .catch(() => setNotFound(true));
    return () => ac.abort();
  }, [announcementId]);

  if (notFound) {
    return (
      <section aria-label="お知らせ詳細">
        <Link className="backlink backlink--float" href={backHref} onClick={onBack}>{backLabel}</Link>
        <p className="muted" style={{ marginTop: "var(--space-6)" }}>このお知らせは見つかりませんでした（公開終了・削除の可能性があります）。</p>
      </section>
    );
  }
  if (!a) return <section aria-label="お知らせ詳細"><p className="hint">読み込み中…</p></section>;

  return (
    <section aria-label="お知らせ詳細">
      <Link className="backlink backlink--float" href={backHref} onClick={onBack}>{backLabel}</Link>
      <article className="card" style={{ marginTop: "var(--space-2)" }}>
        <div className="between">
          <h1 style={{ margin: 0 }}>{a.title}</h1>
        </div>
        <div className="muted text-sm" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
          🗓 {(a.published_at ?? "").slice(0, 10)}　・　{a.created_by?.display_name ?? "運営"}
        </div>
        <RichTextView html={a.body_html} />
      </article>
    </section>
  );
}
