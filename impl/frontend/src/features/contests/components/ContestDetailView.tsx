"use client";

// SC-54 アイデアコンテスト詳細（ドメイン T・FR-46）。SC-12 クエスト詳細を流用＝ヘッダー＋アイデア一覧タブ
// （応募中/入賞/殿堂入り/お蔵入り）＋表彰台（ランキング3軸）＋Tier1 参加導線＋管理者の表彰確定。
// 認可はサーバー権威（参加/確定は権限が無ければ 403＝スナックバーで案内・UIは非表示に依存しない）。
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, useConfirm, useSnackbar } from "@/components/ui";
import { listIdeas, type IdeaCard } from "@/features/ideas/api";

import {
  finalizeContest,
  getContest,
  getContestRanking,
  requestContestParticipation,
  updateContest,
  type ContestDetail,
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

export function ContestDetailView({ contestId }: { contestId: string }) {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [ideas, setIdeas] = useState<IdeaCard[]>([]);
  const [rankings, setRankings] = useState<Record<string, ContestRankingEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState(CONTEST_IDEA_TABS[0].key);
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
  }, [contestId]);

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

  // 会期の前進遷移（運営操作・forward-only・§4.1）。judging→closed は finalize（表彰付与）が担うため別扱い。
  async function advanceStatus(to: string, label: string) {
    const ok = await confirm({ title: `${label}しますか？`, confirmLabel: label });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await updateContest(contestId, { status: to });
      if (!r) { snack({ type: "error", title: "変更できませんでした（権限が必要です）" }); return; }
      snack({ type: "success", title: `${label}しました` });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "状態の変更に失敗しました" });
    } finally {
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

      <header className="card contest-head">
        <div className="contest-head__top">
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
        <div className="contest-head__actions">
          {contest.status === "open" && <Button variant="primary" onClick={join} disabled={busy}>参加する</Button>}
          {/* 運営操作＝会期の前進（権限が無ければサーバーが 403）。 */}
          {contest.status === "draft" && (
            <button className="btn btn-primary" type="button" onClick={() => advanceStatus("open", "公募を開始")} disabled={busy}>▶ 公募を開始</button>
          )}
          {contest.status === "open" && (
            <button className="btn btn-outline" type="button" onClick={() => advanceStatus("judging", "審査に進む")} disabled={busy}>審査に進む →</button>
          )}
          {contest.status === "judging" && (
            <button className="btn btn-primary" type="button" onClick={finalize} disabled={busy}>🏆 表彰を確定</button>
          )}
          {contest.status === "closed" && (
            <button className="btn btn-outline" type="button" onClick={() => advanceStatus("archived", "アーカイブ")} disabled={busy}>アーカイブ</button>
          )}
        </div>
      </header>

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

      <div className="segmented contest-seg" role="radiogroup" aria-label="アイデアの絞り込み" style={{ marginTop: "var(--space-6)" }}>
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
    </section>
  );
}
