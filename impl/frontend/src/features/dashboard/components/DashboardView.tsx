"use client";

// SC-01 ダッシュボード（ゲーム層ヒーロー＋週間ランキング＋下書き/未投票/参加中/フォロー中/下段）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-01_ダッシュボード.html（DoD＝モック一致）。
// フロントエンド実装フロー規約＝画面モック先行（クリッカブル移植・デモデータ）。残高・各パネルは
// backend 接続（GET /me・I ダッシュボード集約・G/H）までの demo fixtures（接続時に api へ差し替え）。
// クイック投票・フォロー★はローカル状態のデモ（本番は SC-22 投票 EP・フォロー EP）。
// 未実装先（SC-11/21/22/25 のモーダル）は既存スタブ route へ暫定リンク（クリッカブル維持）。
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

import { Avatar } from "@/components/ui";
import "../dashboard.css";

type Balance = { level: number; xpPct: number; xpToNext: number; coin: number; sp: number };

const RANKING = [
  { name: "鈴木 花子", level: 12, total: 530, exp: 480, coin: 50, me: false },
  { name: "山田 太郎", level: 7, total: 405, exp: 360, coin: 45, me: true },
  { name: "佐藤 大輔", level: 3, total: 340, exp: 300, coin: 40, me: false },
];

const DRAFTS = [
  { kind: "クエスト", title: "新オフィスのレイアウト改善", meta: ["カテゴリー未確定", "最終更新: 昨日"], cta: "続きを書く ✎", href: "/quests/new" },
  { kind: "アイデア", title: "社内イベントの出欠をLINEで管理", meta: ["社内コミュニケーション活性化", "最終更新: 3日前"], cta: "続きを書く ✎", href: "/quests/demo-quest" },
  { kind: "⭐ 評価", title: "夜間配送の集約による積載率改善", meta: ["配送ルート最適化", "採点 3/5 観点", "最終更新: 今日"], cta: "採点を続ける ✎", href: "/ideas/demo-idea/eval" },
];

const UNVOTED = [
  { id: "u1", title: "AI議事録の自動要約", quest: "社内ナレッジ検索AI", cat: "新規事業", value: "会議音声から議事録と決定事項を自動生成し、共有の手間をなくす。", poster: "田中 一郎" },
  { id: "u2", title: "置き配の写真通知", quest: "配送ルート最適化", cat: "顧客体験", value: "置き配完了時に写真付きで通知し、不在時の不安と再配達を減らす。", poster: "佐藤 大輔" },
  { id: "u3", title: "有給の取得を可視化", quest: "経費精算の自動化", cat: "業務改善", value: "チームの有給取得状況を可視化し、取りやすい雰囲気をつくる。", poster: "伊藤 彩" },
];

const QUESTS = [
  { id: "q1", char: "配", owner: "山", title: "配送ルート最適化", status: "評価中", statusCls: "", accent: "#0D9488", cat: "業務改善", deadline: "⏳ 締切まで3日", soon: true, party: 6, ideas: 8, tail: { label: "未投稿", cls: "badge-danger" } },
  { id: "q2", char: "社", owner: "鈴", title: "社内ナレッジ検索AI", status: "選定", statusCls: "badge-success", accent: "#7C3AED", cat: "新規事業", deadline: "⏳ 締切まで7日", soon: false, party: 4, ideas: 12, tail: { label: "評価待ち2", cls: "" } },
  { id: "q3", char: "経", owner: "田", title: "経費精算の自動化", status: "募集中", statusCls: "", accent: "#EA580C", cat: "コスト削減", deadline: "⏳ 締切まで14日", soon: false, party: 5, ideas: 3, tail: { label: "投稿済み", cls: "badge-success" } },
];

const FOLLOWED = [
  { id: "f1", title: "夜間配送の集約", quest: "配送ルート最適化", value: "夜間帯の配送を1拠点に集約し、積載率を上げてコストとCO2を同時に削減。", poster: "鈴木 花子", agree: 12, disagree: 3, comments: 8, frozen: false },
  { id: "f2", title: "FAQ自動生成", quest: "社内ナレッジ検索AI", value: "問い合わせ履歴からFAQを自動生成し、サポート工数を半減。", poster: "佐藤 大輔", agree: 20, disagree: 1, comments: 15, frozen: false },
  { id: "f3", title: "経費レシートOCR", quest: "経費精算の自動化", value: "レシート撮影だけで経費入力が完了し、申請の手間をなくす。", poster: "田中 一郎", agree: 7, disagree: 0, comments: 4, frozen: true },
];

const NOTIFS = [
  { ico: "@", unread: true, main: <><strong>鈴木 花子</strong> さんがチャットであなたをメンションしました</>, sub: "配送ルート最適化 / アイデア「夜間配送の集約」", time: "5分前" },
  { ico: "💬", unread: true, main: <>あなたのアイデアに <strong>3件</strong> の新しいコメント</>, sub: "社内ナレッジ検索AI / アイデア「FAQ自動生成」", time: "1時間前" },
  { ico: "⭐", unread: false, main: <>あなたのアイデアが <strong>選定</strong> されました（＋200 XP・コイン獲得）</>, sub: "社内ナレッジ検索AI", time: "昨日" },
];

