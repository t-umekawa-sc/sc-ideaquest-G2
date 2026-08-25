"use client";

// SC-02 通知一覧（業務層・クリーン）＝状態/種別の絞り込み＋すべて既読＋日付グループ。H 実接続。
// body はサーバー取得時レンダリング済み（§8-⑳）／遷移先は ref から解決。クリックで既読化して参照先へ。
// 正＝doc/画面設計/mocks/SC-02_通知一覧.html・screens/SC-02・API設計 H。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getNotifications, markAllRead, markRead, markUnread, type NotificationDTO } from "../api";
import "../notifications.css";

type Group = "today" | "yesterday" | "earlier";
const GROUP_LABEL: Record<Group, string> = { today: "今日", yesterday: "昨日", earlier: "それ以前" };
const GROUP_ORDER: Group[] = ["today", "yesterday", "earlier"];

// 種別→アイコン（サーバー icon が無い場合のフォールバック）。
const ICO: Record<string, string> = {
  mention: "@", idea_comment: "💬", follow_comment: "💬", follow_evaluation: "⭐", follow_selection: "🏆",
  idea_updated: "🔄", magic_reaction: "✨", achievement: "🎖️", quest_party_invited: "🎯",
  security_new_device: "🛡️", security_password_changed: "🔑",
};

// UI カテゴリー → backend notification_type（サーバー絞り込みへ渡す・API設計 H.2）。
const CATEGORY: [string, string, string[]][] = [
  ["mention", "メンション", ["mention"]],
  ["comment", "コメント", ["idea_comment", "follow_comment"]],
  ["eval", "評価", ["follow_evaluation"]],
  ["select", "選定", ["follow_selection"]],
  ["update", "アイデア更新", ["idea_updated"]],
  ["achievement", "実績", ["achievement"]],
  ["magic", "魔法", ["magic_reaction"]],
  ["quest", "クエスト招集", ["quest_party_invited"]],
  ["security", "セキュリティ", ["security_new_device", "security_password_changed"]],
];
const CAT_TYPES: Record<string, string[]> = Object.fromEntries(CATEGORY.map(([k, , v]) => [k, v]));

// ref から遷移先を解決（種別非依存・ref の有無で判定・SC-02 §4.2）。セキュリティ等 ref 無しは遷移なし。
function hrefOf(n: NotificationDTO): string | null {
  const r = n.ref ?? {};
  if (r.chat_message_id && r.idea_id) return `/ideas/${r.idea_id}/chat`;
  if (r.idea_id) return `/ideas/${r.idea_id}`;
  if (r.achievement_id) return "/achievements";
  if (r.quest_id) return `/quests/${r.quest_id}`;
  return null;
}

