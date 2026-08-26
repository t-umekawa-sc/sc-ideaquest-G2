"use client";

// SC-12 クエスト詳細＝クエストヘッダー＋クエスト内週間ランキング＋タブ（アイデア一覧/パーティー/全文検索/概要）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-12_クエスト詳細.html（DoD＝モック一致）。
// 接続範囲＝ヘッダー/概要/パーティー（GET /quests/{id}・C.1）＋状態遷移（C.5）＋削除（C.2）＋
// 編集導線（SC-11 /quests/{id}/edit）＋**アイデアタブ（D.1 GET /quests/{id}/ideas・IDEAS_CHANGED 購読）**。
// アイデアタブ/全文検索(J)/評価列(F)/クエスト内週間ランキング(G) すべて実接続。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar, DataTable, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { searchQuest, type SearchRow, type SearchType } from "@/features/search/api";
import { getRankings, type RankingResponse } from "@/features/ranking/api";
import { ApiError } from "@/lib/api/client";
import { QuestIcon } from "@/components/layout";
import {
  deleteQuest,
  getQuest,
  QUESTS_CHANGED_EVENT,
  transitionQuest,
  type QuestDetail,
} from "../api";
import { IDEAS_CHANGED_EVENT, listIdeas, type IdeaCard } from "@/features/ideas/api";
import "../quests.css";

