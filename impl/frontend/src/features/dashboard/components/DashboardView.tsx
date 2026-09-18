"use client";

// SC-01 ダッシュボード（ゲーム層ヒーロー＋週間ランキング＋下書き/未投票/参加中/フォロー中/下段）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-01_ダッシュボード.html（DoD＝モック一致）。
// 実接続＝I 集約 `GET /dashboard`（1往復で全パネル）。ヒーローの初期値は server の GET /me 残高（初回描画）で、
// 取得後は集約 hero を優先。クイック投票＝POST /ideas/{id}/vote・フォロー★＝D follow EP。空パネルは非表示（§7）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { markNotificationRead, markRead, notificationHref } from "@/features/notifications/api";
import { timeLabel } from "@/features/notifications/time";
import Image from "next/image";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Avatar, CountUp, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { DashboardFx, type DashboardFxHandle } from "./DashboardFx";
import { getTeamFeed } from "@/features/feed/api";
import { ActivityFeed } from "@/features/feed/components/ActivityFeed";
import { LevelUpWatcher } from "./LevelUpWatcher";
import { bumpedXpPct } from "../xpAward";
import { levelRank } from "@/lib/levelTitle";
import { isMotionReduced } from "@/lib/motion";
import { useScrollRestore } from "@/lib/scrollRestore";
import { realtime } from "@/lib/realtime";
import { deadlineUrgency, deadlineCountdown, todayISO } from "@/lib/deadline";
import { greetingFor } from "@/lib/greeting";
import { markChatFromDashboard } from "@/lib/nav";
import { followIdea, unfollowIdea, voteIdea, type IdeaVoteType } from "@/features/ideas/api";
import { unfollowQuest } from "@/features/quests/api";
import { voteErrorMessage } from "@/features/ideas/voteError";
import { EVALUATIONS_CHANGED_EVENT } from "@/features/evaluations";
import {
  getDashboard,
  type DashboardData,
  type FollowedIdea,
  type UnvotedIdea,
} from "../api";
import { JoinRequestDialog, type JoinRequestQuestSummary } from "@/features/quests";
import type { JoinRequestRow } from "@/features/quests/api";
import "../dashboard.css";

type Balance = {
  level: number; xpPct: number; xpToNext: number;
  xpInLevel: number; levelSpan: number; xp: number;
  coin: number; sp: number;
};

// 旧ショートカットタイル（TILES）はグローバルナビ（☰→ドロワー・レビュー#1）へ集約したため撤去（画面遷移図 §4 集約 2026-09-10）。

function hrefOfDraft(d: DashboardData["drafts"][number]): string {
  // 下書きは「続きを編集」導線＝編集ダイアログをダッシュボード上に重ねて開く（Parallel+Intercept・詳細へフル遷移しない）。
  // クエスト＝編集モーダル／アイデア＝編集モーダル／評価＝評価モーダル（いずれも intercepting route）。
  if (d.kind === "quest") return `/quests/${d.quest_id}/edit`;
  if (d.kind === "idea") return `/ideas/${d.idea_id}/edit`;
  return `/ideas/${d.idea.id}/eval`;
}

