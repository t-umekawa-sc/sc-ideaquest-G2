"use client";

// SC-54 アイデアコンテスト詳細（ドメイン T・FR-46）。SC-12 クエスト詳細を流用＝ヘッダー＋アイデア一覧タブ
// （応募中/入賞/殿堂入り/お蔵入り）＋表彰台（ランキング3軸）＋Tier1 参加導線＋管理者の表彰確定。
// 認可はサーバー権威（参加/確定は権限が無ければ 403＝スナックバーで案内・UIは非表示に依存しない）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ActivitySpark, Avatar, Button, Modal, RowMenu, ScreenPurpose, useConfirm, useSnackbar } from "@/components/ui";
import { ActivityFeed } from "@/features/feed/components/ActivityFeed";
import { getQuestActivities } from "@/features/feed/api";
import { getQuestActivity, type QuestActivity } from "@/features/quests/api";
import { listIdeas, type IdeaCard } from "@/features/ideas/api";
import { searchQuest, type SearchRow, type SearchType } from "@/features/search/api";
import { parseSnippet } from "@/features/search/snippet";

import {
  decideContestParticipation,
  deleteContest,
  finalizeContest,
  getContest,
  getContestParticipants,
  getContestRanking,
  getParticipantCandidates,
  requestContestParticipation,
  setContestEvaluator,
  updateContest,
  type ContestCandidate,
  type ContestDetail,
  type ContestParticipant,
  type ContestRankingEntry,
} from "../api";
import {
  CONTEST_IDEA_TABS,
  CONTEST_MODE_LABEL,
  CONTEST_RANKING_AXES,
  CONTEST_STATUS_BADGE,
  contestStatusLabel,
} from "../types";
import "../contests.css";

const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");
const MEDAL = ["🥇", "🥈", "🥉"];
// 会期の状態順（隣接1段で前進・後退とも可・§4.1）。
const STATUS_ORDER = ["draft", "open", "judging", "closed", "archived"];

