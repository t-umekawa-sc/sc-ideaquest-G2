"use client";

// SC-01 ダッシュボード（ゲーム層ヒーロー＋週間ランキング＋下書き/未投票/参加中/フォロー中/下段）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-01_ダッシュボード.html（DoD＝モック一致）。
// 実接続＝I 集約 `GET /dashboard`（1往復で全パネル）。ヒーローの初期値は server の GET /me 残高（初回描画）で、
// 取得後は集約 hero を優先。クイック投票＝POST /ideas/{id}/vote・フォロー★＝D follow EP。空パネルは非表示（§7）。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

import { Avatar, CountUp, useSnackbar } from "@/components/ui";
import { getTeamFeed } from "@/features/feed/api";
import { ActivityFeed } from "@/features/feed/components/ActivityFeed";
import { LevelUpWatcher } from "./LevelUpWatcher";
import { SparkBurst } from "./SparkBurst";
import { XpFloat } from "./XpFloat";
import { bumpedXpPct } from "../xpAward";
import { levelRank } from "@/lib/levelTitle";
import { reduceMotion } from "@/lib/motion";
import { deadlineUrgency, deadlineCountdown, todayISO } from "@/lib/deadline";
import { followIdea, unfollowIdea, voteIdea, type IdeaVoteType } from "@/features/ideas/api";
import {
  getDashboard,
  type DashboardData,
  type FollowedIdea,
  type UnvotedIdea,
} from "../api";
import "../dashboard.css";

type Balance = {
  level: number; xpPct: number; xpToNext: number;
  xpInLevel: number; levelSpan: number; xp: number;
  coin: number; sp: number;
};

const TILES = [
  { href: "/quests", ico: "🗺️", label: "クエスト一覧" },
  { href: "/shop", ico: "🛒", label: "ショップ" },
  { href: "/avatar", ico: "🧍", label: "アバター" },
  { href: "/spells", ico: "✦", label: "魔法 / スキル" },
  { href: "/achievements", ico: "🏆", label: "実績 / バッジ" },
  { href: "/ranking", ico: "📊", label: "ランキング" },
  { href: "/notifications", ico: "🔔", label: "通知" },
];

function hrefOfDraft(d: DashboardData["drafts"][number]): string {
  if (d.kind === "quest") return `/quests/${d.quest_id}`;
  if (d.kind === "idea") return `/ideas/${d.idea_id}`;
  return `/ideas/${d.idea.id}/eval`;
}

