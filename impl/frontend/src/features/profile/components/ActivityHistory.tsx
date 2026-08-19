"use client";

// SC-03 獲得履歴（G.6・GET /me/activities）。初回ページはサーバ取得、続きは next rewrite 経由で
// クライアント fetch（カーソル §1.8）。残高そのものではなく付与/消費の記録を新しい順で表示。
import { useState } from "react";

import type { Activities, Activity } from "@/lib/me";
import "../profile.css";

// reason（元帳の事由）→ 表示ラベル（i18n は後続・当面 ja 固定）。
const REASON_LABEL: Record<string, string> = {
  login: "ログインボーナス",
  idea_post: "アイデア投稿",
  vote: "投票",
  chat: "チャット",
  evaluation: "評価",
  selection: "選定",
  evaluation_coin: "評価報酬",
  achievement_reward: "実績報酬",
  levelup_sp: "レベルアップ",
  shop_purchase: "ショップ購入",
  spell_unlock: "魔法解放",
};

// kind → 符号＋単位（gain=＋/spend=−・XP◆✦）。amount は常に正・方向は kind（§5.27）。
const UNIT: Record<string, { sign: string; unit: string; gain: boolean }> = {
  xp_gain: { sign: "＋", unit: "XP", gain: true },
  coin_gain: { sign: "＋", unit: "◆", gain: true },
  coin_spend: { sign: "−", unit: "◆", gain: false },
  sp_gain: { sign: "＋", unit: "✦", gain: true },
  sp_spend: { sign: "−", unit: "✦", gain: false },
};

function amountText(a: Activity): { text: string; gain: boolean } {
  const u = UNIT[a.kind];
  if (!u) return { text: `${a.amount}`, gain: true };
  return { text: `${u.sign}${a.amount} ${u.unit}`, gain: u.gain };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

export function ActivityHistory({ initial }: { initial: Activities }) {
  const [items, setItems] = useState<Activity[]>(initial.data);
  const [cursor, setCursor] = useState<string | null | undefined>(initial.page_info.next_cursor);
  const [hasNext, setHasNext] = useState(initial.page_info.has_next);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/me/activities?limit=8&cursor=${encodeURIComponent(cursor)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const page: Activities = await res.json();
        setItems((prev) => [...prev, ...page.data]);
        setCursor(page.page_info.next_cursor);
        setHasNext(page.page_info.has_next);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="pixel-panel activity-history" aria-label="獲得履歴">
      <h2 className="activity-history__title">獲得履歴</h2>
      {items.length === 0 ? (
        <p className="activity-history__empty">まだアクティビティはありません。</p>
      ) : (
        <ul className="activity-list">
          {items.map((a) => {
            const amt = amountText(a);
            return (
              <li key={a.id} className="activity-item">
                <span className="activity-item__reason">{REASON_LABEL[a.reason] ?? a.reason}</span>
                <span className={`activity-item__amount ${amt.gain ? "is-gain" : "is-spend"}`}>{amt.text}</span>
                <time className="activity-item__time" dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
              </li>
            );
          })}
        </ul>
      )}
      {hasNext && (
        <button type="button" className="btn btn-outline btn-sm activity-history__more" onClick={loadMore} disabled={loading}>
          {loading ? "読み込み中…" : "もっと見る"}
        </button>
      )}
    </section>
  );
}
