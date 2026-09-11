"use client";

// SC-12 クエスト詳細＝クエストヘッダー＋クエスト内週間ランキング＋タブ（アイデア一覧/パーティー/全文検索/概要）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-12_クエスト詳細.html（DoD＝モック一致）。
// 接続範囲＝ヘッダー/概要/パーティー（GET /quests/{id}・C.1）＋状態遷移（C.5）＋削除（C.2）＋
// 編集導線（SC-11 /quests/{id}/edit）＋**アイデアタブ（D.1 GET /quests/{id}/ideas・IDEAS_CHANGED 購読）**。
// アイデアタブ/全文検索(J)/評価列(F)/クエスト内週間ランキング(G) すべて実接続。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar, DataTable, RowMenu, LoadingOverlay, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { searchQuest, type SearchRow, type SearchType } from "@/features/search/api";
import { parseSnippet } from "@/features/search/snippet";
import { getRankings, type RankingResponse } from "@/features/ranking/api";
import { getQuestActivities } from "@/features/feed/api";
import { ActivityFeed } from "@/features/feed/components/ActivityFeed";
import { ApiError } from "@/lib/api/client";
import { backToListOr, markIdeaFromQuest, consumeQuestFromList } from "@/lib/nav";
import { deadlineUrgency, deadlineCountdown, todayISO } from "@/lib/deadline";
import { QuestIcon } from "@/components/layout";
import {
  deleteQuest,
  getQuest,
  QUESTS_CHANGED_EVENT,
  transitionQuest,
  type QuestDetail,
} from "../api";
import { IDEAS_CHANGED_EVENT, listIdeas, followIdea, unfollowIdea, voteIdea, type IdeaCard, type IdeaVoteType } from "@/features/ideas/api";
import "../quests.css";

// アイデアタブの行ビュー型（SC-12・D.1）。列/カードの描画に必要な最小射影。
type Idea = {
  id: string; title: string; value: string; poster: string; posterAvatar: string | null; initial: string; iconUrl: string | null; agree: number; disagree: number;
  comments: number; ev: number; evalstate: "pending" | "done"; mystate: "unvoted" | "voted" | "mine" | "draft"; created: number; draft: boolean;
  following: boolean; revision: number; myVote: "approve" | "oppose" | null;
  unreadChat: number; lastChatAt: string | null;  // 💬 新着の議論＝自分の未読（他ユーザー投稿）・最終チャット時刻
};
// IdeaCardDTO（D.1）→ 行ビュー。評価（F）＝`evaluation` 集計（評価済 overall_avg=n/5・可視0は null）。あなた
// バッジは status＋my_vote から導出（下書き＝draft／自分の投票あり＝voted／なし＝unvoted）。created＝更新からの経過日数。
// value＝提案価値（一覧で中身を判断＝クイック投票の材料・レビュー#3）。following/revision＝フォロー/更新バッジ。
function toIdeaView(c: IdeaCard): Idea {
  const isDraft = c.status === "draft";
  const days = Math.max(0, Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000));
  const myVote = (c.my_vote === "approve" || c.my_vote === "oppose") ? c.my_vote : null;
  const mystate: Idea["mystate"] = isDraft ? "draft" : myVote ? "voted" : "unvoted";
  const name = c.author.display_name || "?";
  return {
    id: c.id, title: c.title, value: c.value, poster: name, posterAvatar: c.author.avatar_image_url ?? null, initial: name.slice(0, 1), iconUrl: c.icon_image_url ?? null,
    agree: c.vote_summary.approve, disagree: c.vote_summary.oppose, comments: c.comment_count,
    ev: c.evaluation.overall_avg ?? -1, evalstate: c.evaluation.state === "done" ? "done" : "pending",
    mystate, created: days, draft: isDraft, following: c.following, revision: c.current_revision, myVote,
    unreadChat: c.unread_chat_count ?? 0, lastChatAt: c.last_chat_at ?? null,
  };
}
const YOU: Record<string, [string, string]> = { draft: ["下書き", "badge-muted"], unvoted: ["未投票", "badge-danger"], voted: ["投票済", "badge-success"], mine: ["自分の投稿", "badge-muted"] };
const dash = <span className="muted">—</span>;
// 相対時刻（💬 新着の議論の最終チャット時刻表示・当面 ja）。
function chatAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

// quest_status（enum・§3）→ ラベル/バッジ。
const STATUS_LABEL: Record<string, string> = { draft: "下書き", recruiting: "募集中", in_progress: "進行中", evaluating: "評価中", completed: "完了" };
const STATUS_ORDER = ["draft", "recruiting", "in_progress", "evaluating", "completed"];
function statusBadgeClass(s: string): string {
  if (s === "completed") return "badge badge-muted";
  if (s === "draft") return "badge badge-muted";
  return "badge badge-success";
}
// API 権限 → パーティー表示バッジ（👑 所有者を先頭に）。
const PERM_BADGE: Record<string, string> = { owner: "👑 所有者", quest_admin: "クエスト管理", evaluator: "評価者", vote: "投票", idea_create: "作成", comment: "コメント" };
const PERM_VIEW_ORDER = ["owner", "quest_admin", "evaluator", "vote", "idea_create", "comment"];