export function ContestDetailView({ contestId }: { contestId: string }) {
  const router = useRouter();
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [ideas, setIdeas] = useState<IdeaCard[]>([]);
  const [rankings, setRankings] = useState<Record<string, ContestRankingEntry[]>>({});
  const [activity, setActivity] = useState<QuestActivity | null>(null); // 活動の活発さ（日次スパーク）
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState(CONTEST_IDEA_TABS[0].key);
  const [view, setView] = useState("ideas");       // 上位タブ: ideas | search | party
  const [ftq, setFtq] = useState("");              // 全文検索クエリ（SC-12 と同一 UI）
  const [ftScope, setFtScope] = useState("");      // 検索対象（すべて/idea/chat/attachment）
  const [ftRows, setFtRows] = useState<SearchRow[]>([]);
  const [ftTotal, setFtTotal] = useState(0);
  const [ftPage, setFtPage] = useState(1);
  const [ftLoading, setFtLoading] = useState(false);
  const ftPerPage = 20;
  const [participants, setParticipants] = useState<ContestParticipant[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);          // パーティ追加ピッカー
  const [candQ, setCandQ] = useState("");
  const [candidates, setCandidates] = useState<ContestCandidate[]>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const c = await getContest(contestId, signal).catch(() => null);
    if (!c) { setNotFound(true); setLoading(false); return; }
    setContest(c);
    const [list, ...ranks] = await Promise.all([
      listIdeas(c.quest_id, { limit: 100 }).catch(() => null),
      ...CONTEST_RANKING_AXES.map((a) => getContestRanking(contestId, a.key, signal).catch(() => null)),
    ]);
    setIdeas(list?.data ?? []);
    const rmap: Record<string, ContestRankingEntry[]> = {};
    CONTEST_RANKING_AXES.forEach((a, i) => { rmap[a.key] = ranks[i]?.data ?? []; });
    setRankings(rmap);
    setLoading(false);
    // 活動の活発さ（日次スパーク）＝backing quest の活動集計を流用（取得失敗は非表示）。
    void getQuestActivity(c.quest_id).then(setActivity).catch(() => setActivity(null));
  }, [contestId]);

  // コンテスト内アクティビティ（ActivityFeed）＝backing quest の活動フィードを流用。
  const questId = contest?.quest_id;
  const loadFeed = useCallback(
    (cursor?: string | null) => (questId ? getQuestActivities(questId, cursor) : Promise.resolve(null)),
    [questId],
  );

  // 💬 新着の議論＝自分が参加する（投稿者 or Tier2承認）アイデアで未読があるもの（新しい順）。
  const myIdeaSet = useMemo(() => new Set(contest?.my_participating_idea_ids ?? []), [contest]);
  const unreadDiscussions = useMemo(
    () => ideas
      .filter((i) => (i.unread_chat_count ?? 0) > 0 && myIdeaSet.has(i.id))
      .sort((a, b) => (b.last_chat_at ?? "").localeCompare(a.last_chat_at ?? "")),
    [ideas, myIdeaSet],
  );

  // クエリ/対象の変更でページを先頭へ戻す（SC-12 と同一）。
  useEffect(() => { setFtPage(1); }, [ftq, ftScope]);
  // 🔍 全文検索（backing quest の既存 J＝GET /quests/{id}/search を流用・デバウンス・SC-12 と同一挙動）。
  useEffect(() => {
    const term = ftq.trim();
    if (view !== "search" || !term || !questId) { setFtRows([]); setFtTotal(0); return; }
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
  }, [ftq, ftScope, ftPage, view, questId]);

  // 👥 パーティ（Tier1 参加者）＝運営がタブを開いたら取得（承認待ちを先頭）。
  useEffect(() => {
    if (view !== "party" || !contest?.can_manage) return;
    const ac = new AbortController();
    getContestParticipants(contestId, ac.signal).then(setParticipants).catch(() => setParticipants([]));
    return () => ac.abort();
  }, [view, contest?.can_manage, contestId, reload]);

  async function decideParticipation(userId: string, status: "approved" | "rejected") {
    setBusy(true);
    try {
      const r = await decideContestParticipation(contestId, userId, status);
      if (!r) { snack({ type: "error", title: "更新できませんでした（権限が必要です）" }); return; }
      snack({ type: "success", title: status === "approved" ? "参加を承認しました" : "参加を却下しました" });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "更新に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string, name: string) {
    const ok = await confirm({
      variant: "danger",
      title: "参加者を排除",
      msg: `「${name}」をこのコンテストから排除しますか？ 投稿・投票・チャットができなくなります（再参加には再申請が必要）。投稿済みのアイデア等は監査のため残ります。`,
    });
    if (!ok) return;
    await decideParticipation(userId, "rejected");
  }

  async function toggleEvaluator(userId: string, granted: boolean) {
    setBusy(true);
    try {
      const r = await setContestEvaluator(contestId, userId, granted);
      if (!r) { snack({ type: "error", title: "更新できませんでした（権限が必要です）" }); return; }
      snack({ type: "success", title: granted ? "審査員に設定しました" : "審査員を解除しました" });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "更新に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  // パーティ追加ピッカー＝会社ユーザー候補をデバウンス取得（運営のみ）。
  useEffect(() => {
    if (!addOpen) return;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      getParticipantCandidates(contestId, candQ.trim() || undefined, ac.signal)
        .then(setCandidates).catch(() => setCandidates([]));
    }, 250);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [addOpen, candQ, contestId, reload]);

  async function addMember(userId: string) {
    setBusy(true);
    try {
      const r = await decideContestParticipation(contestId, userId, "approved");
      if (!r) { snack({ type: "error", title: "追加できませんでした（権限が必要です）" }); return; }
      snack({ type: "success", title: "参加者に追加しました" });
      setCandidates((cs) => cs.filter((c) => c.user_id !== userId));
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "追加に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load, reload]);

  // アイデアをタブ別に仕分け（contest_idea_flags＋is_selected から導出）。
  const { shelvedIds, hofIds } = useMemo(() => {
    const shelved = new Set<string>();
    const hof = new Set<string>();
    for (const f of contest?.flags ?? []) {
      if (f.flag === "shelved") shelved.add(f.idea_id);
      if (f.flag === "hall_of_fame") hof.add(f.idea_id);
    }
    return { shelvedIds: shelved, hofIds: hof };
  }, [contest]);

  const tabIdeas = useMemo(() => {
    if (tab === "selected") return ideas.filter((i) => i.is_selected);
    if (tab === "hall_of_fame") return ideas.filter((i) => hofIds.has(i.id));
    if (tab === "shelved") return ideas.filter((i) => shelvedIds.has(i.id));
    return ideas.filter((i) => !shelvedIds.has(i.id)); // 応募中＝お蔵入り以外
  }, [tab, ideas, hofIds, shelvedIds]);

  const tabCount = useCallback((key: string) => {
    if (key === "selected") return ideas.filter((i) => i.is_selected).length;
    if (key === "hall_of_fame") return ideas.filter((i) => hofIds.has(i.id)).length;
    if (key === "shelved") return ideas.filter((i) => shelvedIds.has(i.id)).length;
    return ideas.filter((i) => !shelvedIds.has(i.id)).length;
  }, [ideas, hofIds, shelvedIds]);

  async function join() {
    setBusy(true);
    try {
      const r = await requestContestParticipation(contestId);
      if (!r) { snack({ type: "error", title: "参加できませんでした" }); return; }
      snack({
        type: "success",
        title: r.status === "approved" ? "参加しました（投稿・投票ができます）" : "参加リクエストを送信しました（承認待ち）",
      });
    } catch {
      snack({ type: "error", title: "参加リクエストに失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    const ok = await confirm({
      title: "表彰を確定しますか？",
      msg: "各軸の上位入賞者に XP・コイン・入賞バッジを付与し、コンテストを「表彰確定（closed）」にします。",
      confirmLabel: "確定する",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await finalizeContest(contestId);
      if (!r) { snack({ type: "error", title: "確定できませんでした（権限が必要です）" }); return; }
      snack({ type: "success", title: `表彰を確定しました（受賞 ${r.awarded_users} 名・入賞 ${r.selected_ideas} 件）` });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "表彰確定に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  // 会期の遷移（運営操作・隣接1段で前進/後退とも可・§4.1）。judging→closed の前進のみ finalize（表彰付与）が担う。
  async function changeStatus(to: string) {
    if (!contest) return;
    const forwardToClosed = contest.status === "judging" && to === "closed";
    if (forwardToClosed) { await finalize(); return; }  // 表彰確定は専用フロー（付与＋確認）
    const dir = STATUS_ORDER.indexOf(to) > STATUS_ORDER.indexOf(contest.status) ? "進める" : "戻す";
    const ok = await confirm({
      title: `ステータスを${dir}`,
      msg: `「${contestStatusLabel(contest.status)}」→「${contestStatusLabel(to)}」に${dir}ます。よろしいですか？（隣接1段）`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await updateContest(contestId, { status: to });
      if (!r) { snack({ type: "error", title: "変更できませんでした（権限が必要です）" }); return; }
      snack({ type: "success", title: "ステータスを更新しました", msg: `${contestStatusLabel(to)} にしました。` });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "状態の変更に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!contest) return;
    const ok = await confirm({
      variant: "danger",
      title: "コンテストを削除",
      msg: `「${contest.theme}」を削除しますか？ 一覧・詳細から見えなくなります（投稿されたアイデア等は監査のため保持されます）。`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteContest(contestId);
      snack({ type: "success", title: "コンテストを削除しました" });
      router.push("/contests");
    } catch {
      snack({ type: "error", title: "削除できませんでした（権限が必要な場合があります）" });
      setBusy(false);
    }
  }

  if (loading) return <section className="contest-detail"><p className="hint">読み込み中…</p></section>;
  if (notFound || !contest) {
    return (
      <section className="contest-detail">
        <Link className="backlink" href="/contests">← アイデアコンテスト一覧</Link>
        <p className="hint">コンテストが見つかりませんでした。</p>
      </section>
    );
  }

  const period = `${fmtDate(contest.starts_at)} 〜 ${fmtDate(contest.ends_at)}`;

  return (
    <section className="contest-detail">
      <Link className="backlink backlink--float" href="/contests">← アイデアコンテスト一覧</Link>

      {/* 概要（左）＋コンテスト内アクティビティ（右）を2段組（クエスト詳細 .quest-top と同構成）。 */}
      <div className="contest-top">
      <header className="card contest-head">
        <div className="contest-head__top">
          <div className="contest-head__main">
            <div className="contest-head__titles">
              <h1 className="page-title">{contest.theme}</h1>
              <span className={`badge ${CONTEST_STATUS_BADGE[contest.status] ?? "badge-muted"}`}>
                {contestStatusLabel(contest.status)}
              </span>
            </div>
            {contest.description && <p className="contest-head__desc">{contest.description}</p>}
            <dl className="contest-meta">
              <div><dt>種別</dt><dd>{CONTEST_MODE_LABEL[contest.mode] ?? contest.mode}</dd></div>
              <div><dt>会期</dt><dd>{period}</dd></div>
              <div><dt>応募数</dt><dd>{ideas.length} 件</dd></div>
            </dl>
          </div>
          {/* ボタン＋運営メニューはパネル右上（クエスト詳細 .quest-actions と同配置）。権限が無ければサーバーが 403。 */}
          <div className="contest-head__actions">
            {contest.status === "open" && <Button variant="primary" onClick={join} disabled={busy}>参加する</Button>}
            {(() => {
              const idx = STATUS_ORDER.indexOf(contest.status);
              const next = idx >= 0 && idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : undefined;
              const prev = idx >= 1 ? STATUS_ORDER[idx - 1] : undefined;
              const fwdLabel = next === "closed" ? "🏆 表彰を確定する" : next ? `ステータスを進める（→ ${contestStatusLabel(next)}）` : "";
              return (
                <RowMenu items={[
                  ...(next ? [{ label: fwdLabel, onClick: () => void changeStatus(next) }] : []),
                  ...(prev ? [{ label: `ステータスを戻す（→ ${contestStatusLabel(prev)}）`, onClick: () => void changeStatus(prev) }] : []),
                  { label: "コンテストを削除", danger: true, onClick: () => void onDelete() },
                ]} />
              );
            })()}
          </div>
        </div>
      </header>

        <section className="card contest-activity" aria-label="コンテスト内アクティビティ">
          <ActivityFeed title="コンテスト内アクティビティ" load={loadFeed}
                        emptyText="このコンテストの活動はまだありません。" />
        </section>
      </div>

      {/* 💬 新着の議論（自分が参加するアイデアの未読・左）＋ 📈 活動の活発さ（右）を2段組。 */}
      <div className="contest-grid-2">
        <section className="card unread-panel" aria-label="新着の議論">
          <div className="section-head">
            <h2 className="unread-panel__title">💬 新着の議論</h2>
            {unreadDiscussions.length > 0 && (
              <span className="unread-panel__n">{unreadDiscussions.reduce((s, i) => s + (i.unread_chat_count ?? 0), 0)} 件の未読</span>
            )}
          </div>
          {unreadDiscussions.length > 0 ? (
            <ul className="unread-list">
              {unreadDiscussions.map((i) => (
                <li key={i.id}>
                  <Link className="unread-item" href={`/ideas/${i.id}/chat`}>
                    <span className="unread-item__title">{i.title}</span>
                    <span className="badge badge-danger">💬 +{i.unread_chat_count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">未読のチャットはありません。あなたが参加しているアイデアに新しい投稿があるとここに表示されます。</p>
          )}
        </section>

        <section className="card" aria-label="活動の活発さ">
          <div className="section-head"><h2 className="unread-panel__title">📈 活動の活発さ</h2></div>
          <ActivitySpark
            daily={(activity?.daily ?? []).map((d) => ({ date: d.date, count: d.count }))}
            label={`直近${activity?.days ?? 14}日・💬 合計 ${activity?.total ?? 0} 件`}
            legend="棒＝日次コメント数（コンテスト内の公開アイデア横断・直近3日を強調）。"
            emptyText="まだ活動の記録はありません。参加者の投稿があるとここに表示されます。"
          />
        </section>
      </div>

      <section className="contest-podium" aria-label="表彰台（ランキング）">
        {CONTEST_RANKING_AXES.map((axis) => {
          const rows = (rankings[axis.key] ?? []).slice(0, 3);
          return (
            <div key={axis.key} className="card contest-rank">
              <h3 className="contest-rank__title">{axis.label}</h3>
              {rows.length === 0 ? (
                <p className="hint">データがありません。</p>
              ) : (
                <ol className="contest-rank__list">
                  {rows.map((r, i) => (
                    <li key={`${axis.key}-${r.user_id}-${i}`}>
                      <span className="contest-rank__medal">{MEDAL[i] ?? `${r.rank}.`}</span>
                      <span className="contest-rank__name">{r.display_name ?? "（不明）"}</span>
                      <span className="contest-rank__metric">{r.metric}{axis.unit}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </section>

      {/* 上位タブ（クエスト詳細と同じ .tabs）＝アイデア / 全文検索 / パーティ（運営のみ）。 */}
      <div className="tabs" role="tablist" style={{ marginTop: "var(--space-6)" }}>
        {([["ideas", "💡 アイデア"], ["search", "🔍 全文検索"],
           ...(contest.can_manage ? [["party", "👥 パーティ"]] : [])] as [string, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} className={`tab${view === k ? " is-active" : ""}`}
                  onClick={() => setView(k)}>
            {label}{k === "party" && participants != null && <span className="tab-count">{participants.length}</span>}
          </button>
        ))}
      </div>

      {view === "ideas" && (
        <>
          <div className="segmented contest-seg" role="radiogroup" aria-label="アイデアの絞り込み" style={{ marginTop: "var(--space-3)" }}>
            {CONTEST_IDEA_TABS.map((t) => (
              <label key={t.key}>
                <input type="radio" name="contest-idea-tab" checked={tab === t.key} onChange={() => setTab(t.key)} />
                {t.label} <span className="seg-n">{tabCount(t.key)}</span>
              </label>
            ))}
          </div>
          {tabIdeas.length === 0 ? (
            <p className="hint">このタブに該当するアイデアはありません。</p>
          ) : (
            <ul className="contest-ideas">
              {tabIdeas.map((i) => (
                <li key={i.id} className="card contest-idea">
                  <Link href={`/ideas/${i.id}`} className="contest-idea__title">{i.title}</Link>
                  <p className="contest-idea__value">{i.value}</p>
                  <div className="contest-idea__meta">
                    <span>👤 {i.author.display_name}</span>
                    <span>🗳️ {i.vote_summary.approve}</span>
                    {i.is_selected && <span className="badge badge-success">入賞</span>}
                    {hofIds.has(i.id) && <span className="badge badge-muted">🏆 殿堂入り</span>}
                    {shelvedIds.has(i.id) && <span className="badge badge-muted">📦 お蔵入り</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* 全文検索（J・実接続＝GET /quests/{id}/search・PGroonga）＝SC-12 クエスト詳細と同一 UI。 */}
      {view === "search" && (
        <section aria-label="全文検索">
          <div className="list-toolbar">
            <div className="filters" data-sp-host>
              <input className="input ft-q" type="search" placeholder="キーワードで全文検索" aria-label="全文検索" value={ftq} onChange={(e) => setFtq(e.target.value)} />
              <select className="select" style={{ width: "auto" }} aria-label="検索対象" value={ftScope} onChange={(e) => setFtScope(e.target.value)}>
                <option value="">対象: すべて</option>
                <option value="idea">アイデア</option>
                <option value="chat">チャット</option>
                <option value="attachment">添付ファイル名</option>
              </select>
              <ScreenPurpose
                summary="対象ごとの検索項目：アイデア＝タイトル・本文・価値・補足／チャット＝メッセージ本文／添付ファイル名＝ファイル名。「すべて」は3種を横断。"
                dialogTitle="全文検索の対象について"
              >
                <div className="dialog-section"><div className="dialog-label">対象＝すべて</div><p style={{ margin: 0 }}>下記3種を横断して検索します（このコンテスト内・公開アイデアのみ）。</p></div>
                <div className="dialog-section"><div className="dialog-label">アイデア</div><p style={{ margin: 0 }}>タイトル・本文・狙う価値・補足（note）を対象に検索します。</p></div>
                <div className="dialog-section"><div className="dialog-label">チャット</div><p style={{ margin: 0 }}>アイデアの議論チャットの<strong>メッセージ本文</strong>を対象に検索します。</p></div>
                <div className="dialog-section"><div className="dialog-label">添付ファイル名</div><p style={{ margin: 0 }}>アイデア／チャットに添付されたファイルの<strong>ファイル名</strong>を対象に検索します（ファイルの中身は対象外）。</p></div>
              </ScreenPurpose>
            </div>
            {ftq.trim() && <span className="list-count">{ftTotal} 件</span>}
          </div>
          {!ftq.trim() ? (
            <div className="list-empty">キーワードを入力してください（このコンテスト内のアイデア・チャット・添付ファイル名を検索）。</div>
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

      {/* パーティ（Tier1 参加者）＝SC-12 クエスト詳細のパーティタブと同じ構造（参加リクエスト＋メンバー一覧）。運営のみ。 */}
      {view === "party" && contest.can_manage && (() => {
        const list = participants ?? [];
        const pending = list.filter((p) => p.status === "requested");
        const members = list.filter((p) => p.status === "approved");
        const excluded = list.filter((p) => p.status === "rejected" || p.status === "left");
        return (
          <section aria-label="パーティ">
            <div className="list-toolbar">
              <div className="muted text-sm">コンテストの参加者（運営が承認/排除・審査員を管理）</div>
              <Button variant="primary" size="sm" onClick={() => { setCandQ(""); setAddOpen(true); }}>＋ メンバーを追加</Button>
            </div>
            {/* 主催者（所有者）＝クエスト詳細のパーティと同じく先頭に表示。 */}
            {contest.owner_display_name && (
              <div className="join-req-block">
                <h3 className="join-req-title">👑 主催者</h3>
                <div className="card" style={{ padding: 0 }}>
                  <ul className="member-list">
                    <li className="member-row">
                      <Avatar name={contest.owner_display_name} />
                      <span className="member-name">{contest.owner_display_name}</span>
                      <span className="badge badge-muted" style={{ marginLeft: "auto" }}>主催者</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}
            {participants == null ? (
              <p className="admin-muted">読み込み中…</p>
            ) : (
              <>
                {/* 参加リクエスト（承認待ち・上位）＝運営のみ。行で承認/却下。 */}
                {pending.length > 0 && (
                  <div className="join-req-block">
                    <h3 className="join-req-title">📩 参加リクエスト<span className="tab-count">{pending.length}</span></h3>
                    <div className="card" style={{ padding: 0 }}>
                      <ul className="member-list">
                        {pending.map((p) => (
                          <li key={p.user_id} className="member-row join-req-row">
                            <Avatar name={p.display_name ?? "?"} />
                            <span className="member-name">{p.display_name ?? "（不明）"}</span>
                            <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
                              <Button variant="primary" size="sm" onClick={() => void decideParticipation(p.user_id, "approved")} disabled={busy}>承認</Button>
                              <button className="btn btn-outline btn-sm" type="button" onClick={() => void decideParticipation(p.user_id, "rejected")} disabled={busy}>却下</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {/* 参加中メンバー一覧＝審査員トグル＋排除（論理削除）。 */}
                <div className="join-req-block">
                  <h3 className="join-req-title">👥 参加中<span className="tab-count">{members.length}</span></h3>
                  <div className="card" style={{ padding: 0 }}>
                    {members.length === 0 ? (
                      <p className="admin-muted" style={{ padding: "var(--space-3)" }}>参加中のメンバーはいません。</p>
                    ) : (
                      <ul className="member-list">
                        {members.map((p) => (
                          <li key={p.user_id} className="member-row">
                            <Avatar name={p.display_name ?? "?"} />
                            <span className="member-name">
                              {p.display_name ?? "（不明）"}
                              {p.is_evaluator && <span className="badge badge-success" style={{ marginLeft: 6 }}>⚖️ 審査員</span>}
                            </span>
                            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                              <label className="checkbox" style={{ fontSize: "var(--text-sm)" }}>
                                <input type="checkbox" checked={p.is_evaluator} disabled={busy}
                                       onChange={(e) => void toggleEvaluator(p.user_id, e.target.checked)} />
                                審査員
                              </label>
                              <button className="btn btn-outline btn-sm" type="button"
                                      onClick={() => void removeMember(p.user_id, p.display_name ?? "（不明）")} disabled={busy}>排除</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                {/* 排除済み（rejected/left）＝履歴として表示。再承認で参加に戻せる。 */}
                {excluded.length > 0 && (
                  <div className="join-req-block">
                    <h3 className="join-req-title">🚫 排除済み<span className="tab-count">{excluded.length}</span></h3>
                    <div className="card" style={{ padding: 0 }}>
                      <ul className="member-list">
                        {excluded.map((p) => (
                          <li key={p.user_id} className="member-row contest-member--excluded">
                            <Avatar name={p.display_name ?? "?"} />
                            <span className="member-name">{p.display_name ?? "（不明）"}</span>
                            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                              <span className="badge badge-muted">{p.status === "left" ? "退出" : "排除済み"}</span>
                              <button className="btn btn-outline btn-sm" type="button"
                                      onClick={() => void decideParticipation(p.user_id, "approved")} disabled={busy}>再承認</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        );
      })()}

      {addOpen && (
        <Modal open={addOpen} title="メンバーを追加" size="md" onClose={() => setAddOpen(false)}>
          <div className="modal__body">
            <input className="input" type="search" value={candQ} onChange={(e) => setCandQ(e.target.value)}
                   placeholder="氏名で検索" aria-label="ユーザー検索" autoFocus />
            {candidates.length === 0 ? (
              <p className="hint" style={{ marginTop: "var(--space-3)" }}>
                {candQ.trim() ? "該当するユーザーがいません。" : "追加できる会社ユーザーがいません（全員が参加済みの可能性）。"}
              </p>
            ) : (
              <ul className="member-list" style={{ marginTop: "var(--space-2)" }}>
                {candidates.map((cand) => (
                  <li key={cand.user_id} className="member-row">
                    <Avatar name={cand.display_name} />
                    <span className="member-name">{cand.display_name}</span>
                    <button className="btn btn-primary btn-sm" type="button" style={{ marginLeft: "auto" }}
                            onClick={() => void addMember(cand.user_id)} disabled={busy}>追加</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="modal__footer">
            <button className="btn btn-outline" type="button" onClick={() => setAddOpen(false)}>閉じる</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

const FT_TYPE_LABEL: Record<string, string> = { idea: "アイデア", chat: "チャット", attachment: "添付" };
// スニペットは keyword のみ <mark>、他はテキストとして React 描画（dangerouslySetInnerHTML 不使用・SC-12 と同一）。
function renderSnippet(html: string): ReactNode {
  return parseSnippet(html).map((seg, i) =>
    seg.hit ? <mark key={i} className="keyword">{seg.text}</mark> : <span key={i}>{seg.text}</span>,
  );
}
