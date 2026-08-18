"use client";

// SC-02 通知一覧（業務層・クリーン）＝状態/種別の絞り込み＋すべて既読＋日付グループ。各通知はクリックで参照先へ遷移し既読化。
// 種別＝メンション/コメント/評価/選定/アイデア更新/実績/魔法/セキュリティ（本人宛・オフ不可）。
// 正＝doc/画面設計/mocks/SC-02_通知一覧.html・doc/画面設計/screens/SC-02_通知一覧.md。
// 通知 backend（H）未実装＝デモ fixtures（画面モック先行）。
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import "../notifications.css";

type NType = "mention" | "comment" | "eval" | "select" | "update" | "achievement" | "magic" | "secdev" | "secpw";
type Group = "today" | "yesterday" | "earlier";
type Notif = { id: number; type: NType; unread: boolean; group: Group; time: string; body: ReactNode; ctx: string; gain?: ReactNode; tag?: string };

const ICO: Record<NType, string> = { mention: "@", comment: "💬", eval: "⭐", select: "🏆", update: "🔄", achievement: "🎖️", magic: "✨", secdev: "🛡️", secpw: "🔑" };
// 参照先（impl ルート・デモ id=q1）。セキュリティ通知は参照先なし＝遷移せず既読化のみ。
const HREF: Record<NType, string | null> = {
  mention: "/ideas/q1/chat", comment: "/ideas/q1", eval: "/ideas/q1", select: "/ideas/q1",
  update: "/ideas/q1", achievement: "/achievements", magic: "/ideas/q1/chat", secdev: null, secpw: null,
};
const CAT: Record<NType, string> = { mention: "mention", comment: "comment", eval: "eval", select: "select", update: "update", achievement: "achievement", magic: "magic", secdev: "security", secpw: "security" };
const GROUP_LABEL: Record<Group, string> = { today: "今日", yesterday: "昨日", earlier: "それ以前" };
const GROUP_ORDER: Group[] = ["today", "yesterday", "earlier"];

const INITIAL: Notif[] = [
  { id: 1, type: "mention", unread: true, group: "today", time: "5分前", body: (<><strong>鈴木 花子</strong> さんがチャットであなたをメンションしました</>), ctx: "配送ルート最適化 / アイデア「夜間配送の集約」" },
  { id: 2, type: "comment", unread: true, group: "today", time: "1時間前", body: (<>あなたのアイデアに <strong>3件</strong> の新しいコメントがつきました</>), ctx: "社内ナレッジ検索AI / アイデア「FAQ自動生成」" },
  { id: 3, type: "update", unread: true, group: "today", time: "2時間前", body: (<>投票したアイデアが <strong>更新</strong>されました。差分を確認して投票を見直せます</>), ctx: "配送ルート最適化 / アイデア「置き配の写真通知」", tag: "投票の見直し" },
  { id: 4, type: "achievement", unread: false, group: "today", time: "3時間前", body: (<>実績 <strong>「目利き」</strong>（シルバー）を獲得しました</>), ctx: "評価を10件実施", gain: (<span className="coin">◆50</span>) },
  { id: 5, type: "magic", unread: false, group: "today", time: "4時間前", body: (<><strong>田中 美咲</strong> さんがあなたのメッセージに 🔥炎 の魔法を付けました</>), ctx: "新オフィスのレイアウト改善 / アイデア「集中ブース設置」" },
  { id: 12, type: "secdev", unread: true, group: "today", time: "6時間前", body: (<><strong>新しい端末</strong>からログインがありました</>), ctx: "2026-08-02 08:12 ・ IP 203.0.113.42 ・ Chrome / Windows（東京）", tag: "セキュリティ" },
  { id: 13, type: "secpw", unread: false, group: "yesterday", time: "昨日 09:40", body: (<><strong>パスワードが変更されました</strong>。心当たりがなければ管理者に連絡してください</>), ctx: "メールでもお知らせしています", tag: "セキュリティ" },
  { id: 6, type: "eval", unread: false, group: "yesterday", time: "昨日 18:20", body: (<>フォロー中のアイデアに <strong>新しい評価</strong>がつきました</>), ctx: "社内ナレッジ検索AI / アイデア「社内用語の自動リンク」" },
  { id: 7, type: "select", unread: false, group: "yesterday", time: "昨日 14:05", body: (<>あなたのアイデアが <strong>選定</strong>されました</>), ctx: "社内ナレッジ検索AI / アイデア「FAQ自動生成」", gain: (<><span className="xp">＋200 XP</span> <span className="coin">◆42</span></>) },
  { id: 8, type: "comment", unread: false, group: "yesterday", time: "昨日 11:30", body: (<>フォロー中のアイデアに <strong>新しいコメント</strong>がつきました</>), ctx: "配送ルート最適化 / アイデア「夜間配送の集約」" },
  { id: 9, type: "achievement", unread: false, group: "earlier", time: "7/16", body: (<>実績 <strong>「レベル5」</strong>（シルバー）を獲得しました</>), ctx: "Lv5 到達", gain: (<span className="coin">◆50</span>) },
  { id: 10, type: "mention", unread: false, group: "earlier", time: "7/15", body: (<><strong>佐藤 大輔</strong> さんがチャットであなたをメンションしました</>), ctx: "配送ルート最適化 / アイデア「置き配の写真通知」" },
  { id: 11, type: "eval", unread: false, group: "earlier", time: "7/14", body: (<>フォロー中のアイデアが <strong>評価中</strong>になりました</>), ctx: "新オフィスのレイアウト改善 / アイデア「集中ブース設置」" },
];

