"use client";

// SC-41 ランキング（ゲーム層）＝会社内全メンバーを期間（今週/先週/今月/通算）で順位付け（G.5 実接続）。
// スコア＝期間内の獲得XP＋獲得コイン（ダッシュボード/クエスト内週間ランキングと同定義・SP は対象外）。
// 正＝doc/画面設計/mocks/SC-41_ランキング.html・screens/SC-41・API設計 G.5・§7。
// getRankings（period×scope=company・me 常時同梱）。自分の行は me.rank と一致する順位で強調。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner, Avatar, CountUp } from "@/components/ui";

import { getRankings, type RankingMe, type RankingPeriod } from "../api";
import "../ranking.css";

type Period = "week" | "last" | "month" | "total";
const TO_API: Record<Period, RankingPeriod> = { week: "this_week", last: "last_week", month: "this_month", total: "all" };

const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "今週" },
  { key: "last", label: "先週" },
  { key: "month", label: "今月" },
  { key: "total", label: "通算" },
];
const PERIOD_LABEL: Record<Period, string> = { week: "今週", last: "先週", month: "今月", total: "通算" };
const RESET_NOTE: Record<Period, string> = {
  week: "週次でリセット（毎週月曜 0:00 起点）。",
  last: "先週（前週 月曜〜日曜）の確定結果。",
  month: "今月（当月1日〜）の累計。",
  total: "アカウント作成からの通算（リセットなし）。",
};
const MEDAL = ["🥇", "🥈", "🥉"];

type Ranked = { n: string; lv: number | null; me: boolean; xp: number; coin: number; score: number; rank: number };

export function RankingView() {
  const [period, setPeriod] = useState<Period>("week");
  const [list, setList] = useState<Ranked[]>([]);
  const [me, setMe] = useState<RankingMe | null>(null);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    const r = await getRankings(TO_API[p]).catch(() => null);
    if (r) {
      setMe(r.me);
      setList(r.data.map((row) => ({
        n: row.user.name || "?", lv: row.user.level ?? null,
        me: r.me.rank != null && row.rank === r.me.rank,
        xp: row.xp, coin: row.coin, score: row.score, rank: row.rank,
      })));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(period); }, [load, period]);

  const totalUsers = me?.total_users ?? list.length;
  const top3 = list.slice(0, 3);
  const podium = [top3[1], top3[0], top3[2]].filter(Boolean) as Ranked[]; // 2・1・3

  function jumpToMe() {
    const el = listRef.current?.querySelector<HTMLElement>("li.is-me");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate?.([{ filter: "brightness(1.6)" }, { filter: "brightness(1)" }], { duration: 800 });
  }

  return (
    <section aria-label="ランキング">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="rank-title">ランキング</h1>

      {/* 期間切替 */}
      <div className="rank-tabs" role="tablist" aria-label="集計期間">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            className={period === p.key ? "is-active" : undefined}
            aria-selected={period === p.key}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="rank-scope">
        <strong>会社内の全メンバー</strong>を対象に、<strong>{PERIOD_LABEL[period]}</strong>の
        <strong>獲得スコア（獲得XP＋獲得コイン）</strong>で順位付け。<span>{RESET_NOTE[period]}</span>
        魔法/リアクションはスコアに影響しません。
      </p>

      {/* あなたの順位サマリー（me は圏外でも同梱） */}
      {(() => {
        const meRow = list.find((m) => m.me);
        const myName = meRow?.n ?? "あなた";
        return (
          <section className="card card-accent myrank" style={{ ["--accent" as string]: "var(--color-primary)" } as React.CSSProperties} aria-label="あなたの順位">
            <Avatar name={myName} size="sm" level={meRow?.lv ?? undefined} />
            <div>
              <div>
                <strong>{myName}（あなた）</strong>
              </div>
              <div>
                <span className="myrank__pos">{me?.rank != null ? `${me.rank}位` : "圏外"}</span> <span className="myrank__of">/ 全{totalUsers}人中</span>
              </div>
            </div>
            <div className="myrank__score">
              スコア <span className="exp"><CountUp value={me?.score ?? 0} /></span>
              <button className="btn btn-outline myrank__jump" type="button" onClick={jumpToMe} disabled={!meRow}>
                ▼ 自分の順位へ
              </button>
            </div>
          </section>
        );
      })()}
      {loading && <Spinner label="読み込み中…" />}
      {!loading && list.length === 0 && <p className="role-note">この期間のランキングデータがありません。</p>}

      {/* ランキング本体（ゲーム層・CRTガラス） */}
      <section className="pixel-panel rank-panel full" aria-label="ランキング">
        <h3>★ 社内ランキング ★</h3>
        <div className="rank-panel__sub">{PERIOD_LABEL[period]}の獲得EXP＋コイン</div>

        {/* 表彰台 TOP3（2・1・3 の順で中央を高く）。key に period を含め、期間切替で登場演出を再生。 */}
        <div className="podium" key={period}>
          {podium.map((m) => (
            <div key={m.rank} className={`podium__col rank${m.rank}${m.me ? " is-me" : ""}`}>
              <span className="podium__medal">{MEDAL[m.rank - 1]}</span>
              <Avatar name={m.n} size="sm" level={m.lv ?? undefined} />
              <span className="podium__name">
                {m.n}
                {m.me ? "（あなた）" : ""}
              </span>
              <span className="podium__score"><CountUp value={m.score} /></span>
              <div className="podium__block">{m.rank}</div>
            </div>
          ))}
        </div>

        {/* 全件（key に period を含め、期間切替で自分の行の登場ハイライトを再生） */}
        <ol className="rank-list" ref={listRef} key={period}>
          {list.map((m) => (
            <li key={m.rank} className={m.me ? "is-me" : undefined}>
              <span className="rank-no">{m.rank}</span>
              <span className="rank-medal" aria-label={`${m.rank}位`}>
                {m.rank <= 3 ? MEDAL[m.rank - 1] : ""}
              </span>
              <Avatar name={m.n} size="sm" level={m.lv ?? undefined} />
              <span className="rank-name">
                {m.n}
                {m.me && <span className="rank-you">（あなた）</span>}
              </span>
              <span className="rank-score">
                <span className="total">{m.score}</span>
                <span className="brk">
                  <span className="exp">EXP{m.xp}</span> <span className="coin">◆{m.coin}</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="role-note" style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
        スコア＝<strong>期間内に獲得した XP ＋ 獲得したコインの合計</strong>です（ダッシュボード／クエスト内の週間ランキングと同じ定義）。SP はランキングの対象外です。
      </p>
    </section>
  );
}