const TILES = [
  { href: "/quests", ico: "🗺️", label: "クエスト一覧" },
  { href: "/shop", ico: "🛒", label: "ショップ" },
  { href: "/avatar", ico: "🧍", label: "アバター" },
  { href: "/spells", ico: "✦", label: "魔法 / スキル" },
  { href: "/achievements", ico: "🏆", label: "実績 / バッジ" },
  { href: "/ranking", ico: "📊", label: "ランキング" },
  { href: "/notifications", ico: "🔔", label: "通知" },
];

export function DashboardView({
  displayName,
  balance,
  admin,
}: {
  displayName: string;
  balance: Balance;
  admin: { systemAdmin: boolean; companyAdmin: boolean; qgAdmin: boolean };
}) {
  // クイック投票（未投票カード）＝ローカルデモ。投票済みは note を出しミュート表示。
  const [votes, setVotes] = useState<Record<string, "agree" | "disagree">>({});
  // フォロー★＝ローカルデモ（初期は全てフォロー中）。
  const [followed, setFollowed] = useState<Record<string, boolean>>({ f1: true, f2: true, f3: true });

  return (
    <div className="dash-page stack">
      <p className="dash-greeting">ようこそ、<strong>{displayName}</strong> さん（ダッシュボードはデモデータ表示です。backend 接続で実データに差し替えます）</p>

      {/* 上部2カラム：ヒーロー＋週間ランキング */}
      <div className="dash-top">
        <section className="pixel-panel hero" aria-label="あなたのステータス">
          <div className="hero__avatar">
            <Image src="/assets/mascot-hero.png" alt="あなたのアバター" width={88} height={88} />
          </div>
          <div className="hero__status">
            <div className="hero__name">{displayName}</div>
            <div className="hero__lvline">
              <span className="hero__lv">Lv.{balance.level}</span>
              <span className="hero__next">NEXT {balance.xpToNext} XP</span>
            </div>
            <div className="xp-bar"><span style={{ width: `${balance.xpPct}%` }} /></div>
            <div className="hero__coin">
              <span className="pixel-stat coin">◆ {balance.coin} コイン</span>
              <span className="pixel-stat skill">✦ SP {balance.sp}</span>
            </div>
            <div className="hero__actions">
              <Link className="btn-pixel" href="/shop">ショップ</Link>
              <Link className="btn-pixel" href="/avatar">きせかえ</Link>
              <Link className="btn-pixel" href="/spells">魔法・スキル</Link>
            </div>
          </div>
        </section>

        <section className="pixel-panel rank-panel" aria-label="週間ランキング">
          <h3>★ 週間ランキング ★</h3>
          <div className="rank-panel__sub">今週の獲得EXP＋コイン</div>
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
          <div className="rank-panel__foot"><Link href="/ranking">ランキングをすべて見る →</Link></div>
        </section>
      </div>

      {/* 下書き */}
      <section aria-label="下書き">
        <div className="section-head">
          <h2>下書き</h2>
          <span className="muted text-sm">あなただけに表示（公開/投稿するまで非公開）</span>
        </div>
        <div className="draft-grid">
          {DRAFTS.map((d) => (
            <Link key={d.title} className="card card-accent draft-card" href={d.href}>
              <div className="draft-card__head">
                <span className="badge badge-draft">下書き</span>
                <span className="badge badge-muted">{d.kind}</span>
              </div>
              <div className="draft-card__title">{d.title}</div>
              <div className="draft-card__meta">{d.meta.map((m) => <span key={m}>{m}</span>)}</div>
              <div className="draft-card__cta">{d.cta}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* 未投票のアイデア */}
      <section aria-label="未投票のアイデア">
        <div className="section-head">
          <h2>未投票のアイデア</h2>
          <span className="muted text-sm">参加クエストで、あなたがまだ投票していないアイデア</span>
        </div>
        <div className="vote-grid">
          {UNVOTED.map((v) => {
            const voted = votes[v.id];
            return (
              <article key={v.id} className={`card card-accent vote-card${voted ? " is-voted" : ""}`}>
                <div className="between"><Link className="card-title" href={`/ideas/${v.id}`}>{v.title}</Link><span className="badge badge-muted">未投票</span></div>
                <div className="vote-card__quest">{v.quest} ・ {v.cat}</div>
                <div className="vote-card__value">{v.value}</div>
                <div className="vote-card__poster poster"><Avatar name={v.poster} size="sm" /><span className="name text-sm muted">投稿: {v.poster}</span></div>
                {voted ? (
                  <div className="vote-voted-note">{voted === "agree" ? "▲ 賛成しました" : "▼ 反対しました"}（デモ）</div>
                ) : (
                  <div className="vote-actions">
                    <button type="button" className="vote-quick agree" aria-label="賛成する" onClick={() => setVotes((s) => ({ ...s, [v.id]: "agree" }))}>▲ 賛成</button>
                    <button type="button" className="vote-quick disagree" aria-label="反対する" onClick={() => setVotes((s) => ({ ...s, [v.id]: "disagree" }))}>▼ 反対</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* 参加中クエスト */}
      <section aria-label="参加中クエスト">
        <div className="section-head">
          <h2>参加中クエスト</h2>
          <Link href="/quests">すべて見る →</Link>
        </div>
        <div className="quest-grid">
          {QUESTS.map((q) => (
            <Link key={q.id} className="card card-accent quest-card" href={`/quests/${q.id}`} style={{ ["--accent" as string]: q.accent } as React.CSSProperties}>
              <div className="between">
                <span className="row-center" style={{ gap: "var(--space-2)", minWidth: 0 }}>
                  <span className="quest-icon sm"><span className="quest-icon__char">{q.char}</span><span className="quest-icon__owner placeholder">{q.owner}</span></span>
                  <span className="card-title">{q.title}</span>
                </span>
                <span className={`badge ${q.statusCls}`}>{q.status}</span>
              </div>
              <div className="quest-card__meta">
                <span className="badge badge-muted">{q.cat}</span>
                <span className={`deadline${q.soon ? " soon" : ""}`}>{q.deadline}</span>
              </div>
              <div className="quest-card__stats">
                <span>👥 パーティー{q.party}</span>
                <span>💡 アイデア{q.ideas}</span>
                <span className={`badge ${q.tail.cls}`}>{q.tail.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* フォロー中のアイデア */}
      <section aria-label="フォロー中のアイデア">
        <div className="section-head">
          <h2>フォロー中のアイデア</h2>
          <span className="muted text-sm">動きがあると通知でお知らせ</span>
        </div>
        <div className="follow-grid">
          {FOLLOWED.map((f) => {
            const isOn = followed[f.id];
            return (
              <article key={f.id} className={`card card-accent follow-card${f.frozen ? " is-frozen" : ""}`}>
                <button
                  type="button"
                  className="follow-star"
                  aria-pressed={isOn}
                  aria-label={isOn ? "フォロー解除" : "フォローする"}
                  onClick={() => setFollowed((s) => ({ ...s, [f.id]: !s[f.id] }))}
                >
                  ★
                </button>
                <Link className="card-title" href={`/ideas/${f.id}`}>{f.title}</Link>
                <div className="follow-quest">{f.quest}{f.frozen && <> <span className="badge badge-muted" title="クエスト完了で凍結。以後の通知はありません（解除のみ可・再フォロー不可）">⏸ 完了（凍結）</span></>}</div>
                <div className="follow-value">{f.value}</div>
                <div className="follow-card__poster poster"><Avatar name={f.poster} size="sm" /><span className="name text-sm muted">投稿: {f.poster}</span></div>
                <div className="follow-stats">
                  <span className="vote-agree">▲ {f.agree}</span>
                  <span className="vote-disagree">▼ {f.disagree}</span>
                  <span className="badge badge-muted">💬 {f.comments}</span>
                </div>
                {f.frozen && <div className="follow-frozen-note text-xs muted">⏸ 完了済み＝以後の通知なし。★で<strong>解除</strong>のみ可（再フォロー不可）。</div>}
              </article>
            );
          })}
        </div>
      </section>

      {/* 下段：最近の通知＋ショートカット */}
      <div className="dash-bottom">
        <section className="card" aria-label="最近の通知">
          <div className="section-head">
            <h2 style={{ fontSize: "var(--text-lg)" }}>最近の通知</h2>
            <Link href="/notifications">すべての通知 →</Link>
          </div>
          <ul className="notif-list">
            {NOTIFS.map((n, i) => (
              <li key={i} className={n.unread ? "unread" : undefined}>
                <span className="notif-ico">{n.ico}</span>
                <div className="notif-body">
                  <div>{n.main}</div>
                  <div className="muted">{n.sub}</div>
                  <div className="notif-time">{n.time}</div>
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

      {/* ロール条件付き管理導線（session のロールで出し分け） */}
      {(admin.qgAdmin || admin.companyAdmin || admin.systemAdmin) && (
        <div className="admin-links">
          <span className="role-note">▼ ロールに応じて表示</span>
          {admin.qgAdmin && <Link className="btn btn-outline btn-sm" href="/admin/quest-groups">クエストグループ管理</Link>}
          {admin.companyAdmin && <Link className="btn btn-outline btn-sm" href="/admin/accounts">会社アカウント管理</Link>}
          {admin.systemAdmin && <Link className="btn btn-outline btn-sm" href="/admin/companies">システム管理</Link>}
        </div>
      )}
    </div>
  );
}