const TABS = [
  { key: "ideas", label: "💡 アイデア" },
  { key: "party", label: "👥 パーティー" },
  { key: "search", label: "🔍 全文検索" },
  // レビュー#3＝「概要」タブは廃止（ヘッダーのタイトル/状態/カテゴリ/目的/締切/所有者と重複するため）。
] as const;
type TabKey = (typeof TABS)[number]["key"];

// 全文検索（J）の種別ラベルと安全なスニペット描画。
const FT_TYPE_LABEL: Record<string, string> = { idea: "アイデア", chat: "チャット", attachment: "添付" };
// スニペットの許可リストサニタイズは純ロジック（features/search/snippet.ts）に分離＝単体テスト可。
// dangerouslySetInnerHTML は使わず、keyword ハイライトのみ <mark>、他はテキストとして React 描画（§2.2④）。
function renderSnippet(html: string): React.ReactNode {
  return parseSnippet(html).map((seg, i) =>
    seg.hit ? <mark key={i} className="keyword">{seg.text}</mark> : <span key={i}>{seg.text}</span>,
  );
}
function deadlineText(d: string | null | undefined): string {
  if (!d) return "未設定";
  return d.replaceAll("-", "/");
}

// クエスト詳細のスクロール位置保存キー（アイデア詳細へドリルイン→戻る での復元用・sessionStorage）。
const QSCROLL_KEY = "iq_quest_detail_scroll:";

