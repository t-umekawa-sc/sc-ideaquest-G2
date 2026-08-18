"use client";

// SC-12 クエスト詳細＝クエストヘッダー＋クエスト内週間ランキング＋タブ（アイデア一覧/パーティー/全文検索/概要）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-12_クエスト詳細.html（DoD＝モック一致）。
// クエスト backend 未実装＝フロントエンド実装フロー規約に沿う画面モック先行（デモ fixtures）。
// アイデア一覧は DataTable（client モード）。行クリックで SC-22 アイデア詳細（/ideas/[id]・現状スタブ）へ。
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar, DataTable } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import "../quests.css";

type Idea = {
  id: string; title: string; poster: string; initial: string; agree: number; disagree: number;
  comments: number; ev: number; evalstate: "pending" | "done"; mystate: "unvoted" | "voted" | "mine" | "draft"; created: number; draft: boolean;
};
const IDEAS: Idea[] = [
  { id: "okihai", title: "置き配の写真通知", poster: "佐藤 大輔", initial: "佐", agree: 15, disagree: 5, comments: 4, ev: -1, evalstate: "pending", mystate: "voted", created: 5, draft: false },
  { id: "yakan", title: "夜間配送の集約", poster: "鈴木 花子", initial: "鈴", agree: 12, disagree: 3, comments: 8, ev: 3, evalstate: "done", mystate: "unvoted", created: 3, draft: false },
  { id: "konpo", title: "梱包資材の削減", poster: "伊藤 彩", initial: "伊", agree: 11, disagree: 0, comments: 2, ev: -1, evalstate: "pending", mystate: "voted", created: 2, draft: false },
  { id: "saihai", title: "再配達の予測AI", poster: "田中 一郎", initial: "田", agree: 9, disagree: 2, comments: 6, ev: 5, evalstate: "done", mystate: "voted", created: 1, draft: false },
  { id: "route", title: "配送ルートの動的最適化", poster: "山田 太郎", initial: "山", agree: 7, disagree: 1, comments: 3, ev: -1, evalstate: "pending", mystate: "mine", created: 6, draft: false },
  { id: "drone", title: "ドローン配送の実証", poster: "高橋 実", initial: "高", agree: 5, disagree: 8, comments: 12, ev: 2, evalstate: "done", mystate: "unvoted", created: 4, draft: false },
  { id: "kyodo", title: "共同配送のマッチング（下書き）", poster: "山田 太郎", initial: "山", agree: 0, disagree: 0, comments: 0, ev: -1, evalstate: "pending", mystate: "draft", created: 7, draft: true },
];
const YOU: Record<string, [string, string]> = { draft: ["下書き", "badge-muted"], unvoted: ["未投票", "badge-danger"], voted: ["投票済", "badge-success"], mine: ["自分の投稿", "badge-muted"] };
const daysText = (r: Idea) => { const d = 7 - r.created; return d <= 0 ? "今日" : `${d}日前`; };
const dash = <span className="muted">—</span>;

const RANKING = [
  { name: "鈴木 花子", level: 12, total: 310, exp: 280, coin: 30, me: false },
  { name: "山田 太郎", level: 7, total: 235, exp: 210, coin: 25, me: true },
  { name: "田中 一郎", level: 9, total: 200, exp: 180, coin: 20, me: false },
];
const PARTY = [
  { name: "山田 太郎", ini: "山", level: 7, perms: [{ label: "👑 所有者", cls: "" }] },
  { name: "鈴木 花子", ini: "鈴", level: 12, perms: [{ label: "評価者", cls: "badge-muted" }, { label: "投票", cls: "badge-muted" }, { label: "作成", cls: "badge-muted" }, { label: "コメント", cls: "badge-muted" }] },
  { name: "佐藤 大輔", ini: "佐", level: 3, perms: [{ label: "評価者", cls: "badge-muted" }, { label: "投票", cls: "badge-muted" }, { label: "作成", cls: "badge-muted" }, { label: "コメント", cls: "badge-muted" }] },
  { name: "田中 一郎", ini: "田", level: 9, perms: [{ label: "クエスト管理", cls: "badge-muted" }, { label: "投票", cls: "badge-muted" }, { label: "作成", cls: "badge-muted" }, { label: "コメント", cls: "badge-muted" }] },
  { name: "高橋 実", ini: "高", level: 5, perms: [{ label: "投票", cls: "badge-muted" }, { label: "作成", cls: "badge-muted" }, { label: "コメント", cls: "badge-muted" }] },
  { name: "伊藤 彩", ini: "伊", level: 8, perms: [{ label: "投票", cls: "badge-muted" }, { label: "作成", cls: "badge-muted" }, { label: "コメント", cls: "badge-muted" }] },
];
// 全文検索のデモ対象（アイデア本文＋チャット＋添付ファイル名）。
const SEARCHABLE = [
  { id: "yakan", kind: "アイデア", ctx: "夜間配送の集約", text: "夜間帯の配送を1拠点に集約し、積載率を上げてコストとCO2を同時に削減する。" },
  { id: "route", kind: "アイデア", ctx: "配送ルートの動的最適化", text: "交通状況に応じてルートを動的に再計算し、配送効率を高める。" },
  { id: "yakan", kind: "チャット", ctx: "夜間配送の集約 / コメント", text: "積載率の現状値は約60%です。集約で75%を目標にしたいです。" },
  { id: "okihai", kind: "添付", ctx: "置き配の写真通知 / 添付", text: "置き配_通知フロー.pdf" },
];