export function NotificationsView() {
  const [notifs, setNotifs] = useState<Notif[]>(INITIAL);
  const [fState, setFState] = useState<"" | "unread">("");
  const [fType, setFType] = useState<string>("");

  const unreadCount = notifs.filter((n) => n.unread).length;

  const filtered = useMemo(
    () => notifs.filter((n) => {
      if (fState === "unread" && !n.unread) return false;
      if (fType && CAT[n.type] !== fType) return false;
      return true;
    }),
    [notifs, fState, fType],
  );

  const setUnread = (id: number, unread: boolean) => setNotifs((xs) => xs.map((n) => (n.id === id ? { ...n, unread } : n)));
  const markAll = () => setNotifs((xs) => xs.map((n) => ({ ...n, unread: false })));

  function Row({ n }: { n: Notif }) {
    const href = HREF[n.type];
    const inner = (
      <>
        <span className="n__ico">{ICO[n.type]}</span>
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
          <div className="n__ctx">{n.ctx}</div>
          {n.gain && <div className="n__gain">{n.gain}</div>}
        </div>
        <div className="n__right">
          <span className="n__time">{n.time}</span>
          <span className="n__dot" aria-hidden="true" />
          <button
            className="n__read"
            type="button"
            title={n.unread ? "既読にする" : "未読に戻す"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setUnread(n.id, !n.unread);
            }}
          >
            {n.unread ? "既読にする" : "未読に戻す"}
          </button>
        </div>
      </>
    );
    const cls = `n${n.unread ? " is-unread" : ""}`;
    // 参照先あり＝Link（クリックで既読化してから遷移）／セキュリティ＝遷移せず既読化のみ。
    return href ? (
      <Link className={cls} href={href} onClick={() => setUnread(n.id, false)}>
        {inner}
      </Link>
    ) : (
      <div
        className={cls}
        role="button"
        tabIndex={0}
        onClick={() => setUnread(n.id, false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setUnread(n.id, false);
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
            <select className="select" value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">すべて</option>
              <option value="mention">メンション</option>
              <option value="comment">コメント</option>
              <option value="eval">評価</option>
              <option value="select">選定</option>
              <option value="update">アイデア更新</option>
              <option value="achievement">実績</option>
              <option value="magic">魔法</option>
              <option value="security">セキュリティ</option>
            </select>
          </label>
        </div>
        <div className="tools">
          <span className="list-count">{unreadCount} 件の未読</span>
          <button className="btn btn-outline" type="button" onClick={markAll}>
            すべて既読にする
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="list-empty">該当する通知はありません。</div>
      ) : (
        GROUP_ORDER.map((g) => {
          const items = filtered.filter((n) => n.group === g);
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
        種別＝メンション／自分のアイデアへのコメント／フォロー中アイデアの新規コメント・評価・選定／投票済み・フォロー中アイデアの<strong>更新</strong>／実績獲得／魔法リアクション／<strong>🛡️セキュリティ（新しい端末・パスワード変更）</strong>。セキュリティ通知は本人宛で、オフにできません（パスワード変更はメールでもお知らせします）。
      </p>
    </main>
  );
}