export function DashboardView({
  displayName,
  accountId,
  balance,
  admin,
}: {
  displayName: string;
  accountId: string;
  balance: Balance;
  admin: { systemAdmin: boolean; companyAdmin: boolean; qgAdmin: boolean };
}) {
  const snackbar = useSnackbar();
  const [data, setData] = useState<DashboardData | null>(null);
  const [votes, setVotes] = useState<Record<string, IdeaVoteType>>({});
  const [unfollowed, setUnfollowed] = useState<Record<string, boolean>>({});
  const bonusShown = useRef(false);
  // XP バーはマウント後に 0→現在値へ充填（CSS transition で演出・ゲーム感）。
  const [barFilled, setBarFilled] = useState(false);
  useEffect(() => setBarFilled(true), []);
  // クイック投票の押下バースト（クリック位置に火花・楽観削除でカードが消えても見えるよう固定表示）。
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const burstId = useRef(0);
  const fireBurst = (e: { clientX: number; clientY: number }) => {
    if (reduceMotion()) return;
    const id = ++burstId.current;
    setBursts((b) => [...b, { id, x: e.clientX, y: e.clientY }]);
    setTimeout(() => setBursts((b) => b.filter((z) => z.id !== id)), 650);
  };
  // #8 獲得フィードバック（段階ハイブリッド step1）＝投票が XP 付与された時のみ「+5 XP」を出し、
  // ヒーロー XP バーを楽観的に +5 分だけ前進＋pulse（連動）。金額 +5 は暫定（xpAward.VOTE_XP）。
  const [xpBump, setXpBump] = useState(0);       // 読み込み後に付与された XP の累積（楽観・server 権威は次ロードで整合）
  const [awardKey, setAwardKey] = useState(0);   // バー pulse を確実に再生させる再マウントキー
  const [xpFloats, setXpFloats] = useState<{ id: number; x: number; y: number; label: string }[]>([]);
  const xpFloatId = useRef(0);
  const fireXpFloat = (e: { clientX: number; clientY: number }, label: string) => {
    if (reduceMotion()) return;
    const id = ++xpFloatId.current;
    setXpFloats((f) => [...f, { id, x: e.clientX, y: e.clientY, label }]);
    setTimeout(() => setXpFloats((f) => f.filter((z) => z.id !== id)), 1100);
  };
  // チームアクティビティ（SC-01 §4.8b・FR-36・参加クエスト横断の公開種別のみ）。
  const loadTeamFeed = useCallback((cursor?: string | null) => getTeamFeed(cursor), []);

  useEffect(() => {
    let alive = true;
    void getDashboard().then((d) => {
      if (!alive || !d) return;
      setData(d);
      if (d.login_bonus && !bonusShown.current) {
        bonusShown.current = true;
        snackbar({ type: "reward", title: "デイリーログインボーナス！",
                   rewards: [{ k: "xp", t: `+${d.login_bonus.xp}` }], icon: "🎁" });
      }
    });
    return () => { alive = false; };
  }, [snackbar]);

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
  const unvoted = (data?.unvoted_ideas ?? []).filter((v) => !votes[v.id]);
  const quests = data?.quests ?? [];
  const followed = (data?.followed_ideas ?? []).filter((f) => !unfollowed[f.id]);
  const ranking = data?.weekly_ranking;
  const notifs = data?.notifications?.data ?? [];
  const roles = data?.roles ?? {
    is_qg_admin: admin.qgAdmin, is_company_account_admin: admin.companyAdmin, is_system_admin: admin.systemAdmin,
  };

  const quickVote = async (idea: UnvotedIdea, type: IdeaVoteType, e?: { clientX: number; clientY: number }) => {
    if (e) fireBurst(e);  // 押下の手応え（成否に関わらず即時・視覚のみ）
    setVotes((s) => ({ ...s, [idea.id]: type }));  // 楽観＝リストから外す
    const res = await voteIdea(idea.id, type).catch(() => null);
    if (!res) {
      setVotes((s) => { const n = { ...s }; delete n[idea.id]; return n; });  // 失敗はロールバック
      snackbar({ type: "error", msg: "投票に失敗しました。時間をおいて再度お試しください。" });
      return;
    }
    // #8: server が実際に付与した XP 差分（res.xp_delta＝初回・日次上限内なら +5・それ以外 0）でフィードバック。
    // 金額の正はサーバー（step2 で backend delta に一本化＝frontend 定数を撤去）。
    if (res.xp_delta > 0) {
      setXpBump((x) => x + res.xp_delta);
      setAwardKey((k) => k + 1);
      if (e) fireXpFloat(e, `+${res.xp_delta} XP`);
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

  return (
    <div className="dash-page stack">
      <LevelUpWatcher accountId={accountId} level={level} />
      {bursts.map((b) => <SparkBurst key={b.id} x={b.x} y={b.y} />)}
      {xpFloats.map((f) => <XpFloat key={f.id} x={f.x} y={f.y} label={f.label} />)}
      {/* 上部2カラム：ヒーロー＋週間ランキング */}
      <div className="dash-top">
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
            {(ranking?.data ?? []).slice(0, 3).map((r, i) => {
              const me = ranking?.me?.rank === r.rank;
              return (
                <li key={r.user.id} className={me ? "is-me" : undefined}>
                  <span className="rank-medal" aria-label={`${i + 1}位`}>{["🥇", "🥈", "🥉"][i]}</span>
                  <Avatar name={r.user.name} size="sm" level={r.user.level} />
                  <span className="rank-name">{r.user.name}{me && <span className="rank-you">（あなた）</span>}</span>
                  <span className="rank-score"><span className="total">{r.score}</span><span className="brk"><span className="exp">EXP{r.xp}</span> <span className="coin">◆{r.coin}</span></span></span>
                </li>
              );
            })}
            {ranking && ranking.data.length === 0 && <li className="muted text-sm">今週の獲得はまだありません</li>}
          </ol>
          <div className="rank-panel__foot"><Link href="/ranking">ランキングをすべて見る →</Link></div>
        </section>
      </div>

      {/* 下書き（1件も無ければ非表示） */}
      {drafts.length > 0 && (
        <section aria-label="下書き">
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
        </section>
      )}

      {/* 未投票のアイデア（0件なら非表示） */}
      {unvoted.length > 0 && (
        <section aria-label="未投票のアイデア">
          <div className="section-head">
            <h2>未投票のアイデア</h2>
            <span className="muted text-sm">参加クエストで、あなたがまだ投票していないアイデア</span>
          </div>
          <div className="vote-grid">
            {unvoted.map((v) => (
              <article key={v.id} className="card card-accent vote-card">
                <div className="between"><Link className="card-title" href={`/ideas/${v.id}`}>{v.title}</Link><span className="badge badge-muted">未投票</span></div>
                <div className="vote-card__quest">{v.quest.title}</div>
                <div className="vote-card__value">{v.value}</div>
                <div className="vote-card__poster poster"><Avatar name={v.poster.name} size="sm" /><span className="name text-sm muted">投稿: {v.poster.name}</span></div>
                <div className="vote-actions">
                  <button type="button" className="vote-quick agree" aria-label="賛成する" onClick={(e) => quickVote(v, "approve", e)}>▲ 賛成</button>
                  <button type="button" className="vote-quick disagree" aria-label="反対する" onClick={(e) => quickVote(v, "oppose", e)}>▼ 反対</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 参加中クエスト（0件なら非表示） */}
      {quests.length > 0 && (
        <section aria-label="参加中クエスト">
          <div className="section-head">
            <h2>参加中クエスト</h2>
            <Link href="/quests">すべて見る →</Link>
          </div>
          <div className="quest-grid">
            {quests.map((q) => {
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
            })}
          </div>
        </section>
      )}

      {/* フォロー中のアイデア（0件なら非表示） */}
      {followed.length > 0 && (
        <section aria-label="フォロー中のアイデア">
          <div className="section-head">
            <h2>フォロー中のアイデア</h2>
            <span className="muted text-sm">動きがあると通知でお知らせ</span>
          </div>
          <div className="follow-grid">
            {followed.map((f) => {
              const frozen = f.quest.quest_status === "completed";
              return (
                <article key={f.id} className={`card card-accent follow-card${frozen ? " is-frozen" : ""}`}>
                  <button type="button" className="follow-star" aria-pressed={true} aria-label="フォロー解除" onClick={() => toggleFollow(f)}>★</button>
                  <Link className="card-title" href={`/ideas/${f.id}`}>{f.title}</Link>
                  <div className="follow-quest">{f.quest.title}{frozen && <> <span className="badge badge-muted" title="クエスト完了で凍結。以後の通知はありません（解除のみ可・再フォロー不可）">⏸ 完了（凍結）</span></>}</div>
                  <div className="follow-value">{f.value}</div>
                  <div className="follow-card__poster poster"><Avatar name={f.poster.name} size="sm" /><span className="name text-sm muted">投稿: {f.poster.name}</span></div>
                  <div className="follow-stats">
                    <span className="vote-agree">▲ {f.vote_summary.approve}</span>
                    <span className="vote-disagree">▼ {f.vote_summary.oppose}</span>
                  </div>
                  {frozen && <div className="follow-frozen-note text-xs muted">⏸ 完了済み＝以後の通知なし。★で<strong>解除</strong>のみ可（再フォロー不可）。</div>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* チームアクティビティ（SC-01 §4.8b・FR-36・参加クエスト横断の場の活動＝自分宛の「通知」とは別物） */}
      <section className="card" aria-label="チームアクティビティ">
        <ActivityFeed title="チームアクティビティ" load={loadTeamFeed} showQuest emptyText="参加中クエストの新しい活動はまだありません。" />
      </section>

      {/* 下段：最近の通知＋ショートカット */}
      <div className="dash-bottom">
        <section className="card" aria-label="最近の通知">
          <div className="section-head">
            <h2 style={{ fontSize: "var(--text-lg)" }}>最近の通知</h2>
            <Link href="/notifications">すべての通知 →</Link>
          </div>
          <ul className="notif-list">
            {notifs.length === 0 && <li className="muted text-sm">新しい通知はありません</li>}
            {notifs.map((n) => (
              <li key={n.id} className={n.is_read ? undefined : "unread"}>
                <span className="notif-ico">{n.icon ?? "🔔"}</span>
                <div className="notif-body">
                  <div>{n.body}</div>
                  {n.context && <div className="muted">{n.context}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="ショートカット">
          <div className="section-head"><h2 style={{ fontSize: "var(--text-lg)" }}>ショートカット</h2></div>
          <div className="tiles">
            {TILES.map((t) => (
              <Link key={t.href} className="tile" href={t.href}>
                <span className="tile__ico">{t.ico}</span>
                <span className="tile__label">{t.label}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ロール条件付き管理導線（サーバー権威 roles で出し分け） */}
      {(roles.is_qg_admin || roles.is_company_account_admin || roles.is_system_admin) && (
        <div className="admin-links">
          <span className="role-note">▼ ロールに応じて表示</span>
          {roles.is_qg_admin && <Link className="btn btn-outline btn-sm" href="/admin/quest-groups">クエストグループ管理</Link>}
          {roles.is_company_account_admin && <Link className="btn btn-outline btn-sm" href="/admin/accounts">会社アカウント管理</Link>}
          {roles.is_system_admin && <Link className="btn btn-outline btn-sm" href="/admin/companies">システム管理</Link>}
        </div>
      )}
    </div>
  );
}