function groupOf(iso: string): Group {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startToday.getDate() - 1);
  if (d >= startToday) return "today";
  if (d >= startYesterday) return "yesterday";
  return "earlier";
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400 && groupOf(iso) === "today") return `${Math.floor(diff / 3600)}時間前`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (groupOf(iso) === "yesterday") return `昨日 ${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function NotificationsView() {
  const [rows, setRows] = useState<NotificationDTO[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [fState, setFState] = useState<"" | "unread">("");
  const [fCat, setFCat] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getNotifications({
      state: fState || undefined,
      type: fCat ? CAT_TYPES[fCat] : undefined,
      limit: 50,
    }).catch(() => null);
    if (r) {
      setRows(r.data);
      setUnreadCount(r.unread_count);
    }
    setLoading(false);
  }, [fState, fCat]);
  useEffect(() => { void load(); }, [load]);

  const setRead = async (id: string, read: boolean) => {
    // 楽観更新＋サーバー権威（未読数はレスポンスで補正）。
    setRows((xs) => xs.map((n) => (n.id === id ? { ...n, is_read: read } : n)));
    const res = read ? await markRead(id).catch(() => null) : await markUnread(id).catch(() => null);
    if (res) setUnreadCount(res.unread_count);
    // unread フィルタ中に既読化したら一覧から外す。
    if (read && fState === "unread") setRows((xs) => xs.filter((n) => n.id !== id));
  };

  const markAll = async () => {
    // 「すべて既読にする」は現在の絞り込みに関わらず全既読（一般的な UX・H.3 は type 省略で全件）。
    const res = await markAllRead().catch(() => null);
    if (res) setUnreadCount(res.unread_count);
    await load();
  };

  function Row({ n }: { n: NotificationDTO }) {
    const href = hrefOf(n);
    const inner = (
      <>
        <span className="n__ico">{n.icon || ICO[n.type] || "🔔"}</span>
        <div className="n__body">
          <div>
            {n.body}
            {n.tag && (
              <>
                {" "}
                <span className="badge" style={{ fontSize: 10, background: "#FEF3C7", color: "var(--color-warning)" }}>
                  {n.tag}
                </span>
              </>
            )}
          </div>
          {n.context && <div className="n__ctx">{n.context}</div>}
          {n.meta?.coin != null && <div className="n__gain"><span className="coin">◆{n.meta.coin}</span></div>}
        </div>
        <div className="n__right">
          <span className="n__time">{timeLabel(n.created_at)}</span>
          <span className="n__dot" aria-hidden="true" />
          <button
            className="n__read"
            type="button"
            title={!n.is_read ? "既読にする" : "未読に戻す"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void setRead(n.id, n.is_read ? false : true);
            }}
          >
            {!n.is_read ? "既読にする" : "未読に戻す"}
          </button>
        </div>
      </>
    );
    const cls = `n${!n.is_read ? " is-unread" : ""}`;
    return href ? (
      <Link className={cls} href={href} onClick={() => void setRead(n.id, true)}>
        {inner}
      </Link>
    ) : (
      <div
        className={cls}
        role="button"
        tabIndex={0}
        onClick={() => void setRead(n.id, true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void setRead(n.id, true);
          }
        }}
      >
        {inner}
      </div>
    );
  }

  return (
    <main className="container" style={{ paddingBlock: "var(--space-6) var(--space-16)", maxWidth: 820 }}>
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="notif-title">通知</h1>

      {/* 絞り込み・一括操作 */}
      <div className="list-toolbar">
        <div className="filters">
          <label>
            状態
            <select className="select" value={fState} onChange={(e) => setFState(e.target.value as "" | "unread")}>
              <option value="">すべて</option>
              <option value="unread">未読のみ</option>
            </select>
          </label>
          <label>
            種別
            <select className="select" value={fCat} onChange={(e) => setFCat(e.target.value)}>
              <option value="">すべて</option>
              {CATEGORY.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="tools">
          <span className="list-count">{unreadCount} 件の未読</span>
          <button className="btn btn-outline" type="button" onClick={() => void markAll()}>
            すべて既読にする
          </button>
        </div>
      </div>

      {loading ? (
        <p className="admin-muted">読み込み中…</p>
      ) : rows.length === 0 ? (
        <div className="list-empty">該当する通知はありません。</div>
      ) : (
        GROUP_ORDER.map((g) => {
          const items = rows.filter((n) => groupOf(n.created_at) === g);
          if (!items.length) return null;
          return (
            <section className="notif-group" key={g}>
              <h2 className="notif-group__label">{GROUP_LABEL[g]}</h2>
              {items.map((n) => (
                <Row n={n} key={n.id} />
              ))}
            </section>
          );
        })
      )}

      <p className="role-note" style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
        通知は参照先（アイデア／チャット／実績 など）を開くと<strong>既読</strong>になります。
        種別＝メンション／自分のアイデアへのコメント／フォロー中アイデアの新規コメント・評価・選定／投票済み・フォロー中アイデアの<strong>更新</strong>／実績獲得／魔法リアクション／クエスト招集／<strong>🛡️セキュリティ（新しい端末・パスワード変更）</strong>。セキュリティ通知は本人宛で、オフにできません（パスワード変更はメールでもお知らせします）。
      </p>
    </main>
  );
}