const TABS = [
  { key: "ideas", label: "💡 アイデア", count: IDEAS.length },
  { key: "party", label: "👥 パーティー", count: PARTY.length },
  { key: "search", label: "🔍 全文検索", count: null },
  { key: "about", label: "📋 概要", count: null },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (<>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>);
}

export function QuestDetailView({ questId }: { questId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("ideas");
  const [ftq, setFtq] = useState("");
  const [ftScope, setFtScope] = useState("");

  const scopeMap: Record<string, string> = { idea: "アイデア", chat: "チャット", attachment: "添付" };
  const ftResults = ftq.trim()
    ? SEARCHABLE.filter((r) => (!ftScope || r.kind === scopeMap[ftScope]) && (r.text.includes(ftq) || r.ctx.includes(ftq)))
    : [];

  const ideaColumns: DataTableColumn<Idea>[] = [
    { key: "title", label: "件名", locked: true, width: 260, sortable: true, filter: { type: "text" }, sortVal: (r) => r.title, searchVal: (r) => r.title, csvVal: (r) => r.title,
      render: (r) => <><span className="idea-title">{r.title}</span>{r.draft && <> <span className="badge badge-muted">下書き</span></>}</> },
    { key: "poster", label: "投稿者", width: 150, sortable: true, filter: { type: "text" }, sortVal: (r) => r.poster, searchVal: (r) => r.poster, csvVal: (r) => r.poster,
      render: (r) => <span className="poster"><Avatar name={r.poster} size="sm" />{r.poster}</span> },
    { key: "votes", label: "賛成 / 反対", width: 120, align: "num", sortable: true, sortVal: (r) => r.agree, csvVal: (r) => (r.draft ? "" : `▲${r.agree} ▼${r.disagree}`),
      render: (r) => r.draft ? dash : <><span className="vote-agree">▲{r.agree}</span> / <span className="vote-disagree">▼{r.disagree}</span></> },
    { key: "comments", label: "💬", width: 72, align: "num", sortable: true, sortVal: (r) => r.comments, csvVal: (r) => (r.draft ? "" : String(r.comments)), render: (r) => r.draft ? dash : String(r.comments) },
    { key: "eval", label: "評価", width: 120, sortable: true, filter: { type: "enum", options: [["pending", "評価待ち"], ["done", "評価済"]] }, sortVal: (r) => r.ev, filterVal: (r) => r.evalstate, csvVal: (r) => (r.draft ? "" : r.evalstate === "done" ? `${r.ev}/5` : "評価待ち"),
      render: (r) => r.draft ? dash : (r.evalstate === "done" ? <span className={`badge ${r.ev >= 5 ? "badge-success" : "badge-muted"}`}>{r.ev}/5 評価</span> : <span className="badge">評価待ち</span>) },
    { key: "mystate", label: "あなた", width: 110, filter: { type: "enum", options: [["unvoted", "未投票"], ["voted", "投票済"], ["mine", "自分の投稿"], ["draft", "下書き"]] }, filterVal: (r) => r.mystate, csvVal: (r) => YOU[r.mystate][0],
      render: (r) => <span className={`badge ${YOU[r.mystate][1]}`}>{YOU[r.mystate][0]}</span> },
    { key: "created", label: "投稿日", width: 100, hiddenDefault: true, sortable: true, sortVal: (r) => r.created, csvVal: daysText, render: daysText },
  ];

  return (
    <section aria-label="クエスト詳細">
      <p><Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link></p>

      {/* ヘッダー＋クエスト内週間ランキング */}
      <div className="quest-top">
        <section className="card quest-head" aria-label="クエスト情報">
          <div className="quest-head__top">
            <div className="quest-head__main">
              <span className="quest-icon lg" style={{ ["--accent" as string]: "#0D9488" } as React.CSSProperties}>
                <span className="quest-icon__char">配</span>
                <span className="quest-icon__owner placeholder">山</span>
              </span>
              <div>
                <span className="badge badge-muted">業務改善</span>
                <span className="badge badge-success" style={{ marginLeft: 6 }}>評価中</span>
                <h1>配送ルート最適化</h1>
                <p className="quest-head__theme">配送コストと CO2 削減の両立を実現するアイデアを集める。</p>
                <div className="quest-meta">
                  <span className="soon">⏳ 締切 2026/12/20（あと3日）</span>
                  <span>👥 パーティー 6人</span>
                  <span>💡 アイデア 6件</span>
                  <span className="poster" style={{ gap: 6 }}>👑 所有者: <Avatar name="山田 太郎" size="sm" /><span className="name">山田 太郎</span></span>
                  <span>🗂 グループ: プロダクト開発部</span>
                </div>
              </div>
            </div>
            <div className="quest-actions">
              {/* アイデア追加＝SC-21（URL付きモーダル・Intercept）／クエスト編集＝SC-11 編集（未実装）＝接続までデモ。 */}
              <button className="btn btn-primary" type="button" onClick={() => router.push(`/quests/${questId}/ideas/new`)}>＋ アイデアを追加</button>
              <button className="btn btn-outline" type="button" onClick={() => router.push("/quests/new")}>クエスト編集</button>
            </div>
          </div>
        </section>

        <section className="pixel-panel rank-panel" aria-label="クエスト内 週間ランキング">
          <h3>★ クエスト内ランキング ★</h3>
          <div className="rank-panel__sub">このクエストの活動で獲得（今週・EXP＋コイン）</div>
          <ol className="rank-list">
            {RANKING.map((r, i) => (
              <li key={r.name} className={r.me ? "is-me" : undefined}>
                <span className="rank-medal" aria-label={`${i + 1}位`}>{["🥇", "🥈", "🥉"][i]}</span>
                <Avatar name={r.name} size="sm" level={r.level} />
                <span className="rank-name">{r.name}{r.me && <span className="rank-you">（あなた）</span>}</span>
                <span className="rank-score"><span className="total">{r.total}</span><span className="brk"><span className="exp">EXP{r.exp}</span> <span className="coin">◆{r.coin}</span></span></span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* タブ */}
      <div className="tabs" role="tablist" aria-label="クエスト詳細のセクション">
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? " is-active" : ""}`} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}{t.count != null && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* アイデア一覧 */}
      {tab === "ideas" && (
        <section aria-label="アイデア一覧">
          <DataTable<Idea>
            storageKey="sc12-ideas"
            data={IDEAS}
            columns={ideaColumns}
            rowId={(r) => r.id}
            unit="件"
            perPage={20}
            searchFields="件名・投稿者"
            exportName="アイデア一覧"
            emptyText="該当するアイデアがありません。条件を変えてお試しください。"
            onRowClick={(r) => router.push(`/ideas/${r.id}`)}
            cardLayout={(r) => ({
              title: r.title,
              badges: r.draft
                ? [{ label: "下書き", cls: "badge-muted" }]
                : [{ label: YOU[r.mystate][0], cls: YOU[r.mystate][1] }, { label: r.evalstate === "done" ? `${r.ev}/5 評価` : "評価待ち", cls: r.evalstate === "done" && r.ev >= 5 ? "badge-success" : "badge-muted" }],
              meta: [r.poster, daysText(r)],
              stats: r.draft ? ["公開前（投票・コメント対象外）"] : [`賛成 ${r.agree} / 反対 ${r.disagree}`, `💬 ${r.comments}`],
            })}
          />
          <p className="muted text-xs" style={{ marginTop: "var(--space-6)" }}>
            自分の下書きアイデアも一覧に表示されます（下書きバッジ・本人のみ）。下書きは公開して初めて投票・コメントの対象になります（一覧では賛成・反対／コメント／評価は「—」）。
          </p>
        </section>
      )}

      {/* 全文検索 */}
      {tab === "search" && (
        <section aria-label="全文検索">
          <div className="list-toolbar">
            <div className="filters">
              <input className="input ft-q" type="search" placeholder="キーワードで全文検索" aria-label="全文検索" value={ftq} onChange={(e) => setFtq(e.target.value)} />
              <select className="input" style={{ width: "auto" }} aria-label="検索対象" value={ftScope} onChange={(e) => setFtScope(e.target.value)}>
                <option value="">対象: すべて</option>
                <option value="idea">アイデア（件名/本文/価値/備考）</option>
                <option value="chat">チャット</option>
                <option value="attachment">添付ファイル名</option>
              </select>
            </div>
            {ftq.trim() && <span className="list-count">{ftResults.length} 件</span>}
          </div>
          {!ftq.trim() ? (
            <div className="list-empty">キーワードを入力してください（このクエスト内のアイデア・チャット・添付ファイル名を検索）。</div>
          ) : ftResults.length === 0 ? (
            <div className="list-empty">「{ftq}」に一致する結果がありません。</div>
          ) : (
            <div className="stack">
              {ftResults.map((r, i) => (
                <Link key={i} className="card card-accent ft-result" href={`/ideas/${r.id}`}>
                  <div className="ft-result__head"><span className="badge badge-muted">{r.kind}</span><span className="ft-result__ctx">{r.ctx}</span></div>
                  <p className="ft-result__snippet">{highlight(r.text, ftq)}</p>
                </Link>
              ))}
            </div>
          )}
          <p className="hint" style={{ marginTop: "var(--space-3)" }}>
            検索対象＝アイデアの<strong>件名・本文・価値・備考</strong>＋<strong>チャット</strong>＋<strong>添付ファイル名</strong>（このクエスト内）。
          </p>
        </section>
      )}

      {/* パーティー */}
      {tab === "party" && (
        <section aria-label="パーティー">
          <div className="list-toolbar">
            <div className="muted text-sm">クエストの参加メンバーと権限（所有者/管理権限者が編集可）</div>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => router.push("/quests/new")}>パーティー・権限を編集</button>
          </div>
          <div className="card tab-party-card" style={{ padding: 0 }}>
            <ul className="member-list">
              {PARTY.map((m) => (
                <li className="member-row" key={m.name}>
                  <Avatar name={m.name} level={m.level} />
                  <span className="member-name">{m.name}</span>
                  <span className="member-perms">{m.perms.map((p, i) => <span key={i} className={`badge ${p.cls}`}>{p.label}</span>)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="hint" style={{ marginTop: "var(--space-3)" }}>※ 新規参加メンバーの既定権限＝投票＋アイデア作成＋コメント。評価者/クエスト管理などは所有者/管理権限者が付与。</p>
        </section>
      )}

      {/* 概要 */}
      {tab === "about" && (
        <section aria-label="概要">
          <div className="card">
            <dl className="def-list">
              <dt>ステータス</dt><dd><span className="badge badge-success">評価中</span></dd>
              <dt>カテゴリー</dt><dd>業務改善</dd>
              <dt>目的・テーマ</dt><dd>配送コストと CO2 削減の両立を実現するアイデアを集める。現状は拠点ごとの小口配送で積載率が低く、コスト・環境負荷ともに課題がある。</dd>
              <dt>期限日</dt><dd>2026/12/20（あと3日）</dd>
              <dt>クエストグループ</dt><dd>プロダクト開発部</dd>
              <dt>所有者</dt><dd><span className="poster"><Avatar name="山田 太郎" size="sm" /><span className="name">山田 太郎</span></span></dd>
              <dt>作成日</dt><dd>2026/11/15</dd>
              <dt>アイデア数</dt><dd>6件</dd>
            </dl>
          </div>
        </section>
      )}
    </section>
  );
}
