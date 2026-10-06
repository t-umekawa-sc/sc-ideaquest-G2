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

import { Avatar, CountUp, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
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
import { greetingFor } from "@/lib/greeting";
import { markChatFromDashboard } from "@/lib/nav";
import { followIdea, unfollowIdea, voteIdea, type IdeaVoteType } from "@/features/ideas/api";
import { followQuest, unfollowQuest } from "@/features/quests/api";
import { requestContestParticipation } from "@/features/contests/api";
import { ContestJoinRequestDialog } from "@/features/contests/components/ContestJoinRequestDialog";
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

// クエストのステータス日本語ラベル（SC-10/SC-12 と同一表記）。ダッシュボードのクエストカードで英語 status をそのまま出さない。
const QUEST_STATUS_LABEL: Record<string, string> = {
  draft: "下書き", recruiting: "募集中", in_progress: "進行中", evaluating: "評価中", completed: "完了",
};
const questStatusLabel = (s: string): string => QUEST_STATUS_LABEL[s] ?? s;
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

  const drafts = data?.drafts ?? [];
  const unvoted = unvotedList ?? [];
  const quests = data?.quests ?? [];
  // 参加中クエスト（他者作成で参加＝Zone E「参加中」）。自作クエスト(is_owner)はダッシュボードから撤去＝SC-10 一覧のスイッチへ移設（再設計 §6）。
  const joinedQuests = quests.filter((q) => !q.is_owner);
  const followed = (data?.followed_ideas ?? []).filter((f) => !unfollowed[f.id]);
  // §4.6b フォロー中のクエスト（★解除は即時にリストから外す・Zone E「フォロー中」へ集約）。
  const followedQuests = (data?.followed_quests ?? []).filter((q) => !unfollowedQuests[q.id]);
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
  // 未処理のコンテスト参加リクエスト（運営・FR-46）＝カードクリックで参加リクエストダイアログ（クエストと同型・処理済みは即リストから外す）。
  const [processedContest, setProcessedContest] = useState<Record<string, boolean>>({});
  const incomingContestRequests = (data?.incoming_contest_requests ?? []).filter(
    (it) => !processedContest[`${it.contest.id}:${it.user.user_id}`],
  );
  const [contestReqSel, setContestReqSel] = useState<DashboardData["incoming_contest_requests"][number] | null>(null);
  const [contestReqOpen, setContestReqOpen] = useState(false);
  const openContestReq = (it: DashboardData["incoming_contest_requests"][number]) => { setContestReqSel(it); setContestReqOpen(true); };
  const onContestDecided = (userId: string) => {
    if (contestReqSel) setProcessedContest((m) => ({ ...m, [`${contestReqSel.contest.id}:${userId}`]: true }));
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
  const ranking = data?.weekly_ranking;
  const notifs = data?.notifications?.data ?? [];
  const unreadChats = data?.unread_chats ?? [];  // 💬 新着の議論（参加クエスト横断・自分の未読チャット）
  const recentChats = data?.recent_chats ?? [];  // 🕒 最近の議論（更新順・既読/未読問わず・別動線）

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

  // ===== Zone B「あなたの番」＝未投票/承認待ち/下書きをタブ集約（ダッシュボード再設計 Phase1） =====
  const [bTab, setBTab] = useState<"vote" | "req" | "draft">("vote");
  const [bSeeAll, setBSeeAll] = useState<null | "vote" | "req" | "draft">(null);
  const [bSeeAllN, setBSeeAllN] = useState(15);
  // 承認待ち＝クエスト参加＋コンテスト参加を併合（表示は同型・クリックで各承認ダイアログ）。
  type PendingReq = { type: "quest"; it: DashboardData["incoming_join_requests"][number] }
                  | { type: "contest"; it: DashboardData["incoming_contest_requests"][number] };
  const pendingReqs: PendingReq[] = [
    ...incomingJoinRequests.map((it) => ({ type: "quest" as const, it })),
    ...incomingContestRequests.map((it) => ({ type: "contest" as const, it })),
  ];
  const bCounts = { vote: unvoted.length, req: pendingReqs.length, draft: drafts.length };
  const B_TITLE = { vote: "未投票のアイデア", req: "承認待ちの参加リクエスト", draft: "下書き" };
  const B_PANEL = 3;   // パネルの初期表示（§3.1）
  const bReqKey = (r: PendingReq) => r.type === "quest"
    ? `q:${r.it.quest.id}:${r.it.user.user_id}` : `c:${r.it.contest.id}:${r.it.user.user_id}`;

  const renderVoteCard = (v: DashboardData["unvoted_ideas"][number]) => (
    <article key={v.id}
      ref={(el) => { if (el) voteCardEls.current.set(v.id, el); else voteCardEls.current.delete(v.id); }}
      className="card card-accent vote-card">
      <div className="between">
        <span className="idea-title-row">
          <QuestIcon name={v.title} color={v.quest.color} imageUrl={v.icon_image_url} size="sm" />
          <Link className="card-title" href={`/ideas/${v.id}`}>{v.title}</Link>
        </span>
        <span className="badge badge-muted">未投票</span>
      </div>
      <Link className="vote-card__quest vote-card__quest--link" href={`/quests/${v.quest.id}`}>{v.quest.title}</Link>
      <div className="vote-card__value">{v.value}</div>
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
  );
  const renderReqCard = (r: PendingReq) => r.type === "quest" ? (
    <button key={bReqKey(r)} type="button" className="card card-accent quest-card incoming-jr-card"
      style={{ ["--accent" as string]: r.it.quest.color ?? "#3B82F6" } as React.CSSProperties}
      onClick={() => { setBSeeAll(null); openIncoming(r.it); }}>
      {/* 種別アイコン＋ラベルをカード上部に表示（クエスト/コンテストの判別・ユーザー要望）。未処理バッジは同行右。 */}
      <div className="incoming-jr-card__type between"><span className="badge badge-muted">📜 クエスト</span><span className="badge badge-danger">未処理</span></div>
      <div className="card-title">{r.it.quest.title}</div>
      <div className="incoming-jr-card__applicant"><Avatar name={r.it.user.display_name} imageUrl={r.it.user.avatar_image_url ?? undefined} size="sm" noTooltip /><span className="incoming-jr-card__name">{r.it.user.display_name} さんが参加を希望</span></div>
      {r.it.message && <p className="incoming-jr-card__msg">{r.it.message}</p>}
    </button>
  ) : (
    <button key={bReqKey(r)} type="button" className="card card-accent quest-card incoming-jr-card"
      onClick={() => { setBSeeAll(null); openContestReq(r.it); }}>
      <div className="incoming-jr-card__type between"><span className="badge badge-muted">🏆 コンテスト</span><span className="badge badge-danger">未処理</span></div>
      <div className="card-title">{r.it.contest.theme}</div>
      <div className="incoming-jr-card__applicant"><Avatar name={r.it.user.display_name} imageUrl={r.it.user.avatar_image_url ?? undefined} size="sm" noTooltip /><span className="incoming-jr-card__name">{r.it.user.display_name} さんが参加を希望</span></div>
    </button>
  );
  const renderDraftCard = (d: DashboardData["drafts"][number], i: number) => (
    <Link key={i} className="card card-accent draft-card" href={hrefOfDraft(d)}>
      <div className="draft-card__head"><span className="badge badge-draft">下書き</span><span className="badge badge-muted">{d.kind === "quest" ? "クエスト" : d.kind === "idea" ? "アイデア" : "⭐ 評価"}</span></div>
      <div className="draft-card__title">{d.kind === "evaluation" ? d.idea.title : d.title}</div>
      <div className="draft-card__meta">
        {d.kind === "idea" && <span>{d.quest.title}</span>}
        {d.kind === "evaluation" && <><span>{d.quest?.title}</span><span>採点 {d.progress.scored}/{d.progress.total} 観点</span></>}
        {d.kind === "quest" && d.categories.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="draft-card__cta">{d.kind === "evaluation" ? "採点を続ける ✎" : "続きを書く ✎"}</div>
    </Link>
  );
  const bHasAny = bCounts.vote + bCounts.req + bCounts.draft > 0;

  // ===== Zone D 見つける／Zone E マイ（ダッシュボード再設計 Phase1・§3）=====
  const D_PANEL = 3;   // Zone D パネルの初期表示（§3.1）
  const E_PANEL = 5;   // Zone E パネルの初期表示（§3.1）
  // Zone D 募集中のコンテスト（open・未参加）＝応募で楽観的にリストから除外。
  const [appliedContests, setAppliedContests] = useState<Record<string, boolean>>({});
  const openContests = (data?.open_contests ?? []).filter((c) => !appliedContests[c.id]);
  // Zone D おすすめのクエスト（catalog my_state=none）＝★フォローで楽観的に除外（フォロー中へ移る）。
  const [followedRec, setFollowedRec] = useState<Record<string, boolean>>({});
  const recommended = (data?.recommended_quests ?? []).filter((q) => !followedRec[q.id]);
  const announcements = data?.announcements ?? [];  // Zone D 運営からのお知らせ（§4.3a 選別済み）
  // Zone E 参加中＝参加クエスト（他者作成）＋承認済みアイデアコンテスト／フォロー中＝アイデア＋クエスト（§3 A案）。
  const joinedContests = data?.joined_contests ?? [];
  const joinedAll = [
    ...joinedQuests.map((q) => ({ kind: "quest" as const, q })),
    ...joinedContests.map((c) => ({ kind: "contest" as const, c })),
  ];
  const followingAll = [
    ...followed.map((f) => ({ kind: "idea" as const, f })),
    ...followedQuests.map((q) => ({ kind: "quest" as const, q })),
  ];
  // Zone E 参加リクエスト中＝自分が申請して承認待ち（クエスト=catalog pending／コンテスト=requested・FR-46/40）。
  const joinRequests = data?.join_requests ?? [];          // クエスト申請中/却下（catalog my_state）
  const requestedContests = data?.requested_contests ?? []; // コンテスト承認待ち（requested）
  const requestedAll = [
    ...joinRequests.map((q) => ({ kind: "quest" as const, q })),
    ...requestedContests.map((c) => ({ kind: "contest" as const, c })),
  ];
  const [eSeeAll, setESeeAll] = useState<null | "joined" | "following" | "requested">(null);
  const [eSeeAllN, setESeeAllN] = useState(15);
  const E_TITLE = { joined: "参加中", following: "フォロー中", requested: "参加リクエスト中" };
  // Zone E「フォロー中／参加リクエスト中」はタブ集約（ユーザー要望・参加リクエストは通常0件のため既定＝フォロー中）。
  const [eMyTab, setEMyTab] = useState<"following" | "requested">("following");
  // Zone C 議論＝新着/最近を下線タブで1枚に集約（ユーザー要望・モック Zone C）。既定＝新着。
  const [cTab, setCTab] = useState<"new" | "recent">("new");
  const eMyCounts = { following: followingAll.length, requested: requestedAll.length };
  const JR_LABEL: Record<string, string> = { pending: "申請中", rejected: "却下" };

  const applyContest = async (c: DashboardData["open_contests"][number]) => {
    setAppliedContests((m) => ({ ...m, [c.id]: true }));  // 楽観＝応募したら募集中から外す
    const res = await requestContestParticipation(c.id).catch(() => null);
    if (!res) {
      setAppliedContests((m) => { const n = { ...m }; delete n[c.id]; return n; });
      snackbar({ type: "error", msg: "応募できませんでした。" });
      return;
    }
    // public/DEMO は即 approved・社内は承認待ち（res.status）。文言を状態で出し分け。
    snackbar({ type: "success", msg: res.status === "approved" ? "コンテストに参加しました。" : "応募しました（運営の承認待ち）。" });
  };
  const followRecommended = async (q: DashboardData["recommended_quests"][number]) => {
    setFollowedRec((m) => ({ ...m, [q.id]: true }));  // 楽観＝フォローしたらおすすめから外す
    const res = await followQuest(q.id).catch(() => null);
    if (!res) {
      setFollowedRec((m) => { const n = { ...m }; delete n[q.id]; return n; });
      snackbar({ type: "error", msg: "フォローできませんでした。" });
    }
  };

  // Zone D/E のコンパクト行（mock §19 準拠＝左に本文・右にアクション）。
  const renderOpenContestRow = (c: DashboardData["open_contests"][number]) => (
    <div key={c.id} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title"><Link href={`/contests/${c.id}`}>{c.theme}</Link></div>
        <div className="dash-row__sub">{c.ends_at ? `締切 ${c.ends_at.slice(0, 10)} ・ ` : ""}参加 {c.participant_count ?? 0}人</div>
      </div>
      <button type="button" className="btn btn-sm btn-primary dash-row__action" onClick={() => applyContest(c)}>応募</button>
    </div>
  );
  const renderRecommendedRow = (q: DashboardData["recommended_quests"][number]) => (
    <div key={q.id} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title"><Link href={`/quests/${q.id}`}>{q.title}</Link></div>
        <div className="dash-row__sub">{q.owner?.display_name ? `${q.owner.display_name} ・ ` : ""}👥 {q.member_count ?? 0}</div>
      </div>
      {/* ダッシュボードは星マークのみ（枠なし・共有 .follow-star）。未フォロー＝白抜き☆（押下で一覧から外れる）。 */}
      <button type="button" className="follow-star dash-row__action" aria-pressed={false} aria-label="フォロー" title="フォロー" onClick={() => followRecommended(q)}>☆</button>
    </div>
  );
  const renderJoinedRow = (it: typeof joinedAll[number]) => it.kind === "quest" ? (
    <div key={`q:${it.q.id}`} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title"><Link href={`/quests/${it.q.id}`}>{it.q.title}</Link></div>
        <div className="dash-row__sub">{questStatusLabel(it.q.status)} ・ 👥 {it.q.member_count ?? 0} ・ 💡 {it.q.idea_count ?? 0}</div>
      </div>
    </div>
  ) : (
    <div key={`c:${it.c.id}`} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title"><Link href={`/contests/${it.c.id}`}>{it.c.theme}</Link> <span className="badge badge-muted">🏆 コンテスト</span></div>
        <div className="dash-row__sub">公募中 ・ 参加 {it.c.participant_count ?? 0}人</div>
      </div>
    </div>
  );
  const renderFollowingRow = (it: typeof followingAll[number]) => it.kind === "idea" ? (
    <div key={`i:${it.f.id}`} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title">💡 <Link href={`/ideas/${it.f.id}`}>{it.f.title}</Link></div>
        <div className="dash-row__sub">アイデア ・ ▲{it.f.vote_summary.approve} / ▼{it.f.vote_summary.oppose}</div>
      </div>
      {/* ダッシュボードは星マークのみ（枠なし・共有 .follow-star）。フォロー中＝金★（クリックで解除）。 */}
      <button type="button" className="follow-star dash-row__action" aria-pressed={true} aria-label="フォロー解除" title="フォロー中（クリックで解除）" onClick={() => toggleFollow(it.f)}>★</button>
    </div>
  ) : (
    <div key={`q:${it.q.id}`} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title">📜 <Link href="/quest-catalog">{it.q.title}</Link></div>
        <div className="dash-row__sub">クエスト（非参加・ウォッチ）</div>
      </div>
      <button type="button" className="follow-star dash-row__action" aria-pressed={true} aria-label="フォロー解除" title="フォロー中（クリックで解除）" onClick={() => void unfollowQuestCard(it.q.id)}>★</button>
    </div>
  );
  // 参加リクエスト中の行＝クエスト（申請中/却下）＋コンテスト（承認待ち）。処理は各詳細/カタログで（ここは状況表示）。
  const renderRequestRow = (it: typeof requestedAll[number]) => it.kind === "quest" ? (
    <div key={`q:${it.q.id}`} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title">📜 <Link href="/quest-catalog">{it.q.title}</Link></div>
        <div className="dash-row__sub">クエスト ・ <span className={`badge ${it.q.my_state === "rejected" ? "badge-danger" : "badge-muted"}`}>{JR_LABEL[it.q.my_state ?? ""] ?? "申請中"}</span></div>
      </div>
    </div>
  ) : (
    <div key={`c:${it.c.id}`} className="dash-row">
      <div className="dash-row__main">
        <div className="dash-row__title"><Link href={`/contests/${it.c.id}`}>{it.c.theme}</Link> <span className="badge badge-muted">🏆 コンテスト</span></div>
        <div className="dash-row__sub">⏳ 承認待ち</div>
      </div>
    </div>
  );

  return (
    <div className="dash-page stack">
      {/* レベルアップ祝福（ゲーム層演出）＝ゲームモード OFF では出さない（§4.11・レビュー#2）。 */}
      {gameEnabled && <LevelUpWatcher accountId={accountId} level={level} />}
      <DashboardFx ref={fxRef} />
      {/* #31: 時間帯の挨拶（mount 後に算出＝ハイドレーション不一致回避） */}
      {greet && <motion.div className="dash-greeting" {...flowMotion(0)}>{greet.text}、{hero?.display_name ?? displayName} さん ・ {greet.date}</motion.div>}

      {/* D 見つける（新設）＝お知らせ／募集中コンテスト／おすすめクエスト（参加機会・告知／再設計 §3 Zone D・表示順1）。
          個別パネルは0件でも枠を残し空状態メッセージ（§3.1 改訂）。ゾーン全体が空（お知らせ・募集中・おすすめとも0）なら非表示。 */}
      {(announcements.length + openContests.length + recommended.length > 0) && (
        <motion.section aria-label="見つける" {...flowMotion(1)}>
          <div className="dash-3col">
            {/* 📢 運営からのお知らせ（FR-49・§4.3a 選別済み最大3）＝📌ピン/未読バッジ・すべて見る→SC-95。 */}
            <section className="card dash-zone-card" aria-label="運営からのお知らせ">
              <div className="section-head"><h2>📢 運営からのお知らせ</h2><Link className="muted text-sm dash-head-link" href="/announcements" aria-label="すべて見る" title="すべて見る"><span className="dash-head-link__text">すべて見る →</span><span className="dash-head-link__icon" aria-hidden="true">→</span></Link></div>
              {announcements.length > 0
                ? announcements.map((a) => (
                    <div key={a.id} className="dash-row">
                      <div className="dash-row__main">
                        <div className="dash-row__title">{a.pinned && <span title="ピン留め">📌</span>}<Link href={`/announcements/${a.id}`}>{a.title}</Link>{!a.is_read && <span className="badge badge-danger">未読</span>}</div>
                        <div className="dash-row__sub">{a.excerpt}</div>
                      </div>
                    </div>
                  ))
                : <p className="dash-panel-empty">お知らせはありません。</p>}
            </section>
            {/* 🏆 募集中のコンテスト＝open かつ未参加（応募できる機会）。応募で参加リクエスト。 */}
            <section className="card dash-zone-card" aria-label="募集中のコンテスト">
              <div className="section-head"><h2>🏆 募集中のコンテスト</h2>{openContests.length > D_PANEL && <Link className="muted text-sm dash-head-link" href="/contests" aria-label="すべて見る" title="すべて見る"><span className="dash-head-link__text">すべて見る →</span><span className="dash-head-link__icon" aria-hidden="true">→</span></Link>}</div>
              {openContests.length > 0
                ? openContests.slice(0, D_PANEL).map(renderOpenContestRow)
                : <p className="dash-panel-empty">募集中のコンテストはありません。</p>}
            </section>
            {/* 🔎 おすすめのクエスト＝発見カタログで未参加・未フォロー（my_state=none）。公開モード会社は常に空（§3.1）。 */}
            <section className="card dash-zone-card" aria-label="おすすめのクエスト">
              {/* 「クエストを探す」＝カード幅が狭いと折り返すため、section-head 幅（container query）で「→」アイコンに畳む（ツールチップで補完・ユーザー要望）。 */}
              <div className="section-head"><h2>🔎 おすすめのクエスト</h2>
                <Link className="muted text-sm dash-head-link" href="/quest-catalog" aria-label="クエストを探す" title="クエストを探す">
                  <span className="dash-head-link__text">クエストを探す →</span>
                  <span className="dash-head-link__icon" aria-hidden="true">→</span>
                </Link>
              </div>
              {recommended.length > 0
                ? recommended.slice(0, D_PANEL).map(renderRecommendedRow)
                : <p className="dash-panel-empty">おすすめのクエストはありません。</p>}
            </section>
          </div>
        </motion.section>
      )}

      {/* E マイ＝参加中（クエスト＋コンテスト）／フォロー中（アイデア＋クエスト・A案）。よく行く先（再設計 §3 Zone E・表示順2）。
          全件は「すべて見る」→標準ダイアログ（混在型のため一覧ページに寄せきれない・§3）。ゾーン全体が空なら非表示。 */}
      {(joinedAll.length + followingAll.length + requestedAll.length > 0) && (
        <motion.section aria-label="マイ" {...flowMotion(1)}>
          <div className="dash-2col">
            <section className="card dash-zone-card" aria-label="参加中">
              <div className="section-head"><h2>👣 参加中</h2>{joinedAll.length > E_PANEL && <button type="button" className="dash-see-all" onClick={() => { setESeeAllN(15); setESeeAll("joined"); }}>すべて見る（全{joinedAll.length}件）→</button>}</div>
              {joinedAll.length > 0
                ? joinedAll.slice(0, E_PANEL).map(renderJoinedRow)
                : <p className="dash-panel-empty">参加中のクエスト・コンテストはありません。</p>}
            </section>
            {/* フォロー中／参加リクエスト中＝タブ集約（ユーザー要望・Zone B と同じ下線タブ）。既定＝フォロー中（リクエストは通常0件）。 */}
            <section className="card dash-zone-card" aria-label="フォロー中・参加リクエスト中">
              <div className="dash-tabs" role="tablist" aria-label="マイの種別">
                {(["following", "requested"] as const).map((k) => (
                  <button key={k} type="button" className={`dash-tab${eMyTab === k ? " is-active" : ""}`} role="tab" aria-selected={eMyTab === k} onClick={() => setEMyTab(k)}>
                    {k === "following" ? "★ フォロー中" : "✋ 参加リクエスト中"} <span className="seg-n">{eMyCounts[k]}</span>
                  </button>
                ))}
                {eMyCounts[eMyTab] > E_PANEL && (
                  <button type="button" className="dash-see-all" onClick={() => { setESeeAllN(15); setESeeAll(eMyTab); }}>すべて見る（全{eMyCounts[eMyTab]}件）→</button>
                )}
              </div>
              {/* 2タブを重ね置き＝高さは多い方のタブに固定（切替えても高さが変わらない）。 */}
              <div className="dash-tabstack">
                <div className="dash-tabpane" aria-hidden={eMyTab !== "following"}>
                  {followingAll.length > 0
                    ? followingAll.slice(0, E_PANEL).map(renderFollowingRow)
                    : <p className="dash-panel-empty">フォロー中のアイデア・クエストはありません。</p>}
                </div>
                <div className="dash-tabpane" aria-hidden={eMyTab !== "requested"}>
                  {requestedAll.length > 0
                    ? requestedAll.slice(0, E_PANEL).map(renderRequestRow)
                    : <p className="dash-panel-empty">参加リクエスト中のクエスト・コンテストはありません。</p>}
                </div>
              </div>
            </section>
          </div>
        </motion.section>
      )}

      {/* B あなたの番（要対応）＝未投票/承認待ち/下書きをタブ集約（0件なら非表示・再設計 §3 Zone B・表示順3）。
          ユーザー要望でセグメント→下線タブ＋カード枠で囲う。 */}
      {bHasAny && (
        <motion.section aria-label="あなたの番" {...flowMotion(1)}>
          <section className="card dash-zone-card">
            <div className="dash-tabs" role="tablist" aria-label="要対応の種別">
              {(["vote", "req", "draft"] as const).map((k) => (
                <button key={k} type="button" className={`dash-tab${bTab === k ? " is-active" : ""}`} role="tab" aria-selected={bTab === k} onClick={() => setBTab(k)}>
                  {k === "vote" ? "未投票" : k === "req" ? "承認待ち" : "下書き"} <span className="seg-n">{bCounts[k]}</span>
                </button>
              ))}
              {bCounts[bTab] > B_PANEL && (
                <button type="button" className="dash-see-all" onClick={() => { setBSeeAllN(15); setBSeeAll(bTab); }}>すべて見る（全{bCounts[bTab]}件）→</button>
              )}
            </div>
            {/* 全タブを重ね置き＝高さは最も高いタブに固定（切替えても高さが変わらない）。各タブは0件でも空状態を表示。 */}
            <div className="dash-tabstack">
            <div className="dash-tabpane vote-grid" aria-hidden={bTab !== "vote"}>
              {unvoted.length > 0
                ? unvoted.slice(0, B_PANEL).map(renderVoteCard)
                : <p className="dash-panel-empty">未投票のアイデアはありません。</p>}
            </div>
            <div className="dash-tabpane quest-grid" aria-hidden={bTab !== "req"}>
              {pendingReqs.length > 0
                ? pendingReqs.slice(0, B_PANEL).map(renderReqCard)
                : <p className="dash-panel-empty">承認待ちの参加リクエストはありません。</p>}
            </div>
            <div className="dash-tabpane draft-grid" aria-hidden={bTab !== "draft"}>
              {drafts.length > 0
                ? drafts.slice(0, B_PANEL).map(renderDraftCard)
                : <p className="dash-panel-empty">下書きはありません。</p>}
            </div>
            </div>
          </section>
        </motion.section>
      )}
      {/* 並び順（ユーザー要望・2026-09-15）＝新着の議論 → チームアクティビティ＋最近の通知 → 未投票 → フォロー中 → 下書き → 参加中クエスト。
          ヒーロー＋週間ランキング（ゲーム層）は §4.11 で最下部（2026-09-13）。空パネルは §7 で非表示。 */}

      {/* C キャッチアップ row1（2カラム）＝💬🕒 議論（新着/最近を下線タブで1枚に集約・ユーザー要望/モック Zone C）＋🔔 最近の通知。 */}
      <motion.div className="dash-discuss" {...flowMotion(1)}>
        {/* 💬 議論＝新着（未読のみ・既読で消える）／🕒 最近（更新順の恒久導線）を下線タブで1枚に集約。
            高さは高い方のタブに固定（dash-tabstack・Zone B/E と同じ）。空タブは空状態を表示。 */}
        <section className="card dash-zone-card" aria-label="議論">
          <div className="dash-tabs" role="tablist" aria-label="議論の種別">
            <button type="button" className={`dash-tab${cTab === "new" ? " is-active" : ""}`} role="tab" aria-selected={cTab === "new"} onClick={() => setCTab("new")}>
              💬 新着の議論 {unreadChats.length > 0 && <span className="seg-n">{unreadChats.length}</span>}
            </button>
            <button type="button" className={`dash-tab${cTab === "recent" ? " is-active" : ""}`} role="tab" aria-selected={cTab === "recent"} onClick={() => setCTab("recent")}>
              🕒 最近の議論
            </button>
          </div>
          <div className="dash-tabstack">
            {/* 新着＝参加クエスト横断で自分の未読チャット（他ユーザー投稿）。既読で消える常設パネル。 */}
            <div className="dash-tabpane" aria-hidden={cTab !== "new"}>
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
                <p className="dash-panel-empty">未読のチャットはありません。参加クエストで他のメンバーの新しい投稿があるとここに表示されます。</p>
              )}
            </div>
            {/* 最近＝更新順（既読/未読・自分投稿問わず）。既読化しない恒久導線。 */}
            <div className="dash-tabpane" aria-hidden={cTab !== "recent"}>
              {recentChats.length > 0 ? (
                <ul className="unread-list">
                  {recentChats.map((c) => (
                    <li key={c.id}>
                      <Link className="unread-item" href={`/ideas/${c.id}/chat`} onClick={() => markChatFromDashboard()}>
                        <QuestIcon name={c.title} color={c.quest.color ?? undefined} size="xs" />
                        <span className="unread-item__title">{c.title}</span>
                        <span className="unread-item__quest">🎯 {c.quest.title}</span>
                        {c.unread_chat_count > 0
                          ? <span className="badge badge-danger">💬 +{c.unread_chat_count}</span>
                          : <span className="notif-time muted">{c.last_chat_at ? timeLabel(c.last_chat_at) : ""}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dash-panel-empty">最近更新された議論はありません。参加クエストのアイデアにチャットがあるとここに更新順で並びます。</p>
              )}
            </div>
          </div>
        </section>

        <section className="card" aria-label="最近の通知">
          <div className="section-head">
            <h2 style={{ fontSize: "var(--text-lg)" }}>最近の通知</h2>
            <Link className="dash-head-link" href="/notifications" aria-label="すべての通知" title="すべての通知"><span className="dash-head-link__text">すべての通知 →</span><span className="dash-head-link__icon" aria-hidden="true">→</span></Link>
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

      {/* C キャッチアップ row2（全幅）＝📣 チームアクティビティ（参加クエスト横断の場の活動・SC-01 §4.8b・FR-36）。 */}
      <motion.div className="dash-actrow" {...flowMotion(2)}>
        <section className="card" aria-label="チームアクティビティ">
          <ActivityFeed title="チームアクティビティ" load={loadTeamFeed} showQuest emptyText="参加中のクエスト・アイデアコンテストの新しい活動はまだありません。" />
        </section>
      </motion.div>

      {/* 旧「フォロー中のアイデア／自分のクエスト／参加中クエスト／フォロー中のクエスト／参加リクエストの状況」は
          ダッシュボード再設計で Zone E（参加中＝クエスト＋コンテスト／フォロー中＝アイデア＋クエスト）へ集約・
          「自分のクエスト」「参加リクエスト中」は SC-10 一覧のスイッチへ移設（§6）。 */}

      {/* A 最下段：ヒーロー＋週間ランキング（ゲームモード OFF＝§4.11 で非表示・再設計 §3 Zone A・表示順5）。 */}
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
      {contestReqSel && (
        <ContestJoinRequestDialog
          contestId={contestReqSel.contest.id}
          request={{
            user_id: contestReqSel.user.user_id,
            display_name: contestReqSel.user.display_name,
            avatar_image_url: contestReqSel.user.avatar_image_url ?? null,
            created_at: contestReqSel.created_at ?? null,
            status: "requested",
          }}
          contest={{
            theme: contestReqSel.contest.theme,
            status: contestReqSel.contest.status ?? null,
            starts_at: contestReqSel.contest.starts_at ?? null,
            ends_at: contestReqSel.contest.ends_at ?? null,
          }}
          open={contestReqOpen}
          onClose={() => setContestReqOpen(false)}
          onClosed={() => setContestReqSel(null)}
          onDecided={onContestDecided}
        />
      )}

      {/* B あなたの番「すべて見る」＝全件ダイアログ（標準 Modal・初期15＋もっと見る・§3.1/§Zone B）。 */}
      {bSeeAll && (
        <Modal open={!!bSeeAll} onClose={() => setBSeeAll(null)} onClosed={() => setBSeeAllN(15)} title={`${B_TITLE[bSeeAll]}（全${bCounts[bSeeAll]}件）`} size="xl">
          <ModalBody>
            {/* Modal は portal で body 直下に描画＝.dash-page スコープのカード/グリッド指定が効かない（DFT）。
                .dash-page でラップして復活させ、.dash-seeall で1行3カードに固定（ユーザー要望・§Zone B）。 */}
            <div className="dash-page dash-seeall">
            <div className={bSeeAll === "vote" ? "vote-grid" : bSeeAll === "draft" ? "draft-grid" : "quest-grid"}>
              {bSeeAll === "vote" && unvoted.slice(0, bSeeAllN).map(renderVoteCard)}
              {bSeeAll === "req" && pendingReqs.slice(0, bSeeAllN).map(renderReqCard)}
              {bSeeAll === "draft" && drafts.slice(0, bSeeAllN).map(renderDraftCard)}
            </div>
            </div>
            {bCounts[bSeeAll] > bSeeAllN && (
              <div style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
                <button type="button" className="btn btn-outline" onClick={() => setBSeeAllN((n) => n + 15)}>もっと見る（残り{bCounts[bSeeAll] - bSeeAllN}件）</button>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <button type="button" className="btn btn-outline dialog-close-left" onClick={() => setBSeeAll(null)}>閉じる</button>
          </ModalFooter>
        </Modal>
      )}

      {/* E マイ「すべて見る」＝参加中（クエスト＋コンテスト）／フォロー中（アイデア＋クエスト）の全件ダイアログ（標準 Modal・混在型・§3）。 */}
      {eSeeAll && (
        <Modal open={!!eSeeAll} onClose={() => setESeeAll(null)} onClosed={() => setESeeAllN(15)}
          title={`${E_TITLE[eSeeAll]}（全${(eSeeAll === "joined" ? joinedAll.length : eSeeAll === "following" ? followingAll.length : requestedAll.length)}件）`} size="lg">
          <ModalBody>
            {/* Modal は portal で body 直下＝.dash-page スコープが効かないため行スタイルを復活させるラップ（DFT）。 */}
            <div className="dash-page">
              {eSeeAll === "joined" && joinedAll.slice(0, eSeeAllN).map(renderJoinedRow)}
              {eSeeAll === "following" && followingAll.slice(0, eSeeAllN).map(renderFollowingRow)}
              {eSeeAll === "requested" && requestedAll.slice(0, eSeeAllN).map(renderRequestRow)}
            </div>
            {(eSeeAll === "joined" ? joinedAll.length : eSeeAll === "following" ? followingAll.length : requestedAll.length) > eSeeAllN && (
              <div style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
                <button type="button" className="btn btn-outline" onClick={() => setESeeAllN((n) => n + 15)}>もっと見る</button>
              </div>
            )}
            <p className="dash-panel-empty" style={{ marginTop: "var(--space-4)" }}>
              <Link href="/quests">クエスト一覧(SC-10)で見る →</Link>
            </p>
          </ModalBody>
          <ModalFooter>
            <button type="button" className="btn btn-outline dialog-close-left" onClick={() => setESeeAll(null)}>閉じる</button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