// アイデアタブの行ビュー型（SC-12・D.1）。列/カードの描画に必要な最小射影。
type Idea = {
  id: string; title: string; poster: string; initial: string; agree: number; disagree: number;
  comments: number; ev: number; evalstate: "pending" | "done"; mystate: "unvoted" | "voted" | "mine" | "draft"; created: number; draft: boolean;
};
// IdeaCardDTO（D.1）→ 行ビュー。評価（F）＝`evaluation` 集計（評価済 overall_avg=n/5・可視0は null）。あなた
// バッジは status＋my_vote から導出（下書き＝draft／自分の投票あり＝voted／なし＝unvoted）。created＝更新からの経過日数。
function toIdeaView(c: IdeaCard): Idea {
  const isDraft = c.status === "draft";
  const days = Math.max(0, Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000));
  const mystate: Idea["mystate"] = isDraft ? "draft" : c.my_vote ? "voted" : "unvoted";
  const name = c.author.display_name || "?";
  return {
    id: c.id, title: c.title, poster: name, initial: name.slice(0, 1),
    agree: c.vote_summary.approve, disagree: c.vote_summary.oppose, comments: c.comment_count,
    ev: c.evaluation.overall_avg ?? -1, evalstate: c.evaluation.state === "done" ? "done" : "pending",
    mystate, created: days, draft: isDraft,
  };
}
const YOU: Record<string, [string, string]> = { draft: ["下書き", "badge-muted"], unvoted: ["未投票", "badge-danger"], voted: ["投票済", "badge-success"], mine: ["自分の投稿", "badge-muted"] };
const daysText = (r: Idea) => (r.created <= 0 ? "今日" : `${r.created}日前`);
const dash = <span className="muted">—</span>;

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
  { key: "about", label: "📋 概要" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// 全文検索（J）の種別ラベルと安全なスニペット描画。
const FT_TYPE_LABEL: Record<string, string> = { idea: "アイデア", chat: "チャット", attachment: "添付" };
const _ENT: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
function _decode(s: string): string {
  return s.replace(/&(?:lt|gt|amp|quot|#39);/g, (m) => _ENT[m] ?? m);
}
// PGroonga は user 文をエスケープし `<span class="keyword">…</span>` のみ生タグで注入（J.5）。
// dangerouslySetInnerHTML を使わず keyword span で分割し React 要素を組む（許可リストサニタイズ・§2.2④）。
function renderSnippet(html: string): React.ReactNode {
  return html.split(/(<span class="keyword">.*?<\/span>)/g).map((part, i) => {
    const m = part.match(/^<span class="keyword">([\s\S]*?)<\/span>$/);
    if (m) return <mark key={i} className="keyword">{_decode(m[1])}</mark>;
    return <span key={i}>{_decode(part)}</span>;
  });
}
function deadlineText(d: string | null | undefined): string {
  if (!d) return "未設定";
  return d.replaceAll("-", "/");
}

export function QuestDetailView({ questId }: { questId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const snack = useSnackbar();
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

  const ideaColumns: DataTableColumn<Idea>[] = [
    { key: "title", label: "件名", locked: true, width: 260, sortable: true, filter: { type: "text" }, sortVal: (r) => r.title, searchVal: (r) => r.title, csvVal: (r) => r.title,
      render: (r) => <><span className="idea-title">{r.title}</span>{r.draft && <> <span className="badge badge-muted">下書き</span></>}</> },
    { key: "poster", label: "投稿者", width: 150, sortable: true, filter: { type: "text" }, sortVal: (r) => r.poster, searchVal: (r) => r.poster, csvVal: (r) => r.poster,
      render: (r) => <span className="poster"><Avatar name={r.poster} size="sm" />{r.poster}</span> },
    { key: "votes", label: "賛成 / 反対", width: 120, align: "num", sortable: true, sortVal: (r) => r.agree, csvVal: (r) => (r.draft ? "" : `▲${r.agree} ▼${r.disagree}`),
      render: (r) => r.draft ? dash : <><span className="vote-agree">▲{r.agree}</span> / <span className="vote-disagree">▼{r.disagree}</span></> },
    { key: "comments", label: "💬", width: 72, align: "num", sortable: true, sortVal: (r) => r.comments, csvVal: (r) => (r.draft ? "" : String(r.comments)), render: (r) => r.draft ? dash : String(r.comments) },
    { key: "eval", label: "評価", width: 120, sortable: true, filter: { type: "enum", options: [["pending", "評価待ち"], ["done", "評価済"]] }, sortVal: (r) => r.ev, filterVal: (r) => r.evalstate,
      csvVal: (r) => (r.draft ? "" : r.evalstate === "done" ? (r.ev >= 0 ? `${r.ev}/5` : "評価済") : "評価待ち"),
      render: (r) => r.draft ? dash : (r.evalstate === "done"
        ? (r.ev >= 0 ? <span className={`badge ${r.ev >= 4 ? "badge-success" : "badge-muted"}`}>{r.ev}/5 評価</span> : <span className="badge badge-muted">評価済</span>)
        : <span className="badge">評価待ち</span>) },
  ];

  // クエスト内 週間ランキング（G・scope=quest:{id}・this_week・me 同梱）。
  useEffect(() => {
    let alive = true;
    void getRankings("this_week", { scope: `quest:${questId}`, limit: 3 })
      .then((r) => { if (alive) setRanking(r); }).catch(() => {});
    return () => { alive = false; };
  }, [questId]);
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
        <p><Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link></p>
        <div className="form-error" role="alert" style={{ marginTop: "var(--space-4)" }}>{loadError}</div>
      </section>
    );
  }
  if (!quest) {
    return (
      <section aria-label="クエスト詳細">
        <p><Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link></p>
        <p className="admin-muted" style={{ marginTop: "var(--space-4)" }}>読み込み中…</p>
      </section>
    );
  }

  const ownerName = quest.owner.display_name || "?";
  const party = quest.members;

  return (
    <section aria-label="クエスト詳細">
      <p><Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link></p>

      {/* ヘッダー＋クエスト内週間ランキング */}
      <div className="quest-top">
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
                  <span>⏳ 締切 {deadlineText(quest.deadline)}</span>
                  <span>👥 パーティー {quest.member_count}人</span>
                  <span>💡 アイデア {quest.idea_count}件</span>
                  <span className="poster" style={{ gap: 6 }}>👑 所有者: <Avatar name={ownerName} size="sm" /><span className="name">{ownerName}</span></span>
                  <span>🗂 グループ: {quest.quest_group.name}</span>
                </div>
              </div>
            </div>
            <div className="quest-actions">
              {/* アイデア追加＝SC-21（D.2 接続済み・投稿成功で IDEAS_CHANGED→一覧再取得）。編集/遷移/削除は C 接続済み。 */}
              <button className="btn btn-primary" type="button" onClick={() => router.push(`/quests/${questId}/ideas/new`)}>＋ アイデアを追加</button>
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
                  <Avatar name={r.user.name} size="sm" level={r.user.level ?? undefined} />
                  <span className="rank-name">{r.user.name}{me && <span className="rank-you">（あなた）</span>}</span>
                  <span className="rank-score"><span className="total">{r.score}</span><span className="brk"><span className="exp">EXP{r.xp}</span> <span className="coin">◆{r.coin}</span></span></span>
                </li>
              );
            })}
            {ranking && ranking.data.length === 0 && <li className="muted text-sm">今週の獲得はまだありません</li>}
          </ol>
        </section>
      </div>

      {/* タブ */}
      <div className="tabs" role="tablist" aria-label="クエスト詳細のセクション">
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
          {ideasError ? (
            <p className="form-error" role="alert">{ideasError}</p>
          ) : ideas === null ? (
            <p className="admin-muted">読み込み中…</p>
          ) : (
            <DataTable<Idea>
              storageKey="sc12-ideas"
              data={ideas}
              columns={ideaColumns}
              rowId={(r) => r.id}
              unit="件"
              perPage={20}
              searchFields="件名・投稿者"
              exportName="アイデア一覧"
              emptyText="まだアイデアがありません。「＋ アイデアを追加」から投稿できます。"
              onRowClick={(r) => router.push(`/ideas/${r.id}`)}
              cardLayout={(r) => ({
                title: r.title,
                badges: [{ label: YOU[r.mystate][0], cls: YOU[r.mystate][1] }],
                meta: [r.poster, daysText(r)],
                stats: [`賛成 ${r.agree} / 反対 ${r.disagree}`, `💬 ${r.comments}`],
              })}
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
              <select className="input" style={{ width: "auto" }} aria-label="検索対象" value={ftScope} onChange={(e) => setFtScope(e.target.value)}>
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
                  <Avatar name={m.user.display_name} />
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
      {tab === "about" && (
        <section aria-label="概要">
          <div className="card">
            <dl className="def-list">
              <dt>ステータス</dt><dd><span className={statusBadgeClass(quest.status)}>{STATUS_LABEL[quest.status] ?? quest.status}</span></dd>
              <dt>カテゴリー</dt><dd>{quest.categories.length ? quest.categories.join("、") : "—"}</dd>
              <dt>目的・テーマ</dt><dd>{quest.purpose || "—"}</dd>
              <dt>期限日</dt><dd>{deadlineText(quest.deadline)}</dd>
              <dt>クエストグループ</dt><dd>{quest.quest_group.name}</dd>
              <dt>所有者</dt><dd><span className="poster"><Avatar name={ownerName} size="sm" /><span className="name">{ownerName}</span></span></dd>
              <dt>パーティー</dt><dd>{quest.member_count}名</dd>
              <dt>アイデア数</dt><dd>{quest.idea_count}件</dd>
            </dl>
          </div>
        </section>
      )}
    </section>
  );
}