// SSR で警告を出さない isomorphic layout effect（client では useLayoutEffect＝FLIP のちらつき防止）。
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function DashboardView({
  displayName,
  accountId,
  balance,
  gameEnabled = true,
}: {
  displayName: string;
  accountId: string;
  balance: Balance;
  // ゲームモード実効値（レビュー#2・§4.11）。false でヒーロー/週間ランキング（ゲーム層）を非表示。
  // 業務パネル（下書き/未投票/参加中/フォロー中）は残す。既定 true（現行挙動）。
  gameEnabled?: boolean;
}) {
  const snackbar = useSnackbar();
  const [data, setData] = useState<DashboardData | null>(null);
  // 一覧のスクロール位置復元（§4.12）＝取得完了（data!==null）でコンテンツ実寸になってから復元。
  useScrollRestore(data !== null);
  // 未投票の表示リストはローカルで持つ（投票で1件除去→サーバー再取得で末尾に次の1件を追記＝常に満杯を保つ）。
  const [unvotedList, setUnvotedList] = useState<UnvotedIdea[] | null>(null);
  const [unfollowed, setUnfollowed] = useState<Record<string, boolean>>({});
  const [unfollowedQuests, setUnfollowedQuests] = useState<Record<string, boolean>>({}); // §4.6b ★解除の即時反映
  const bonusShown = useRef(false);
  // XP バーはマウント後に 0→現在値へ充填（CSS transition で演出・ゲーム感）。
  const [barFilled, setBarFilled] = useState(false);
  useEffect(() => setBarFilled(true), []);
  // #31: 時間帯の挨拶（E 時間/環境）。SSR/クライアントの時刻差でのハイドレーション不一致を避けるため mount 後に算出。
  const [greet, setGreet] = useState<{ text: string; date: string } | null>(null);
  useEffect(() => {
    const d = new Date();
    setGreet({ text: greetingFor(d.getHours()), date: d.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" }) });
  }, []);
  // GF-AC-040: 投票カードは framer-motion で「ふわっと退場（fade）＋残りカードの繰り上がりを滑らかに移動（layout）」。
  // 退場中は popLayout で流れから外し、残りが同時にスライドして詰まる＝火花が空スペースに残らない。
  // reduce-motion（OS＋ユーザー設定 accounts.reduce_motion）時は演出なし＝即時入替。
  const osReduce = useReducedMotion();
  const [userReduce, setUserReduce] = useState(false);
  useEffect(() => { setUserReduce(document.querySelector('[data-anim-reduced="true"]') !== null); }, []);
  const reduceAnim = isMotionReduced(!!osReduce, userReduce);
  // 火花/XPフロートは DashboardFx（別 state）に委譲＝時間差消去（650ms/1100ms）で本コンポーネントを
  // 再描画させない＝繰り上がり完了後に再計測されてカードが再ゆれするのを防ぐ（GF-AC-040）。
  const fxRef = useRef<DashboardFxHandle>(null);
  // GF-AC-040: 投票カードの繰り上がりを手組み FLIP（First-Last-Invert-Play）で実現。
  // 投票＝即座に配列から除外（＝ずれない「即時削除」）→残りカードだけ WAAPI で旧位置→新位置へスライド。
  // WAAPI は終了後に transform を残さない＝ドリフトしない。位置は offset 基準＝スクロール非依存。
  // absolute 化はしない（それがビューポート上部の DOM を変えてスクロール補正＝下ずれを誘発していたため）。
  const voteCardEls = useRef<Map<string, HTMLElement>>(new Map());
  const voteRects = useRef<Map<string, { top: number; left: number }>>(new Map());
  useIsoLayoutEffect(() => {
    const els = voteCardEls.current;
    const prev = voteRects.current;
    const next = new Map<string, { top: number; left: number }>();
    els.forEach((el, id) => next.set(id, { top: el.offsetTop, left: el.offsetLeft }));
    if (!reduceAnim) {
      next.forEach((last, id) => {
        const first = prev.get(id);
        if (!first) return;                   // 新規カードはスライドさせない
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (dx || dy) {
          els.get(id)?.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
            { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" },
          );
        }
      });
    }
    voteRects.current = next;   // 現在位置を次回の First として保存（消えた id は自然に除去）
  });
  // #8 獲得フィードバック（段階ハイブリッド step1）＝投票が XP 付与された時のみ「+5 XP」を出し、
  // ヒーロー XP バーを楽観的に +5 分だけ前進＋pulse（連動）。金額 +5 は暫定（xpAward.VOTE_XP）。
  const [xpBump, setXpBump] = useState(0);       // 読み込み後に付与された XP の累積（楽観・server 権威は次ロードで整合）
  const [awardKey, setAwardKey] = useState(0);   // バー pulse を確実に再生させる再マウントキー
  // チームアクティビティ（SC-01 §4.8b・FR-36・参加クエスト横断の公開種別のみ）。
  const loadTeamFeed = useCallback((cursor?: string | null) => getTeamFeed(cursor), []);

  useEffect(() => {
    let alive = true;
    void getDashboard().then((d) => {
      if (!alive || !d) return;
      setData(d);
      setUnvotedList(d.unvoted_ideas ?? []);
      // ゲームモード OFF（§4.11）ではログインボーナス（XP獲得）の演出トーストを出さない（backend の付与は据え置き）。
      if (gameEnabled && d.login_bonus && !bonusShown.current) {
        bonusShown.current = true;
        snackbar({ type: "reward", title: "デイリーログインボーナス！",
                   rewards: [{ k: "xp", t: `+${d.login_bonus.xp}` }], icon: "🎁" });
      }
    });
    return () => { alive = false; };
  }, [snackbar, gameEnabled]);

  // 評価確定（別ルートの評価モーダル）後にダッシュボードを再取得＝**下書きの評価**が消える（確定済みは下書きに出ない）。
  // data のみ差し替え＝unvotedList（継続投票の補充 state）には触れない（GF-AC-043 を壊さない）。
  useEffect(() => {
    const onEval = () => { void getDashboard().then((d) => { if (d) setData(d); }); };
    window.addEventListener(EVALUATIONS_CHANGED_EVENT, onEval);
    return () => window.removeEventListener(EVALUATIONS_CHANGED_EVENT, onEval);
  }, []);

  // リアルタイム（L・notification.created）で「最近の通知」を追随更新＝ヘッダーのベル（LiveAppHeader）との体感を揃える。
  // 真実は REST（GET /dashboard を再取得）。data のみ差し替え＝unvotedList は触らない（GF-AC-043 を壊さない）。
  useEffect(() => {
    realtime.start();
    const off = realtime.on("notification.created", () => { void getDashboard().then((d) => { if (d) setData(d); }); });
    return () => off();
  }, []);

  // ヒーロー＝集約 hero を優先、未取得は server の /me 残高で初回描画。
  const hero = data?.hero;
  const level = hero?.level ?? balance.level;
  const xpToNext = hero?.xp_to_next ?? balance.xpToNext;
  const levelSpan = hero?.level_span ?? balance.levelSpan;
  const xpInLevel = hero ? hero.level_span - hero.xp_to_next : balance.xpInLevel;
  // #8: 楽観 XP（xpBump）を上乗せしたバー値（現レベル内でクランプ＝レベルアップは詐称しない）。
  const xpInLevelLive = Math.min(levelSpan, xpInLevel + xpBump);
  const xpPct = bumpedXpPct(xpInLevel, levelSpan, xpBump);
  const xpTotal = (hero?.xp ?? balance.xp) + xpBump;
  const coin = hero?.coin_balance ?? balance.coin;
  const sp = hero?.skill_point_balance ?? balance.sp;
  const rank = levelRank(level); // #21: レベル→称号/ティア（オーラ色）
  const today = todayISO(); // #24: 締切切迫度の基準日

  const drafts = data?.drafts ?? [];
  const unvoted = unvotedList ?? [];
  const quests = data?.quests ?? [];
  // 「自分のクエスト」（作成/運営）を参加中と分離（ユーザー要望・2026-09-16）。is_owner は backend が付与。
  const ownQuests = quests.filter((q) => q.is_owner);
  const joinedQuests = quests.filter((q) => !q.is_owner);
  const renderQuestCard = (q: DashboardData["quests"][number]) => {
    const du = deadlineUrgency(q.deadline, today); // #24: 締切の切迫度
    return (
      <Link key={q.id} className="card card-accent quest-card" href={`/quests/${q.id}`} style={{ ["--accent" as string]: q.color ?? "#3B82F6" } as React.CSSProperties}>
        <div className="between">
          <span className="card-title">{q.title}</span>
          <span className="badge">{q.status}</span>
        </div>
        <div className="quest-card__meta">
          {(q.categories ?? []).slice(0, 1).map((c) => <span key={c} className="badge badge-muted">{c}</span>)}
          {q.deadline && <span className="deadline" data-urgency={du.level}>⏳ {q.deadline}{du.level !== "safe" && du.level !== "none" ? ` ・${deadlineCountdown(du.days)}` : ""}</span>}
        </div>
        <div className="quest-card__stats">
          <span>👥 パーティー{q.member_count ?? 0}</span>
          <span>💡 アイデア{q.idea_count ?? 0}</span>
        </div>
      </Link>
    );
  };
  const followed = (data?.followed_ideas ?? []).filter((f) => !unfollowed[f.id]);
  // §4.6b フォロー中のクエスト（★解除は即時にリストから外す）／§4.6c 参加リクエスト状況。
  const followedQuests = (data?.followed_quests ?? []).filter((q) => !unfollowedQuests[q.id]);
  const joinRequests = data?.join_requests ?? [];
  // 未処理の受信参加リクエスト（owner/quest_admin）＝処理済みは即リストから外す（楽観）。
  const [processedIncoming, setProcessedIncoming] = useState<Record<string, boolean>>({});
  const incomingJoinRequests = (data?.incoming_join_requests ?? []).filter(
    (it) => !processedIncoming[`${it.quest.id}:${it.user.user_id}`],
  );
  const [incomingSel, setIncomingSel] = useState<{ questId: string; request: JoinRequestRow; quest: JoinRequestQuestSummary } | null>(null);
  const [incomingOpen, setIncomingOpen] = useState(false);
  const openIncoming = (it: NonNullable<DashboardData["incoming_join_requests"]>[number]) => {
    setIncomingSel({
      questId: it.quest.id,
      request: {
        user: {
          user_id: it.user.user_id,
          display_name: it.user.display_name,
          avatar_image_url: it.user.avatar_image_url ?? null,
          group_ids: [],
        },
        status: "pending",
        message: it.message ?? null,
        created_at: it.created_at ?? new Date().toISOString(),
      },
      quest: { title: it.quest.title, status: it.quest.status, color: it.quest.color, categories: it.quest.categories, deadline: it.quest.deadline },
    });
    setIncomingOpen(true);
  };
  const onIncomingDecided = (userId: string) => {
    if (incomingSel) setProcessedIncoming((m) => ({ ...m, [`${incomingSel.questId}:${userId}`]: true }));
    void getDashboard().then((d) => { if (d) setData(d); });
  };
  const unfollowQuestCard = async (id: string) => {
    setUnfollowedQuests((m) => ({ ...m, [id]: true })); // 楽観
    const res = await unfollowQuest(id).catch(() => null);
    if (!res) {
      setUnfollowedQuests((m) => ({ ...m, [id]: false }));
      snackbar({ type: "error", msg: "フォロー解除に失敗しました。" });
    }
  };
  const JR_LABEL: Record<string, string> = { pending: "申請中", rejected: "却下" };
  const ranking = data?.weekly_ranking;
  const notifs = data?.notifications?.data ?? [];
  const unreadChats = data?.unread_chats ?? [];  // 💬 新着の議論（参加クエスト横断・自分の未読チャット）

  // 最近の通知をクリック＝SC-02 と同様に既読化（楽観更新＋サーバー・未読数も減算）。realtime でベルも追随。
  const markNotifRead = (id: string, wasRead: boolean) => {
    if (wasRead) return;
    void markRead(id);
    setData((d) => (d?.notifications ? { ...d, notifications: markNotificationRead(d.notifications, id) } : d));
  };

  const quickVote = async (idea: UnvotedIdea, type: IdeaVoteType, e?: { clientX: number; clientY: number }) => {
    if (gameEnabled && e) fxRef.current?.burst(e);  // 押下の手応え（ゲーム層演出＝OFFでは出さない・§4.11）
    // 楽観＝即座にリストから除外（＝ずれない「即時削除」と同じ土台）。残りカードは FLIP effect が
    // 旧位置→新位置へスライド（absolute 化しない＝ドリフトの原因を排除）。
    setUnvotedList((l) => (l ?? []).filter((v) => v.id !== idea.id));
    let res: Awaited<ReturnType<typeof voteIdea>> = null;
    let voteErr: unknown = null;
    try { res = await voteIdea(idea.id, type); } catch (e) { voteErr = e; }
    if (!res) {
      // 失敗はロールバック（元の位置に戻す）＋理由を明示（締切後/完了/権限など・サーバー detail）
      setUnvotedList((l) => { const cur = l ?? []; return cur.some((v) => v.id === idea.id) ? cur : [idea, ...cur]; });
      snackbar({ type: "error", title: "投票できませんでした", msg: voteErrorMessage(voteErr) });
      return;
    }
    // #8: server が実際に付与した XP 差分（res.xp_delta＝初回・日次上限内なら +5・それ以外 0）でフィードバック。
    // 金額の正はサーバー（step2 で backend delta に一本化＝frontend 定数を撤去）。
    if (gameEnabled && res.xp_delta > 0) {  // XP フィードバック（ゲーム層演出）＝OFFでは出さない（§4.11）
      setXpBump((x) => x + res.xp_delta);
      setAwardKey((k) => k + 1);
      if (e) fxRef.current?.xpFloat(e, `+${res.xp_delta} XP`);
    }
    // 継続投票：1件投票するたびにサーバーから次の未投票を取得し、まだ表示していないものを末尾に追記
    // （6→5 になったら6個目を末尾に補充）。サーバーが未投票を返さなくなれば末尾に何も足さず終了。
    const d = await getDashboard().catch(() => null);
    if (d) {
      setUnvotedList((l) => {
        const cur = l ?? [];
        const have = new Set(cur.map((v) => v.id));
        const add = (d.unvoted_ideas ?? []).filter((n) => !have.has(n.id));
        return add.length ? [...cur, ...add] : cur;
      });
    }
  };

  const toggleFollow = async (f: FollowedIdea) => {
    setUnfollowed((s) => ({ ...s, [f.id]: true }));  // 楽観＝解除でリストから外す
    const res = await unfollowIdea(f.id).catch(() => "err");
    if (res === "err") {
      setUnfollowed((s) => { const n = { ...s }; delete n[f.id]; return n; });
      snackbar({ type: "error", msg: "フォロー解除に失敗しました。" });
    }
  };

  // 主要フローコンテナ共通の framer 設定：マウント時のみの opacity フェード登場（旧 CSS dash-enter を置換・load 限定）。
  // 位置/サイズは固定＝透明度だけふわっと（layout アニメは使わない＝投票時の上下チラつきを避ける）。
  // 常に animate:opacity=1 を持たせる（reduce 検知が初回 null→true に切替わっても opacity 0 で固定されないように）。
  // reduce-motion 時は initial=false＋duration=0＝即表示（演出なし）。
  const flowMotion = (i: number) => ({
    initial: reduceAnim ? false : { opacity: 0 },
    animate: { opacity: 1 },
    transition: reduceAnim ? { duration: 0 } : { duration: 0.3, ease: "easeOut", delay: Math.min(i, 6) * 0.05 },
  });

  return (
    <div className="dash-page stack">
      {/* レベルアップ祝福（ゲーム層演出）＝ゲームモード OFF では出さない（§4.11・レビュー#2）。 */}
      {gameEnabled && <LevelUpWatcher accountId={accountId} level={level} />}
      <DashboardFx ref={fxRef} />
      {/* #31: 時間帯の挨拶（mount 後に算出＝ハイドレーション不一致回避） */}
      {greet && <motion.div className="dash-greeting" {...flowMotion(0)}>{greet.text}、{hero?.display_name ?? displayName} さん ・ {greet.date}</motion.div>}
      {/* 並び順（ユーザー要望・2026-09-15）＝新着の議論 → チームアクティビティ＋最近の通知 → 未投票 → フォロー中 → 下書き → 参加中クエスト。
          ヒーロー＋週間ランキング（ゲーム層）は §4.11 で最下部（2026-09-13）。空パネルは §7 で非表示。 */}

      {/* 💬 新着の議論（レビュー#3）＝参加クエスト横断で自分の未読チャット（他ユーザー投稿）があるアイデア。
          通知（自分宛のみ）が拾わない「他ユーザー同士の会話」に気付いてチャットへ直行。**常設**（未読ゼロは空状態）。 */}
      <motion.section className="card" aria-label="新着の議論" {...flowMotion(1)}>
        <div className="section-head">
          <h2 style={{ fontSize: "var(--text-lg)" }}>💬 新着の議論</h2>
          {unreadChats.length > 0 && (
            <span className="unread-panel__n">{unreadChats.reduce((s, c) => s + c.unread_chat_count, 0)} 件の未読</span>
          )}
        </div>
        {unreadChats.length > 0 ? (
          <ul className="unread-list">
            {unreadChats.map((c) => (
              <li key={c.id}>
                <Link className="unread-item" href={`/ideas/${c.id}/chat`} onClick={() => markChatFromDashboard()}>
                  <QuestIcon name={c.title} color={c.quest.color ?? undefined} size="xs" />
                  <span className="unread-item__title">{c.title}</span>
                  <span className="unread-item__quest">🎯 {c.quest.title}</span>
                  <span className="badge badge-danger">💬 +{c.unread_chat_count}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted text-sm" style={{ margin: "var(--space-2) 0 0" }}>未読のチャットはありません。参加クエストで他のメンバーの新しい投稿があるとここに表示されます。</p>
        )}
      </motion.section>

      {/* 下段：チームアクティビティ＋最近の通知の2段組（横並び・情報量に合わせて幅を分割・レビュー寄り道）。
          チームアクティビティ＝SC-01 §4.8b・FR-36（参加クエスト横断の場の活動）／最近の通知＝自分宛（別物）。 */}
      <motion.div className="dash-bottom" {...flowMotion(2)}>
        <section className="card" aria-label="チームアクティビティ">
          <ActivityFeed title="チームアクティビティ" load={loadTeamFeed} showQuest emptyText="参加中クエストの新しい活動はまだありません。" />
        </section>

        <section className="card" aria-label="最近の通知">
          <div className="section-head">
            <h2 style={{ fontSize: "var(--text-lg)" }}>最近の通知</h2>
            <Link href="/notifications">すべての通知 →</Link>
          </div>
          <ul className="notif-list">
            {notifs.length === 0 && <li className="muted text-sm">新しい通知はありません</li>}
            {notifs.map((n) => {
              const href = notificationHref(n);
              // 件名＝body（参照先があればリンク）。メッセージ＝context はパネル全幅で下に表示（ユーザー要望）。
              const title = href ? (
                <Link className="notif-subject" href={href} onClick={() => markNotifRead(n.id, n.is_read)}>{n.body}</Link>
              ) : <span className="notif-subject">{n.body}</span>;
              return (
                <li key={n.id} className={n.is_read ? undefined : "unread"}>
                  <span className="notif-ico">{n.icon ?? "🔔"}</span>
                  <div className="notif-body">
                    <div className="notif-head">
                      {title}
                      {/* 通知日時（相対ラベル・SC-02 と同フォーマット＝`timeLabel`・ユーザー要望）。 */}
                      <span className="notif-time muted">{timeLabel(n.created_at)}</span>
                      {/* 未読のみ「既読にする」を件名の横に（参照先を開かず既読化＝SC-02 の n__read と同趣旨）。 */}
                      {!n.is_read && (
                        <button
                          className="notif-read"
                          type="button"
                          title="既読にする"
                          // マウス押下でフォーカスを取らせない＝sticky 下の行でのフォーカス可視化スクロールを防ぐ（§4.12 と同趣旨）。
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); markNotifRead(n.id, false); }}
                        >既読にする</button>
                      )}
                    </div>
                    {n.context && <div className="notif-ctx muted">{n.context}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

      </motion.div>

      {/* 未投票のアイデア（0件なら非表示） */}
      {unvoted.length > 0 && (
        <motion.section aria-label="未投票のアイデア" {...flowMotion(3)}>
          <div className="section-head">
            <h2>未投票のアイデア</h2>
            <span className="muted text-sm">参加クエストで、あなたがまだ投票していないアイデア</span>
          </div>
          <div className="vote-grid">
            {/* GF-AC-040: 投票カードの繰り上がりは手組み FLIP（上の useIsoLayoutEffect）。
                投票＝即座に配列から除外→残りカードだけ WAAPI で旧位置→新位置へスライド（ドリフトしない）。reduce-motion 時は即時。 */}
            {unvoted.map((v) => (
                <article
                  key={v.id}
                  ref={(el) => { if (el) voteCardEls.current.set(v.id, el); else voteCardEls.current.delete(v.id); }}
                  className="card card-accent vote-card"
                >
                  <div className="between">
                    <span className="idea-title-row">
                      <QuestIcon name={v.title} color={v.quest.color} imageUrl={v.icon_image_url} size="sm" />
                      <Link className="card-title" href={`/ideas/${v.id}`}>{v.title}</Link>
                    </span>
                    <span className="badge badge-muted">未投票</span>
                  </div>
                  {/* クエスト名＝クエスト詳細への動線（SC-12）。 */}
                  <Link className="vote-card__quest vote-card__quest--link" href={`/quests/${v.quest.id}`}>{v.quest.title}</Link>
                  <div className="vote-card__value">{v.value}</div>
                  {/* 作成者名の横にチャット動線を統一配置（戻るはダッシュボード＝markChatFromDashboard でラベル出し分け）。 */}
                  <div className="vote-card__poster poster">
                    <Avatar name={v.poster.name} imageUrl={v.poster.avatar} size="sm" />
                    <span className="name text-sm muted">投稿: {v.poster.name}</span>
                    <Link className="dash-chat-link" href={`/ideas/${v.id}/chat`} onClick={() => markChatFromDashboard()}>💬 チャットで議論</Link>
                  </div>
                  <div className="vote-actions">
                    <button type="button" className="vote-quick agree" aria-label="賛成する" onClick={(e) => quickVote(v, "approve", e)}>▲ 賛成</button>
                    <button type="button" className="vote-quick disagree" aria-label="反対する" onClick={(e) => quickVote(v, "oppose", e)}>▼ 反対</button>
                  </div>
                </article>
            ))}
          </div>
        </motion.section>
      )}

      {/* フォロー中のアイデア（0件なら非表示） */}
      {followed.length > 0 && (
        <motion.section aria-label="フォロー中のアイデア" {...flowMotion(4)}>
          <div className="section-head">
            <h2>フォロー中のアイデア</h2>
            <span className="muted text-sm">動きがあると通知でお知らせ</span>
          </div>
          <div className="follow-grid">
            {/* GF-AC-341: フォロー解除は対象カードを opacity(+わずかに縮小)でフェード退場し、残りのフォローカードが滑らかに繰り上がる。
                mode="popLayout"＝退場開始と同時に対象を流れから外す（穴が残らない）／layout="position"＝残りが新位置へスライド。
                以前は layout 不使用でスナップ詰まり＝「単純に再表示」に見えて NG だった。reduce-motion 時は layout 無効＋即時。 */}
            <AnimatePresence initial={false} mode="popLayout">
            {followed.map((f) => {
              const frozen = f.quest.quest_status === "completed";
              return (
                <motion.div
                  key={f.id}
                  className="follow-card-wrap"
                  layout={reduceAnim ? false : "position"}
                  initial={reduceAnim ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceAnim ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.92, transition: { duration: 0.2, ease: "easeOut" } }}
                  transition={{ duration: reduceAnim ? 0 : 0.3, ease: "easeOut" }}
                >
                  {/* 未投票カードと同構造に統一＝カードは div、タイトルが詳細への Link。作成者行にチャット動線をインライン配置。
                      ★（フォロー解除）は Link 入れ子回避のため別要素（絶対配置・右上）。退場アニメは外側ラッパ（framer）。 */}
                  <div className={`card card-accent follow-card${frozen ? " is-frozen" : ""}`}>
                    <div className="card-title idea-title-row">
                      <QuestIcon name={f.title} color={f.quest.color} imageUrl={f.icon_image_url} size="sm" />
                      <Link className="idea-title-row__txt follow-card__titlelink" href={`/ideas/${f.id}`}>{f.title}</Link>
                    </div>
                    <div className="follow-quest">{f.quest.title}{frozen && <> <span className="badge badge-muted" title="クエスト完了で凍結。以後の通知はありません（解除のみ可・再フォロー不可）">⏸ 完了（凍結）</span></>}</div>
                    <div className="follow-value">{f.value}</div>
                    <div className="follow-card__poster poster">
                      <Avatar name={f.poster.name} imageUrl={f.poster.avatar} size="sm" />
                      <span className="name text-sm muted">投稿: {f.poster.name}</span>
                      <Link className="dash-chat-link" href={`/ideas/${f.id}/chat`} onClick={() => markChatFromDashboard()}>💬 チャットで議論</Link>
                    </div>
                    <div className="follow-stats">
                      <span className="vote-agree">▲ {f.vote_summary.approve}</span>
                      <span className="vote-disagree">▼ {f.vote_summary.oppose}</span>
                    </div>
                    {frozen && <div className="follow-frozen-note text-xs muted">⏸ 完了済み＝以後の通知なし。★で<strong>解除</strong>のみ可（再フォロー不可）。</div>}
                  </div>
                  <button type="button" className="follow-star" aria-pressed={true} aria-label="フォロー解除" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(f); }}>★</button>
                </motion.div>
              );
            })}
            </AnimatePresence>
          </div>
        </motion.section>
      )}

      {/* 下書き（1件も無ければ非表示） */}
      {drafts.length > 0 && (
        <motion.section aria-label="下書き" {...flowMotion(5)}>
          <div className="section-head">
            <h2>下書き</h2>
            <span className="muted text-sm">あなただけに表示（公開/投稿するまで非公開）</span>
          </div>
          <div className="draft-grid">
            {drafts.map((d, i) => (
              <Link key={i} className="card card-accent draft-card" href={hrefOfDraft(d)}>
                <div className="draft-card__head">
                  <span className="badge badge-draft">下書き</span>
                  <span className="badge badge-muted">{d.kind === "quest" ? "クエスト" : d.kind === "idea" ? "アイデア" : "⭐ 評価"}</span>
                </div>
                <div className="draft-card__title">{d.kind === "evaluation" ? d.idea.title : d.title}</div>
                <div className="draft-card__meta">
                  {d.kind === "idea" && <span>{d.quest.title}</span>}
                  {d.kind === "evaluation" && <><span>{d.quest?.title}</span><span>採点 {d.progress.scored}/{d.progress.total} 観点</span></>}
                  {d.kind === "quest" && d.categories.map((c) => <span key={c}>{c}</span>)}
                </div>
                <div className="draft-card__cta">{d.kind === "evaluation" ? "採点を続ける ✎" : "続きを書く ✎"}</div>
              </Link>
            ))}
          </div>
        </motion.section>
      )}

      {/* 自分のクエスト（作成/運営・0件なら非表示・ユーザー要望で参加中と分離） */}
      {ownQuests.length > 0 && (
        <motion.section aria-label="自分のクエスト" {...flowMotion(6)}>
          <div className="section-head">
            <h2>自分のクエスト</h2>
            <Link href="/quests">すべて見る →</Link>
          </div>
          <div className="quest-grid">{ownQuests.map(renderQuestCard)}</div>
        </motion.section>
      )}

      {/* 参加中クエスト（他者作成で参加・0件なら非表示） */}
      {joinedQuests.length > 0 && (
        <motion.section aria-label="参加中クエスト" {...flowMotion(7)}>
          <div className="section-head">
            <h2>参加中クエスト</h2>
            <Link href="/quests">すべて見る →</Link>
          </div>
          <div className="quest-grid">{joinedQuests.map(renderQuestCard)}</div>
        </motion.section>
      )}

      {/* 未処理の参加リクエスト（自分が owner/quest_admin・0件なら非表示・FR-40）＝カードクリックで承認/却下ダイアログ。 */}
      {incomingJoinRequests.length > 0 && (
        <motion.section aria-label="未処理の参加リクエスト" {...flowMotion(7)}>
          <div className="section-head">
            <h2>未処理の参加リクエスト<span className="badge badge-danger" style={{ marginLeft: "var(--space-2)" }}>{incomingJoinRequests.length}</span></h2>
          </div>
          <div className="quest-grid">
            {incomingJoinRequests.map((it) => (
              <button
                key={`${it.quest.id}:${it.user.user_id}`}
                type="button"
                className="card card-accent quest-card incoming-jr-card"
                style={{ ["--accent" as string]: it.quest.color ?? "#3B82F6" } as React.CSSProperties}
                onClick={() => openIncoming(it)}
              >
                <div className="between">
                  <span className="card-title">{it.quest.title}</span>
                  <span className="badge badge-danger">未処理</span>
                </div>
                <div className="incoming-jr-card__applicant">
                  <Avatar name={it.user.display_name} imageUrl={it.user.avatar_image_url ?? undefined} size="sm" noTooltip />
                  <span className="incoming-jr-card__name">{it.user.display_name} さんが参加を希望</span>
                </div>
                {it.message && <p className="incoming-jr-card__msg">{it.message}</p>}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      {/* §4.6b フォロー中のクエスト（非参加・watch・0件なら非表示・FR-40）＝メタカード。カードは発見カタログへ・★で解除。 */}
      {followedQuests.length > 0 && (
        <motion.section aria-label="フォロー中のクエスト" {...flowMotion(7)}>
          <div className="section-head">
            <h2>フォロー中のクエスト</h2>
            <Link href="/quest-catalog">クエストを探す →</Link>
          </div>
          <div className="quest-grid">
            {followedQuests.map((q) => {
              const du = deadlineUrgency(q.deadline ?? null, today);
              return (
                <Link key={q.id} className="card card-accent quest-card" href="/quest-catalog" style={{ ["--accent" as string]: q.color ?? "#3B82F6" } as React.CSSProperties}>
                  {/* ★＝フォロー中（クリックで解除）＝発見カタログのカードと同方針（.follow-star）。 */}
                  <button type="button" className="follow-star" style={{ position: "absolute", top: "var(--space-2)", right: "var(--space-2)", zIndex: 1 }}
                    aria-pressed={true} aria-label="フォロー解除" title="フォロー中（クリックで解除）"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void unfollowQuestCard(q.id); }}>★</button>
                  <div className="between">
                    <span className="card-title">{q.title}</span>
                    <span className="badge">{q.status}</span>
                  </div>
                  <div className="quest-card__meta">
                    {(q.categories ?? []).slice(0, 1).map((c) => <span key={c} className="badge badge-muted">{c}</span>)}
                    {q.deadline && <span className="deadline" data-urgency={du.level}>⏳ {q.deadline}{du.level !== "safe" && du.level !== "none" ? ` ・${deadlineCountdown(du.days)}` : ""}</span>}
                  </div>
                  <div className="quest-card__stats">
                    <span>👥 パーティー{q.member_count ?? 0}</span>
                    <span>💡 アイデア{q.idea_count ?? 0}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* §4.6c 参加リクエストの状況（自分の申請・pending/rejected・0件なら非表示・FR-40）。 */}
      {joinRequests.length > 0 && (
        <motion.section aria-label="参加リクエストの状況" {...flowMotion(7)}>
          <div className="section-head">
            <h2>参加リクエストの状況</h2>
            <Link href="/quest-catalog">クエストを探す →</Link>
          </div>
          <div className="quest-grid">
            {joinRequests.map((q) => (
              <Link key={q.id} className="card card-accent quest-card" href="/quest-catalog" style={{ ["--accent" as string]: q.color ?? "#3B82F6" } as React.CSSProperties}>
                <div className="between">
                  <span className="card-title">{q.title}</span>
                  <span className={`badge ${q.my_state === "rejected" ? "badge-danger" : "badge-muted"}`}>{JR_LABEL[q.my_state ?? ""] ?? q.my_state}</span>
                </div>
                <div className="quest-card__stats">
                  <span>👥 パーティー{q.member_count ?? 0}</span>
                  <span>💡 アイデア{q.idea_count ?? 0}</span>
                </div>
              </Link>
            ))}
          </div>
        </motion.section>
      )}

      {/* 最下部：ヒーロー＋週間ランキング（ゲームモード OFF＝§4.11 で非表示・業務パネルは上段に残す・ユーザー要望で末尾へ移動）。 */}
      {gameEnabled && (
      <motion.div className="dash-top" {...flowMotion(6)}>
        <section className="pixel-panel hero" aria-label="あなたのステータス">
          <div className="hero__avatar" data-tier={rank.tier}>
            <Image src="/assets/mascot-hero.png" alt="あなたのアバター" width={88} height={88} />
          </div>
          <div className="hero__status">
            <div className="hero__name">{hero?.display_name ?? displayName}</div>
            <div className="hero__lvline">
              <span className="hero__lv">Lv.{level}</span>
              <span className="hero__title" data-tier={rank.tier}>{rank.title}</span>
              <span className="hero__next">NEXT {xpToNext} XP</span>
            </div>
            <div
              className="xp-bar-wrap has-tip"
              role="img"
              tabIndex={0}
              data-tip={`獲得 XP ${xpInLevelLive} / ${levelSpan}（累計 ${xpTotal}）`}
              aria-label={`獲得 XP ${xpInLevelLive} / ${levelSpan}、累計 ${xpTotal}`}
            >
              <div className="xp-bar">
                <span style={{ width: `${barFilled ? xpPct : 0}%` }} />
                {/* #8: 付与のたびに一瞬グロー（awardKey で再マウントして one-shot 再生・reduce-motion 無効） */}
                {awardKey > 0 && <i key={awardKey} className="xp-bar__pulse" aria-hidden />}
              </div>
            </div>
            <div className="hero__coin">
              <span className="pixel-stat coin">◆ <CountUp value={coin} /> コイン</span>
              <span className="pixel-stat skill">✦ SP <CountUp value={sp} /></span>
            </div>
          </div>
          <div className="hero__actions">
            <Link className="btn-pixel" href="/shop">ショップ</Link>
            <Link className="btn-pixel" href="/avatar">きせかえ</Link>
            <Link className="btn-pixel" href="/spells">魔法・スキル</Link>
          </div>
        </section>

        <section className="pixel-panel rank-panel" aria-label="週間ランキング">
          <h3>★ 週間ランキング ★</h3>
          <div className="rank-panel__sub">今週の獲得EXP＋コイン</div>
          <ol className="rank-list">
            {/* 読み込み前は 3行ぶんのスケルトンで枠高を確保＝データ到着時に高さがジャンプせずチラつかない。 */}
            {!data
              ? [0, 1, 2].map((i) => (
                  <li key={`rk-skel-${i}`} className="rank-skel-row" aria-hidden>
                    <span className="rank-medal">{["🥇", "🥈", "🥉"][i]}</span>
                    <span className="rank-skel rank-skel--avatar" />
                    <span className="rank-skel rank-skel--name" />
                    <span className="rank-skel rank-skel--score" />
                  </li>
                ))
              : (ranking?.data ?? []).slice(0, 3).map((r, i) => {
                  const me = ranking?.me?.rank === r.rank;
                  return (
                    <li key={r.user.id} className={me ? "is-me" : undefined}>
                      <span className="rank-medal" aria-label={`${i + 1}位`}>{["🥇", "🥈", "🥉"][i]}</span>
                      <Avatar name={r.user.name} imageUrl={r.user.avatar ?? undefined} size="sm" level={r.user.level} />
                      <span className="rank-name">{r.user.name}{me && <span className="rank-you">（あなた）</span>}</span>
                      <span className="rank-score"><span className="total">{r.score}</span><span className="brk"><span className="exp">EXP{r.xp}</span> <span className="coin">◆{r.coin}</span></span></span>
                    </li>
                  );
                })}
            {data && ranking && ranking.data.length === 0 && <li className="muted text-sm">今週の獲得はまだありません</li>}
          </ol>
          <div className="rank-panel__foot"><Link href="/ranking">ランキングをすべて見る →</Link></div>
        </section>
      </motion.div>
      )}
      {/* 管理導線はグローバルサイドバー（AppNav）へ集約（ダッシュボード下のリンク／右上メニューからは撤去）。 */}

      {/* 未処理の参加リクエスト＝承認/却下ダイアログ（クエスト詳細/通知と共有・FR-40）。 */}
      {incomingSel && (
        <JoinRequestDialog
          questId={incomingSel.questId}
          request={incomingSel.request}
          quest={incomingSel.quest}
          open={incomingOpen}
          onClose={() => setIncomingOpen(false)}
          onClosed={() => setIncomingSel(null)}
          onDecided={onIncomingDecided}
        />
      )}
    </div>
  );
}
