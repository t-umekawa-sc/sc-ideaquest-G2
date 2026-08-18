"use client";

// SC-41 ランキング（ゲーム層）＝会社内全メンバーを期間（今週/先週/今月/通算）で順位付け。
// スコア＝期間内の獲得XP＋獲得コイン（ダッシュボード/クエスト内週間ランキングと同定義・SP は対象外）。
// 正＝doc/画面設計/mocks/SC-41_ランキング.html・doc/画面設計/screens/SC-41_ランキング.md。
// ランキング backend 未実装＝デモ fixtures（画面モック先行）。
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/ui";

import "../ranking.css";

type Period = "week" | "last" | "month" | "total";
type Member = {
  n: string;
  s: string;
  lv: number;
  me: boolean;
  week: [number, number];
  last: [number, number];
  month: [number, number];
  total: [number, number];
};

const MEMBERS: Member[] = [
  { n: "鈴木 花子", s: "鈴", lv: 12, me: false, week: [480, 50], last: [500, 45], month: [2100, 220], total: [14000, 1300] },
  { n: "山田 太郎", s: "山", lv: 7, me: true, week: [360, 45], last: [300, 30], month: [1500, 180], total: [7800, 720] },
  { n: "佐藤 大輔", s: "佐", lv: 3, me: false, week: [300, 40], last: [260, 25], month: [1300, 150], total: [2400, 210] },
  { n: "田中 美咲", s: "田", lv: 9, me: false, week: [300, 35], last: [360, 40], month: [1600, 190], total: [10500, 980] },
  { n: "伊藤 彩", s: "伊", lv: 8, me: false, week: [280, 30], last: [240, 25], month: [1200, 140], total: [9200, 860] },
  { n: "小林 直樹", s: "小", lv: 10, me: false, week: [260, 40], last: [320, 35], month: [1700, 200], total: [12000, 1150] },
  { n: "高橋 健", s: "高", lv: 6, me: false, week: [240, 25], last: [200, 20], month: [1000, 110], total: [6400, 600] },
  { n: "渡辺 剛", s: "渡", lv: 5, me: false, week: [210, 20], last: [180, 20], month: [900, 100], total: [4800, 430] },
  { n: "加藤 恵", s: "加", lv: 6, me: false, week: [190, 25], last: [210, 20], month: [950, 110], total: [6100, 560] },
  { n: "中村 優", s: "中", lv: 4, me: false, week: [160, 15], last: [150, 10], month: [700, 70], total: [3600, 320] },
  { n: "山本 麻衣", s: "山", lv: 7, me: false, week: [140, 20], last: [170, 15], month: [800, 90], total: [7500, 700] },
  { n: "吉田 翔", s: "吉", lv: 2, me: false, week: [90, 10], last: [80, 10], month: [400, 40], total: [1500, 120] },
];

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

type Ranked = Member & { xp: number; coin: number; score: number; rank: number };

export function RankingView() {
  const [period, setPeriod] = useState<Period>("week");
  const listRef = useRef<HTMLOListElement>(null);

  const list = useMemo<Ranked[]>(() => {
    return MEMBERS.map((m) => ({ ...m, xp: m[period][0], coin: m[period][1], score: m[period][0] + m[period][1] }))
      .sort((a, b) => b.score - a.score || b.xp - a.xp || a.n.localeCompare(b.n, "ja"))
      .map((m, i) => ({ ...m, rank: i + 1 }));
  }, [period]);

  const me = list.find((m) => m.me)!;
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

      {/* あなたの順位サマリー */}
      <section className="card card-accent myrank" style={{ ["--accent" as string]: "var(--color-primary)" } as React.CSSProperties} aria-label="あなたの順位">
        <Avatar name={me.n} size="sm" level={me.lv} />
        <div>
          <div>
            <strong>{me.n}（あなた）</strong>
          </div>
          <div>
            <span className="myrank__pos">{me.rank}位</span> <span className="myrank__of">/ 全{list.length}人中</span>
          </div>
        </div>
        <div className="myrank__score">
          スコア <span className="exp">{me.score}</span>
          <button className="btn btn-outline myrank__jump" type="button" onClick={jumpToMe}>
            ▼ 自分の順位へ
          </button>
        </div>
      </section>

      {/* ランキング本体（ゲーム層・CRTガラス） */}
      <section className="pixel-panel rank-panel full" aria-label="ランキング">
        <h3>★ 社内ランキング ★</h3>
        <div className="rank-panel__sub">{PERIOD_LABEL[period]}の獲得EXP＋コイン</div>

        {/* 表彰台 TOP3（2・1・3 の順で中央を高く） */}
        <div className="podium">
          {podium.map((m) => (
            <div key={m.n} className={`podium__col rank${m.rank}${m.me ? " is-me" : ""}`}>
              <span className="podium__medal">{MEDAL[m.rank - 1]}</span>
              <Avatar name={m.n} size="sm" level={m.lv} />
              <span className="podium__name">
                {m.n}
                {m.me ? "（あなた）" : ""}
              </span>
              <span className="podium__score">{m.score}</span>
              <div className="podium__block">{m.rank}</div>
            </div>
          ))}
        </div>

        {/* 全件 */}
        <ol className="rank-list" ref={listRef}>
          {list.map((m) => (
            <li key={m.n} className={m.me ? "is-me" : undefined}>
              <span className="rank-no">{m.rank}</span>
              <span className="rank-medal" aria-label={`${m.rank}位`}>
                {m.rank <= 3 ? MEDAL[m.rank - 1] : ""}
              </span>
              <Avatar name={m.n} size="sm" level={m.lv} />
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
