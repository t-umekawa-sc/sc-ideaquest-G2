"use client";

// アクティビティフィード（FR-36・G.5.1）＝クエスト内(SC-12 §4.1c)/チーム(SC-01 §4.8b)共用パネル。
// 他者フィードは公開種別のみ（サーバー強制＝idea_post/selection/achievement_reward/levelup_sp）。
// 行＝アクター（アバター＋氏名）＋人間可読イベント（reason から・ref リンクは D/E 依存で当面テキスト）＋
// （チーム時）クエスト名＋相対時刻。カーソル「もっと見る」。
import { useCallback, useEffect, useState } from "react";

import { EmptyState, Avatar } from "@/components/ui";

import type { FeedActivity } from "../api";
import "../feed.css";

// reason → 人間可読イベント（当面 ja 固定・ref 解決は D/E 実装後にリンク化）。
const EVENT: Record<string, string> = {
  idea_post: "アイデアを投稿しました",
  selection: "アイデアを選定しました",
  achievement_reward: "実績を獲得しました",
  levelup_sp: "レベルアップしました",
};

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

type Page = { data: FeedActivity[]; page_info: { next_cursor?: string | null; has_next: boolean } } | null;

export function ActivityFeed({
  title,
  load,
  showQuest = false,
  emptyText = "まだアクティビティはありません。",
}: {
  title: string;
  load: (cursor?: string | null) => Promise<Page>;
  showQuest?: boolean;
  emptyText?: string;
}) {
  const [items, setItems] = useState<FeedActivity[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  const initialLoad = useCallback(async () => {
    const res = await load(undefined).catch(() => null);
    if (res) {
      setItems(res.data);
      setCursor(res.page_info.next_cursor);
      setHasNext(res.page_info.has_next);
    }
    setLoading(false);
    setReady(true);
  }, [load]);
  useEffect(() => { void initialLoad(); }, [initialLoad]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    const res = await load(cursor).catch(() => null);
    if (res) {
      setItems((prev) => [...prev, ...res.data]);
      setCursor(res.page_info.next_cursor);
      setHasNext(res.page_info.has_next);
    }
    setLoading(false);
  }

  return (
    <div className="feed">
      <h3 className="feed__title">{title}</h3>
      {ready && items.length === 0 ? (
        <EmptyState icon="📣" title={emptyText} />
      ) : (
        <ul className="feed__list">
          {items.map((a) => (
            <li key={a.id} className="feed__item">
              <Avatar name={a.actor.name} size="sm" level={a.actor.level ?? undefined} />
              <div className="feed__body">
                <span><strong className="feed__actor">{a.actor.name}</strong>が{EVENT[a.reason] ?? "活動しました"}</span>
                {showQuest && a.quest_title && <span className="feed__quest">🎯 {a.quest_title}</span>}
              </div>
              <time className="feed__time" dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
            </li>
          ))}
        </ul>
      )}
      {hasNext && (
        <button type="button" className="btn btn-outline btn-sm feed__more" onClick={loadMore} disabled={loading}>
          {loading ? "読み込み中…" : "もっと見る"}
        </button>
      )}
    </div>
  );
}