export function QuestDetailView({ questId, gameEnabled = true }: { questId: string; gameEnabled?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const snack = useSnackbar();
  // 戻るラベルの文脈判定（動的ラベル）＝クエスト一覧から来た時（or 直アクセスで戻り先が一覧）だけ
  // 「← クエスト一覧へ戻る」、それ以外（ダッシュボード等）は「← 戻る」。来歴はマウント時に1回だけ消費。
  const [fromQuestList, setFromQuestList] = useState(false);
  const [directAccess, setDirectAccess] = useState(false);
  const backCtxConsumed = useRef(false);
  useEffect(() => {
    if (backCtxConsumed.current) return;
    backCtxConsumed.current = true;
    setFromQuestList(consumeQuestFromList());
    setDirectAccess(typeof window !== "undefined" && window.history.length <= 1);
  }, []);
  const questBackLabel = fromQuestList || directAccess ? "← クエスト一覧へ戻る" : "← 戻る";
  const [tab, setTab] = useState<TabKey>("ideas");
  const [ftq, setFtq] = useState("");
  const [ftScope, setFtScope] = useState("");
  const [ftRows, setFtRows] = useState<SearchRow[]>([]);
  const [ftTotal, setFtTotal] = useState(0);
  const [ftPage, setFtPage] = useState(1);
  const [ftLoading, setFtLoading] = useState(false);
  const ftPerPage = 20;
  const [ranking, setRanking] = useState<RankingResponse | null>(null);

  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null); // アイデアタブ（D.1・null=読み込み中）
  const [ideasError, setIdeasError] = useState<string | null>(null);
  // レビュー#3＝一覧上部のステータス絞り込み（動線＝すべて/未投票/フォロー中/自分の下書き）。DataTable の前段で data を絞る。
  const [ideaFilter, setIdeaFilter] = useState<"all" | "unvoted" | "following" | "draft">("all");
  // アイデア詳細から戻った時のスクロール位置復元。Next の自動復元は本画面が戻り時に再取得＝高さ0で
  // クランプされ効かないため、行クリック時に保存した scrollY を「一覧描画で高さが出てから」rAF で復元する。
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (ideas === null || scrollRestored.current) return; // 一覧ロード完了後に1回だけ
    scrollRestored.current = true;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(QSCROLL_KEY + questId); if (saved != null) sessionStorage.removeItem(QSCROLL_KEY + questId); } catch { /* 非対応環境は無視 */ }
    const y = saved != null ? parseInt(saved, 10) : NaN;
    if (!Number.isFinite(y) || y <= 0) return;
    let tries = 0;
    const restore = () => {
      window.scrollTo(0, y);
      // まだ内容が短くて届かない（ランキング/行の遅延ロード）なら次フレームで再試行（上限あり）。
      if (Math.abs(window.scrollY - y) > 2 && tries++ < 30) requestAnimationFrame(restore);
    };
    requestAnimationFrame(restore);
  }, [ideas, questId]);

  // アイデア詳細から「← {クエスト名}へ戻る」（/quests/{id}#quest-tabs）で戻った時、タブを画面上部へ。
  // 上部パネル（ランキング/アクティビティ）が非同期で後から伸びてタブ位置がずれるため、
  // 1回だけでなく「上部の高さが変わるたび再整列」する（quest-top を ResizeObserver で監視）。
  // ユーザーが自分でスクロールしたら即解除、最長1.5秒で自動解除（操作の邪魔をしない）。
  const alignedRef = useRef(false);
  useEffect(() => {
    if (!quest || alignedRef.current) return;
    if (typeof window === "undefined" || window.location.hash !== "#quest-tabs") return;
    const tabsEl = document.getElementById("quest-tabs");
    if (!tabsEl) return;
    alignedRef.current = true;
    const topEl = document.querySelector<HTMLElement>(".quest-top");
    let active = true;
    const align = () => { if (active) tabsEl.scrollIntoView({ block: "start" }); };
    const ro = topEl && "ResizeObserver" in window ? new ResizeObserver(() => align()) : null;
    function stop() {
      active = false;
      ro?.disconnect();
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.clearTimeout(timer);
    }
    const timer = window.setTimeout(stop, 1500);
    align();
    if (ro && topEl) ro.observe(topEl);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    return stop;
  }, [quest]);

  const load = useCallback(async () => {
    try {
      const d = await getQuest(questId);
      setQuest(d);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? "このクエストは見つからないか、参照する権限がありません。"
          : err instanceof ApiError && err.status === 401
            ? "セッションが切れています。再ログインしてください。"
            : "クエストの取得に失敗しました。",
      );
    }
  }, [questId]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener(QUESTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(QUESTS_CHANGED_EVENT, onChanged);
  }, [load]);

  // アイデアタブ（D.1）＝マウント時に一覧取得。SC-21 の投稿/下書き/編集・削除成功で発火する
  // IDEAS_CHANGED_EVENT（跨ルート・window）を購読して再取得＝投稿後に一覧へ反映する。
  const loadIdeas = useCallback(async () => {
    try {
      const res = await listIdeas(questId, { limit: 100 });
      setIdeas((res?.data ?? []).map(toIdeaView));
      setIdeasError(null);
    } catch (err) {
      setIdeasError(
        err instanceof ApiError && err.status === 401
          ? "セッションが切れています。再ログインしてください。"
          : "アイデア一覧の取得に失敗しました。",
      );
      setIdeas([]);
    }
  }, [questId]);

  useEffect(() => {
    void loadIdeas();
    const onIdeasChanged = () => void loadIdeas();
    window.addEventListener(IDEAS_CHANGED_EVENT, onIdeasChanged);
    return () => window.removeEventListener(IDEAS_CHANGED_EVENT, onIdeasChanged);
  }, [loadIdeas]);

  // レビュー#3＝一覧からのクイック投票（楽観・その場で投票状態を更新／失敗は再取得）。
  const quickVote = async (id: string, type: IdeaVoteType) => {
    setIdeas((xs) => xs && xs.map((i) => {
      if (i.id !== id) return i;
      let { agree, disagree } = i;
      if (i.myVote === "approve") agree -= 1; else if (i.myVote === "oppose") disagree -= 1;
      if (type === "approve") agree += 1; else disagree += 1;
      return { ...i, myVote: type, mystate: "voted", agree, disagree };
    }));
    const res = await voteIdea(id, type).catch(() => null);
    if (!res) { snack({ type: "error", title: "投票に失敗しました", msg: "時間をおいて再度お試しください。" }); void loadIdeas(); }
  };
  // レビュー#3＝一覧からのフォロー切替（楽観・失敗はロールバック）。
  const toggleFollow = async (id: string, cur: boolean) => {
    setIdeas((xs) => xs && xs.map((i) => (i.id === id ? { ...i, following: !cur } : i)));
    const res = await (cur ? unfollowIdea(id) : followIdea(id)).catch(() => "err" as const);
    if (res === "err") {
      setIdeas((xs) => xs && xs.map((i) => (i.id === id ? { ...i, following: cur } : i)));
      snack({ type: "error", title: "フォローを更新できませんでした" });
    }
  };
  // ステータス絞り込みを適用した表示リスト（DataTable にはこれを data として渡す）。
  const ideaCounts = {
    all: ideas?.length ?? 0,
    unvoted: (ideas ?? []).filter((i) => i.mystate === "unvoted").length,
    following: (ideas ?? []).filter((i) => i.following).length,
    draft: (ideas ?? []).filter((i) => i.draft).length,
  };
  const visibleIdeas = (ideas ?? []).filter((i) =>
    ideaFilter === "all" ? true
      : ideaFilter === "unvoted" ? i.mystate === "unvoted"
        : ideaFilter === "following" ? i.following
          : i.draft);
  // 💬 新着の議論＝このクエストで自分の未読チャットがあるアイデア（最終時刻の新しい順）。一覧から導出（追加API不要）。
  const unreadDiscussions = (ideas ?? [])
    .filter((i) => i.unreadChat > 0)
    .sort((a, b) => (b.lastChatAt ?? "").localeCompare(a.lastChatAt ?? ""))
    .slice(0, 6);

  const canEdit = !!quest && (quest.my_permissions.includes("owner") || quest.my_permissions.includes("quest_admin"));
  const nextStatus = quest ? STATUS_ORDER[STATUS_ORDER.indexOf(quest.status) + 1] : undefined;

  async function onTransition() {
    if (!quest || !nextStatus) return;
    const ok = await confirm({
      title: "ステータスを進める",
      msg: `「${STATUS_LABEL[quest.status]}」→「${STATUS_LABEL[nextStatus]}」に進めます。よろしいですか？（前進のみ・戻せません）`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await transitionQuest(questId, { to: nextStatus });
      setQuest(updated);
      window.dispatchEvent(new Event(QUESTS_CHANGED_EVENT));
      snack({ type: "success", title: "ステータスを更新しました", msg: `${STATUS_LABEL[nextStatus]} に進めました。` });
    } catch (err) {
      snack({ type: "error", title: "更新できませんでした", msg: err instanceof ApiError && err.code === "validation_error" ? "公開に必要な項目が不足しています。" : "時間をおいて再度お試しください。" });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!quest) return;
    const ok = await confirm({
      variant: "danger",
      title: "クエストを削除",
      msg: `「${quest.title}」を削除しますか？ 一覧・詳細から見えなくなります（投稿されたアイデア等は監査のため保持されます）。`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteQuest(questId);
      window.dispatchEvent(new Event(QUESTS_CHANGED_EVENT));
      snack({ type: "success", title: "クエストを削除しました" });
      router.push("/quests");
    } catch {
      snack({ type: "error", title: "削除できませんでした", msg: "時間をおいて再度お試しください。" });
      setBusy(false);
    }
  }


  // クエスト内 週間ランキング（G・scope=quest:{id}・this_week・me 同梱）。
  useEffect(() => {
    let alive = true;
    void getRankings("this_week", { scope: `quest:${questId}`, limit: 3 })
      .then((r) => { if (alive) setRanking(r); }).catch(() => {});
    return () => { alive = false; };
  }, [questId]);

  // クエスト内アクティビティ（SC-12 §4.1c・FR-36・公開種別のみ・門番=パーティー所属）。
  const loadQuestFeed = useCallback((cursor?: string | null) => getQuestActivities(questId, cursor), [questId]);

  // アイデア一覧の列（標準 DataTable にレビュー#3 の機能を追加）＝提案価値（中身の判断）・あなた/フォロー/評価の
  // enum フィルタ（動線集約）・操作列（未投票=クイック投票／下書き=続き／投票済=チャット）。行/カードのボタンは
  // DataTable が行クリックから除外（a,button,input,select,label）＝遷移と両立。
  const ideaColumns: DataTableColumn<Idea>[] = [
    { key: "title", label: "件名", locked: true, width: 220, sortable: true, filter: { type: "text" }, sortVal: (r) => r.title, searchVal: (r) => `${r.title} ${r.value}`, csvVal: (r) => r.title,
      render: (r) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}><QuestIcon name={r.title} color={quest?.color} imageUrl={r.iconUrl} size="xs" /><span className="idea-title">{r.title}</span>{r.revision > 1 && <span className="badge badge-muted" title="編集された（版あり）">🔄</span>}{r.draft && <span className="badge badge-muted">下書き</span>}</span> },
    { key: "value", label: "提案価値", width: 320, searchVal: (r) => r.value, csvVal: (r) => r.value,
      render: (r) => <span className="idea-value-cell" title={r.value}>{r.value}</span> },
    { key: "you", label: "あなた", width: 100, sortable: true, sortVal: (r) => r.mystate, csvVal: (r) => YOU[r.mystate][0],
      render: (r) => <span className={`badge ${YOU[r.mystate][1]}`}>{YOU[r.mystate][0]}</span> },
    { key: "follow", label: "フォロー", width: 96, sortable: true, sortVal: (r) => (r.following ? 1 : 0), csvVal: (r) => (r.following ? "フォロー中" : ""),
      render: (r) => r.draft ? dash : <button type="button" className={"idea-follow" + (r.following ? " is-on" : "")} aria-pressed={r.following} title={r.following ? "フォロー解除" : "フォロー"} onClick={() => void toggleFollow(r.id, r.following)}>★</button> },
    { key: "votes", label: "賛成 / 反対", width: 120, align: "num", sortable: true, sortVal: (r) => r.agree, csvVal: (r) => (r.draft ? "" : `▲${r.agree} ▼${r.disagree}`),
      render: (r) => r.draft ? dash : <><span className="vote-agree">▲{r.agree}</span> / <span className="vote-disagree">▼{r.disagree}</span></> },
    { key: "comments", label: "💬", width: 96, align: "num", sortable: true, sortVal: (r) => r.comments, csvVal: (r) => (r.draft ? "" : r.unreadChat > 0 ? `${r.comments}(+${r.unreadChat})` : String(r.comments)),
      render: (r) => r.draft ? dash : <span className="idea-chat-cell">{r.comments}{r.unreadChat > 0 && <span className="badge badge-danger idea-unread" title={`未読 ${r.unreadChat} 件（新着の議論）`}>+{r.unreadChat}</span>}</span> },
    { key: "eval", label: "評価", width: 110, sortable: true, filter: { type: "enum", options: [["pending", "評価待ち"], ["done", "評価済"]] }, sortVal: (r) => r.ev, filterVal: (r) => r.evalstate,
      csvVal: (r) => (r.draft ? "" : r.evalstate === "done" ? (r.ev >= 0 ? `${r.ev}/5` : "評価済") : "評価待ち"),
      render: (r) => r.draft ? dash : (r.evalstate === "done"
        ? (r.ev >= 0 ? <span className={`badge ${r.ev >= 4 ? "badge-success" : "badge-muted"}`}>{r.ev}/5</span> : <span className="badge badge-muted">評価済</span>)
        : <span className="badge">評価待ち</span>) },
    { key: "act", label: "操作", actions: true, width: 64, csvVal: () => "",
      render: (r) => {
        // リストの操作メニュー（⋯）。未投票は「賛成/反対」を選べる（レビュー#3）。下書きは続き、他はチャット/詳細。
        const goIdea = () => { markIdeaFromQuest(questId); router.push(`/ideas/${r.id}`); };
        const goChat = () => { markIdeaFromQuest(questId); router.push(`/ideas/${r.id}/chat`); };
        const items: RowMenuItem[] = r.draft
          ? [{ label: "下書きを続ける", onClick: goIdea }]
          : [
              ...(r.mystate === "unvoted"
                ? [{ label: "▲ 賛成する", onClick: () => void quickVote(r.id, "approve") },
                   { label: "▼ 反対する", onClick: () => void quickVote(r.id, "oppose") }]
                : []),
              { label: "💬 チャットを開く", onClick: goChat },
              { label: "詳細を開く", onClick: goIdea },
            ];
        return <RowMenu items={items} />;
      } },
  ];

  // クエリ/対象の変更でページを先頭へ戻す。
  useEffect(() => { setFtPage(1); }, [ftq, ftScope]);
  // 全文検索（J）＝デバウンス取得。空クエリ/検索タブ以外は何もしない。真実は REST。
  useEffect(() => {
    const term = ftq.trim();
    if (tab !== "search" || !term) { setFtRows([]); setFtTotal(0); return; }
    setFtLoading(true);
    const timer = setTimeout(async () => {
      const res = await searchQuest(questId, {
        q: term, types: (ftScope || undefined) as SearchType | undefined, page: ftPage, perPage: ftPerPage,
      }).catch(() => null);
      setFtRows(res?.data ?? []);
      setFtTotal(res?.page_info.total ?? 0);
      setFtLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [ftq, ftScope, ftPage, tab, questId]);

  if (loadError) {
    return (
      <section aria-label="クエスト詳細">
        <p><Link className="backlink" href="/quests" onClick={(e) => { e.preventDefault(); backToListOr(router, "/quests"); }}>{questBackLabel}</Link></p>
        <div className="form-error" role="alert" style={{ marginTop: "var(--space-4)" }}>{loadError}</div>
      </section>
    );
  }
  if (!quest) {
    return (
      <section aria-label="クエスト詳細">
        <p><Link className="backlink" href="/quests" onClick={(e) => { e.preventDefault(); backToListOr(router, "/quests"); }}>{questBackLabel}</Link></p>
        <LoadingOverlay variant="clean" />
      </section>
    );
  }

  const ownerName = quest.owner.display_name || "?";
  const party = quest.members;

  return (
    <section aria-label="クエスト詳細">
      {/* 戻るリンクはフローティング（sticky）＝スクロールしても常時上部に表示（デザイン標準 §4.10）。
          sticky は親の高さ範囲でのみ効くため <p> で包まず section 直下に置く。
          標準どおり履歴を戻す（§4.5 ⑨）＝SC-10 一覧の検索/ソート/絞込/ページ・スクロール位置ごと復帰。
          href は右クリック/新規タブ/JS 無効時のフォールバック（クエリなしの素の一覧）。 */}
      <Link className="backlink backlink--float" href="/quests" onClick={(e) => { e.preventDefault(); backToListOr(router, "/quests"); }}>{questBackLabel}</Link>

      {/* ヘッダー＋クエスト内週間ランキング */}
      <div className="quest-top">
        {/* ヘッダー＋クエスト内アクティビティを2段組（レビュー#3＝ヘッダーの空白を活かす）。 */}
        <div className="quest-head-row">
        <section className="card quest-head" aria-label="クエスト情報">
          <div className="quest-head__top">
            <div className="quest-head__main">
              <QuestIcon name={quest.title} color={quest.color} imageUrl={quest.icon_image_url} size="lg" />
              <div>
                {quest.categories.map((c) => <span key={c} className="badge badge-muted" style={{ marginRight: 6 }}>{c}</span>)}
                <span className={statusBadgeClass(quest.status)}>{STATUS_LABEL[quest.status] ?? quest.status}</span>
                <h1>{quest.title}</h1>
                {quest.purpose && <p className="quest-head__theme">{quest.purpose}</p>}
                <div className="quest-meta">
                  {(() => { const du = deadlineUrgency(quest.deadline, todayISO()); return (
                    <span className="deadline" data-urgency={du.level}>⏳ 締切 {deadlineText(quest.deadline)}{du.level !== "safe" && du.level !== "none" ? ` ・${deadlineCountdown(du.days)}` : ""}</span>
                  ); })()}
                  <span>👥 パーティー {quest.member_count}人</span>
                  <span>💡 アイデア {quest.idea_count}件</span>
                  <span className="poster" style={{ gap: 6 }}>👑 所有者: <Avatar name={ownerName} imageUrl={quest.owner.avatar_image_url ?? undefined} size="sm" /><span className="name">{ownerName}</span></span>
                  <span>🗂 グループ: {quest.quest_group.name}</span>
                </div>
              </div>
            </div>
            <div className="quest-actions">
              {/* 「＋ アイデアを追加」はアイデアタブの一覧上部へ移動（下記 tab==="ideas"）。編集/遷移/削除は C 接続済み。 */}
              {canEdit && (
                <>
                  <button className="btn btn-outline" type="button" onClick={() => router.push(`/quests/${questId}/edit`)}>クエスト編集</button>
                  <RowMenu
                    items={[
                      ...(quest.status !== "completed" && nextStatus
                        ? [{ label: `ステータスを進める（→ ${STATUS_LABEL[nextStatus]}）`, onClick: () => void onTransition() }]
                        : []),
                      { label: "クエストを削除", danger: true, onClick: () => void onDelete() },
                    ]}
                  />
                </>
              )}
            </div>
          </div>
        </section>

        {/* クエスト内アクティビティ（ビジネス層カード・レビュー#3）＝ヘッダーと2段組。アイデア/実績へリンク。
            ※更新/チャット/評価/引用など業務イベントへの本格刷新は次段階（現状は FR-36 成果系フィード）。 */}
        <section className="card quest-activity" aria-label="クエスト内アクティビティ">
          <ActivityFeed title="クエスト内アクティビティ" load={loadQuestFeed} emptyText="このクエストの活動はまだありません。" />
        </section>
        </div>{/* .quest-head-row */}

        {/* 💬 新着の議論（ビジネス層・レビュー#3）＝このクエストで自分の未読チャット（他ユーザー投稿）があるアイデア。
            通知が拾わない「他ユーザー同士の会話」に気付いてチャットへ直行する動線。クエストでは**常設**（未読ゼロは空状態）。 */}
        {ideas !== null && (
          <section className="card unread-panel" aria-label="新着の議論">
            <div className="section-head">
              <h2 className="unread-panel__title">💬 新着の議論</h2>
              {unreadDiscussions.length > 0 && (
                <span className="unread-panel__n">{unreadDiscussions.reduce((s, i) => s + i.unreadChat, 0)} 件の未読</span>
              )}
            </div>
            {unreadDiscussions.length > 0 ? (
              <ul className="unread-list">
                {unreadDiscussions.map((i) => (
                  <li key={i.id}>
                    <Link className="unread-item" href={`/ideas/${i.id}/chat`} onClick={() => markIdeaFromQuest(questId)}>
                      <QuestIcon name={i.title} color={quest.color} imageUrl={i.iconUrl ?? undefined} size="xs" />
                      <span className="unread-item__title">{i.title}</span>
                      <span className="badge badge-danger">💬 +{i.unreadChat}</span>
                      {i.lastChatAt && <span className="unread-item__time">{chatAgo(i.lastChatAt)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted text-sm" style={{ margin: "var(--space-2) 0 0" }}>未読のチャットはありません。ほかのメンバーの新しい投稿があるとここに表示されます。</p>
            )}
          </section>
        )}

        {/* ゲーム風パネル2つ（KPI＋クエスト内ランキング）を同じ行に（レビュー#3）。ゲームモード OFF では非表示。 */}
        {gameEnabled && (
        <div className="quest-panels">
        {/* クエスト KPI＝一目でクエストの状態 */}
        <section className="pixel-panel quest-kpi" aria-label="クエスト KPI">
          <h3>★ クエスト KPI ★</h3>
          <div className="quest-kpi__grid">
            <div className="quest-kpi__item"><span className="quest-kpi__ico" aria-hidden>💡</span><span className="quest-kpi__num">{quest.idea_count}</span><span className="quest-kpi__label">アイデア</span></div>
            <div className="quest-kpi__item"><span className="quest-kpi__ico" aria-hidden>👥</span><span className="quest-kpi__num">{quest.member_count}</span><span className="quest-kpi__label">パーティー</span></div>
            {(() => {
              const du = deadlineUrgency(quest.deadline, todayISO());
              const txt = du.level === "none" ? "—" : du.level === "over" ? "超過" : String(du.days);
              return (
                <div className="quest-kpi__item">
                  <span className="quest-kpi__ico" aria-hidden>⏳</span>
                  <span className="quest-kpi__num" data-urgency={du.level}>{txt}</span>
                  <span className="quest-kpi__label">{du.level === "over" || du.level === "none" ? "締切" : "締切まで(日)"}</span>
                </div>
              );
            })()}
            <div className="quest-kpi__item"><span className="quest-kpi__ico" aria-hidden>⭐</span><span className="quest-kpi__num">{ideas ? ideas.filter((i) => i.evalstate === "done").length : "—"}</span><span className="quest-kpi__label">評価済み</span></div>
          </div>
        </section>

        {/* クエスト内 週間ランキング（G・実接続＝GET /rankings?scope=quest:{id}&period=this_week・G.5） */}
        <section className="pixel-panel rank-panel" aria-label="クエスト内 週間ランキング">
          <h3>★ クエスト内ランキング ★</h3>
          <div className="rank-panel__sub">このクエストの活動で獲得（今週・EXP＋コイン）</div>
          <ol className="rank-list">
            {(ranking?.data ?? []).slice(0, 3).map((r, i) => {
              const me = ranking?.me?.rank === r.rank;
              return (
                <li key={r.user.id} className={me ? "is-me" : undefined}>
                  <span className="rank-medal" aria-label={`${i + 1}位`}>{["🥇", "🥈", "🥉"][i]}</span>
                  <Avatar name={r.user.name} imageUrl={r.user.avatar ?? undefined} size="sm" level={r.user.level ?? undefined} />
                  <span className="rank-name">{r.user.name}{me && <span className="rank-you">（あなた）</span>}</span>
                  <span className="rank-score"><span className="total">{r.score}</span><span className="brk"><span className="exp">EXP{r.xp}</span> <span className="coin">◆{r.coin}</span></span></span>
                </li>
              );
            })}
            {ranking && ranking.data.length === 0 && <li className="muted text-sm">今週の獲得はまだありません</li>}
          </ol>
        </section>
        </div>
        )}{/* .quest-panels */}
      </div>

      {/* タブ */}
      <div id="quest-tabs" className="tabs" role="tablist" aria-label="クエスト詳細のセクション">
        {TABS.map((t) => {
          const count = t.key === "party" ? party.length : t.key === "ideas" ? ideas?.length ?? null : null;
          return (
            <button key={t.key} className={`tab${tab === t.key ? " is-active" : ""}`} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}{count != null && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* アイデア一覧（D.1 実接続・公開＋自分の下書き＝サーバー強制の可視性） */}
      {tab === "ideas" && (
        <section aria-label="アイデア一覧">
          {/* アイデア追加＝SC-21（D.2・投稿成功で IDEAS_CHANGED→一覧再取得）。一覧の上に配置。
              ＋ステータス絞り込み（レビュー#3・すべて/未投票/フォロー中/自分の下書き）を標準一覧の前段に。 */}
          <div className="ideas-tab-toolbar">
            <div className="segmented idea-filter" role="radiogroup" aria-label="アイデアの絞り込み">
              {([["all", "すべて"], ["unvoted", "未投票"], ["following", "フォロー中"], ["draft", "自分の下書き"]] as const).map(([k, label]) => (
                <label key={k}>
                  <input type="radio" name="idea-filter" checked={ideaFilter === k} onChange={() => setIdeaFilter(k)} />
                  {label} <span className="idea-filter__n">{ideaCounts[k]}</span>
                </label>
              ))}
            </div>
            <button className="btn btn-primary" type="button" onClick={() => router.push(`/quests/${questId}/ideas/new`)}>＋ アイデアを追加</button>
          </div>
          {ideasError ? (
            <p className="form-error" role="alert">{ideasError}</p>
          ) : ideas === null ? (
            <p className="admin-muted">読み込み中…</p>
          ) : (
            <DataTable<Idea>
              storageKey="sc12-ideas-v2"
              data={visibleIdeas}
              columns={ideaColumns}
              rowId={(r) => r.id}
              unit="件"
              perPage={20}
              searchFields="件名・提案価値"
              exportName="アイデア一覧"
              emptyText="まだアイデアがありません。「＋ アイデアを追加」から投稿できます。"
              onRowClick={(r) => {
                markIdeaFromQuest(questId);
                try { sessionStorage.setItem(QSCROLL_KEY + questId, String(window.scrollY)); } catch { /* 無視 */ }
                router.push(`/ideas/${r.id}`);
              }}
              cardRaw={(r) => (
                // カード表示＝ダッシュボードの「未投票のアイデア」カード（vote-card）と共通の見た目（レビュー#3）。
                // 未投票＝クイック投票▲/▼／投票済＝結果表示／下書き＝続き。中身（提案価値）を見て判断できる。
                <article className={"card card-accent vote-card" + (r.mystate === "voted" ? " is-voted" : "")}>
                  <div className="between">
                    <span className="idea-title-row">
                      <QuestIcon name={r.title} color={quest.color} imageUrl={r.iconUrl ?? undefined} size="sm" />
                      <Link className="card-title" href={`/ideas/${r.id}`} onClick={() => markIdeaFromQuest(questId)}>{r.title}</Link>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
                      {r.revision > 1 && <span className="badge badge-muted" title="編集された（版あり）">🔄</span>}
                      <span className={`badge ${YOU[r.mystate][1]}`}>{YOU[r.mystate][0]}</span>
                      {!r.draft && <button type="button" className={"idea-follow" + (r.following ? " is-on" : "")} aria-pressed={r.following} title={r.following ? "フォロー解除" : "フォロー"} onClick={() => void toggleFollow(r.id, r.following)}>★</button>}
                    </span>
                  </div>
                  {r.value && <div className="vote-card__value">{r.value}</div>}
                  <div className="vote-card__poster poster"><Avatar name={r.poster} imageUrl={r.posterAvatar ?? undefined} size="sm" /><span className="name text-sm muted">投稿: {r.poster}</span></div>
                  {!r.draft && <Link className="dash-chat-link" href={`/ideas/${r.id}/chat`} onClick={() => markIdeaFromQuest(questId)}>💬 チャットで議論{r.comments > 0 ? `（${r.comments}）` : ""}</Link>}
                  {r.draft ? (
                    <div className="vote-actions"><Link className="btn btn-outline" style={{ flex: 1, justifyContent: "center" }} href={`/ideas/${r.id}`} onClick={() => markIdeaFromQuest(questId)}>下書きを続ける</Link></div>
                  ) : r.mystate === "unvoted" ? (
                    <div className="vote-actions">
                      <button type="button" className="vote-quick agree" onClick={() => void quickVote(r.id, "approve")}>▲ 賛成</button>
                      <button type="button" className="vote-quick disagree" onClick={() => void quickVote(r.id, "oppose")}>▼ 反対</button>
                    </div>
                  ) : (
                    <div className="vote-voted-note">あなたの投票: {r.myVote === "approve" ? "▲ 賛成" : "▼ 反対"} ・ 賛成{r.agree} / 反対{r.disagree}</div>
                  )}
                </article>
              )}
            />
          )}
        </section>
      )}

      {/* 全文検索（J・実接続＝GET /quests/{id}/search・PGroonga） */}
      {tab === "search" && (
        <section aria-label="全文検索">
          <div className="list-toolbar">
            <div className="filters">
              <input className="input ft-q" type="search" placeholder="キーワードで全文検索" aria-label="全文検索" value={ftq} onChange={(e) => setFtq(e.target.value)} />
              <select className="select" style={{ width: "auto" }} aria-label="検索対象" value={ftScope} onChange={(e) => setFtScope(e.target.value)}>
                <option value="">対象: すべて</option>
                <option value="idea">アイデア</option>
                <option value="chat">チャット</option>
                <option value="attachment">添付ファイル名</option>
              </select>
            </div>
            {ftq.trim() && <span className="list-count">{ftTotal} 件</span>}
          </div>
          {!ftq.trim() ? (
            <div className="list-empty">キーワードを入力してください（このクエスト内のアイデア・チャット・添付ファイル名を検索）。</div>
          ) : ftLoading && ftRows.length === 0 ? (
            <div className="list-empty">検索中…</div>
          ) : ftRows.length === 0 ? (
            <div className="list-empty">「{ftq}」に一致する結果がありません。</div>
          ) : (
            <div className="stack">
              {ftRows.map((r, i) => (
                <Link
                  key={`${r.type}-${r.attachment_id ?? r.chat_message_id ?? r.idea_id ?? i}`}
                  className="card card-accent ft-result"
                  href={r.idea_id ? (r.type === "idea" ? `/ideas/${r.idea_id}` : `/ideas/${r.idea_id}/chat`) : "#"}
                >
                  <div className="ft-result__head"><span className="badge badge-muted">{FT_TYPE_LABEL[r.type]}</span><span className="ft-result__ctx">{r.idea_title}</span></div>
                  <p className="ft-result__snippet">{renderSnippet(r.snippet_html)}</p>
                </Link>
              ))}
              {ftTotal > ftPerPage && (
                <div className="row-center" style={{ gap: "var(--space-3)", justifyContent: "center" }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled={ftPage <= 1 || ftLoading} onClick={() => setFtPage((p) => Math.max(1, p - 1))}>← 前へ</button>
                  <span className="muted text-sm">{ftPage} / {Math.max(1, Math.ceil(ftTotal / ftPerPage))}</span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={ftPage >= Math.ceil(ftTotal / ftPerPage) || ftLoading} onClick={() => setFtPage((p) => p + 1)}>次へ →</button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* パーティー（実接続・C.1/C.3） */}
      {tab === "party" && (
        <section aria-label="パーティー">
          <div className="list-toolbar">
            <div className="muted text-sm">クエストの参加メンバーと権限（所有者/管理権限者が編集可）</div>
            {canEdit && (
              <button className="btn btn-outline btn-sm" type="button" onClick={() => router.push(`/quests/${questId}/edit`)}>パーティー・権限を編集</button>
            )}
          </div>
          <div className="card tab-party-card" style={{ padding: 0 }}>
            <ul className="member-list">
              {party.map((m) => (
                <li className="member-row" key={m.user.user_id}>
                  <Avatar name={m.user.display_name} imageUrl={m.user.avatar_image_url ?? undefined} />
                  <span className="member-name">{m.user.display_name}{m.is_creator && <span className="badge badge-muted" style={{ marginLeft: 6 }}>作成者</span>}</span>
                  <span className="member-perms">
                    {PERM_VIEW_ORDER.filter((p) => m.permissions.includes(p)).map((p) => (
                      <span key={p} className={`badge ${p === "owner" ? "" : "badge-muted"}`}>{PERM_BADGE[p]}</span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="hint" style={{ marginTop: "var(--space-3)" }}>※ 新規参加メンバーの既定権限＝投票＋アイデア作成＋コメント。評価者/クエスト管理などは所有者/管理権限者が付与。</p>
        </section>
      )}

      {/* 概要（実接続・C.1） */}
    </section>
  );
}
