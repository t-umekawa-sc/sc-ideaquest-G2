"use client";

// SC-40 実績/バッジ（ゲーム層）＝収集サマリー（CRTガラス）＋実績一覧（DataTable cardRaw）。
// 活動に応じてバッジを獲得＝ティア（銅/銀/金）に応じてコイン付与。シークレットは達成まで内容を伏せる。
// 正＝doc/画面設計/mocks/SC-40_実績バッジ.html・doc/画面設計/screens/SC-40_実績バッジ.md。
// 実績 backend 未実装＝デモ fixtures（画面モック先行）。
import Link from "next/link";

import { DataTable } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";

import "../achievements.css";

type Cat = "post" | "adopt" | "eval" | "vote" | "chat" | "streak" | "level" | "spell" | "gear" | "secret";
type Tier = "bronze" | "silver" | "gold";
type Ach = {
  id: string;
  cat: Cat;
  tier: Tier;
  icon: string;
  name: string;
  desc: string;
  cond: string;
  earned?: string;
  prog?: { cur: number; max: number };
  secret?: boolean;
};

const CATS: Record<Cat, string> = {
  post: "アイデア投稿", adopt: "採用", eval: "評価", vote: "投票", chat: "議論",
  streak: "継続", level: "成長", spell: "魔法", gear: "装備", secret: "シークレット",
};
const TIER_LABEL: Record<Tier, string> = { bronze: "ブロンズ", silver: "シルバー", gold: "ゴールド" };
const TIER_REWARD: Record<Tier, number> = { bronze: 20, silver: 50, gold: 150 }; // 難易度に応じたコイン付与（初期値）
const TIER_ORDER: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2 };

const ACH: Ach[] = [
  { id: "first_idea", cat: "post", tier: "bronze", icon: "🌱", name: "初めの一歩", desc: "初めてアイデアを投稿した", cond: "アイデアを1件投稿", earned: "2026/05/08" },
  { id: "ideaman", cat: "post", tier: "silver", icon: "💡", name: "アイデアマン", desc: "アイデアを10件投稿した", cond: "アイデアを10件投稿", prog: { cur: 7, max: 10 } },
  { id: "inventor", cat: "post", tier: "gold", icon: "🏭", name: "発明家", desc: "アイデアを50件投稿した", cond: "アイデアを50件投稿", prog: { cur: 7, max: 50 } },
  { id: "first_adopt", cat: "adopt", tier: "silver", icon: "🎉", name: "初採用", desc: "自分のアイデアが初めて選定された", cond: "アイデアが1件選定", earned: "2026/06/20" },
  { id: "hitmaker", cat: "adopt", tier: "gold", icon: "🏆", name: "ヒットメーカー", desc: "アイデアが5件選定された", cond: "アイデアが5件選定", prog: { cur: 1, max: 5 } },
  { id: "sharp_eye", cat: "eval", tier: "bronze", icon: "👀", name: "目利き", desc: "評価を10件実施した", cond: "評価を10件実施", earned: "2026/06/28" },
  { id: "sage", cat: "eval", tier: "gold", icon: "🧙", name: "賢者の評", desc: "評価を50件実施した", cond: "評価を50件実施", prog: { cur: 12, max: 50 } },
  { id: "first_vote", cat: "vote", tier: "bronze", icon: "🗳️", name: "一票の力", desc: "初めて投票した", cond: "投票を1回", earned: "2026/05/09" },
  { id: "returning", cat: "vote", tier: "silver", icon: "📊", name: "選挙管理人", desc: "投票を50回した", cond: "投票を50回", prog: { cur: 33, max: 50 } },
  { id: "chatty", cat: "chat", tier: "bronze", icon: "💬", name: "おしゃべり", desc: "コメントを10件した", cond: "コメントを10件", earned: "2026/05/22" },
  { id: "debater", cat: "chat", tier: "gold", icon: "🔥", name: "議論の達人", desc: "コメントを100件した", cond: "コメントを100件", prog: { cur: 48, max: 100 } },
  { id: "sprout7", cat: "streak", tier: "bronze", icon: "📅", name: "皆勤の芽", desc: "7日連続でログインした", cond: "7日連続ログイン", earned: "2026/06/02" },
  { id: "perfect30", cat: "streak", tier: "gold", icon: "🗓️", name: "皆勤賞", desc: "30日連続でログインした", cond: "30日連続ログイン", prog: { cur: 12, max: 30 } },
  { id: "lv5", cat: "level", tier: "silver", icon: "⭐", name: "レベル5", desc: "レベル5に到達した", cond: "Lv5 到達", earned: "2026/06/10" },
  { id: "lv10", cat: "level", tier: "gold", icon: "🌟", name: "レベル10", desc: "レベル10に到達した", cond: "Lv10 到達", prog: { cur: 7, max: 10 } },
  { id: "apprentice", cat: "spell", tier: "bronze", icon: "✨", name: "見習い魔導士", desc: "魔法を初めて解放した", cond: "魔法を1つ解放", earned: "2026/07/03" },
  { id: "archmage", cat: "spell", tier: "gold", icon: "🪄", name: "大魔道士", desc: "すべての魔法を解放した", cond: "全6種の魔法を解放", prog: { cur: 3, max: 6 } },
  { id: "stylish", cat: "gear", tier: "bronze", icon: "👕", name: "おしゃれさん", desc: "装備を初めて購入した", cond: "装備を1点購入", earned: "2026/06/15" },
  { id: "collector", cat: "gear", tier: "gold", icon: "👑", name: "コレクター", desc: "すべての装備を購入した", cond: "全装備を購入", prog: { cur: 15, max: 19 } },
  { id: "nightowl", cat: "secret", tier: "silver", icon: "🦉", name: "夜更かしフクロウ", desc: "深夜（0〜4時）にアイデアを投稿した", cond: "深夜にアイデア投稿", earned: "2026/06/25", secret: true },
  { id: "secret_x", cat: "secret", tier: "gold", icon: "🕵️", name: "？？？", desc: "達成すると内容が明らかになる隠し実績。", cond: "？？？", secret: true },
];

const isSecretLocked = (a: Ach) => Boolean(a.secret && !a.earned);
const dispName = (a: Ach) => (isSecretLocked(a) ? "？？？" : a.name);

const CAT_OPTIONS: [string, string][] = (Object.entries(CATS) as [Cat, string][]).map(([k, v]) => [k, v]);
const TIER_OPTIONS: [string, string][] = [["bronze", "ブロンズ"], ["silver", "シルバー"], ["gold", "ゴールド"]];
const STATE_OPTIONS: [string, string][] = [["earned", "獲得済み"], ["locked", "未獲得"]];

function AchCard({ a }: { a: Ach }) {
  const earned = !!a.earned;
  const locked = !earned;
  const secretLocked = isSecretLocked(a);
  const icon = secretLocked ? "🔒" : a.icon;
  const name = secretLocked ? "？？？" : a.name;
  const desc = secretLocked ? "これはシークレット実績です。達成すると内容が明らかになります。" : a.desc;
  const cond = secretLocked ? "条件: ？？？" : `条件: ${a.cond}`;
  const tierClass = secretLocked ? "" : `tier-${a.tier}`;
  const tierLabel = secretLocked ? "？？？" : TIER_LABEL[a.tier];
  const pct = a.prog ? Math.round((a.prog.cur / a.prog.max) * 100) : 0;

  return (
    <article className={["card", "ach", tierClass, locked ? "is-locked" : "", secretLocked ? "is-secret" : ""].filter(Boolean).join(" ")}>
      {a.secret && <span className="badge badge-muted ach__secret-badge">シークレット</span>}
      <div className="ach__medal">{icon}</div>
      <div className="ach__tier">{tierLabel}</div>
      <div className="ach__name">{name}</div>
      <div className="ach__desc">{desc}</div>
      <div className="ach__cond">{cond}</div>
      <div className="ach__reward">
        <span className="lbl">{secretLocked ? "報酬" : earned ? "獲得コイン" : "報酬"}</span>{" "}
        ◆{secretLocked ? "?" : TIER_REWARD[a.tier]}
      </div>
      {locked && a.prog && !secretLocked && (
        <>
          <div className="ach__prog"><span style={{ width: `${pct}%` }} /></div>
          <div className="ach__prognum">{a.prog.cur} / {a.prog.max}</div>
        </>
      )}
      {earned ? (
        <div className="ach__foot">
          <span className="ach__earned">✓ 獲得</span> <span className="ach__date">{a.earned}</span>
        </div>
      ) : (
        <div className="ach__foot"><span className="ach__locked">🔒 未獲得</span></div>
      )}
    </article>
  );
}

export function AchievementsView() {
  const columns: DataTableColumn<Ach>[] = [
    {
      key: "name", label: "実績", locked: true, width: 220, sortable: true, filter: { type: "text" },
      sortVal: dispName, searchVal: dispName, csvVal: dispName,
      render: (a) => (
        <span className="row-center" style={{ gap: 6 }}>
          {isSecretLocked(a) ? "🔒" : a.icon}
          <span className="idea-title">{dispName(a)}</span>
        </span>
      ),
    },
    { key: "cat", label: "カテゴリー", width: 150, sortable: true, filter: { type: "enum", options: CAT_OPTIONS }, sortVal: (a) => CATS[a.cat], filterVal: (a) => a.cat, csvVal: (a) => CATS[a.cat], render: (a) => CATS[a.cat] },
    { key: "tier", label: "ティア", width: 110, sortable: true, filter: { type: "enum", options: TIER_OPTIONS }, sortVal: (a) => TIER_ORDER[a.tier], filterVal: (a) => a.tier, csvVal: (a) => TIER_LABEL[a.tier], render: (a) => (isSecretLocked(a) ? <span className="muted">？？？</span> : <span className={`tier-${a.tier}`} style={{ fontWeight: 700 }}>{TIER_LABEL[a.tier]}</span>) },
    { key: "state", label: "状態", width: 110, sortable: true, filter: { type: "enum", options: STATE_OPTIONS }, sortVal: (a) => (a.earned ? 0 : 1), filterVal: (a) => (a.earned ? "earned" : "locked"), csvVal: (a) => (a.earned ? "獲得済み" : "未獲得"), render: (a) => (a.earned ? <span className="badge badge-success">✓ 獲得</span> : <span className="badge badge-muted">🔒 未獲得</span>) },
    { key: "reward", label: "報酬", width: 90, align: "num", sortable: true, filter: { type: "number" }, sortVal: (a) => TIER_REWARD[a.tier], filterVal: (a) => TIER_REWARD[a.tier], csvVal: (a) => (isSecretLocked(a) ? "" : String(TIER_REWARD[a.tier])), render: (a) => (isSecretLocked(a) ? "◆?" : `◆${TIER_REWARD[a.tier]}`) },
    { key: "earned", label: "獲得日", width: 120, hiddenDefault: true, sortable: true, sortVal: (a) => a.earned || "", csvVal: (a) => a.earned || "", render: (a) => a.earned || <span className="muted">—</span> },
  ];

  // サマリー（全体・フィルタに依らない）
  const total = ACH.length;
  const earnedList = ACH.filter((a) => a.earned);
  const earned = earnedList.length;
  const pct = Math.round((earned / total) * 100);
  const coinEarned = earnedList.reduce((s, a) => s + TIER_REWARD[a.tier], 0);

  return (
    <section aria-label="実績 / バッジ">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="ach-title">実績 / バッジ</h1>

      {/* 収集サマリー（ゲーム層・CRTガラス） */}
      <section className="pixel-panel" aria-label="収集状況">
        <div className="col-hero">
          <div>
            <div className="col-hero__num">{earned} / {total}</div>
            <div className="col-hero__label">ACHIEVEMENTS</div>
          </div>
          <div className="col-hero__bar">
            <div className="xp-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="col-hero__pct">達成率 {pct}%</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-pixel)", color: "var(--pixel-coin)", fontSize: "var(--text-lg)" }}>◆ {coinEarned}</div>
            <div className="col-hero__label" style={{ opacity: 0.7 }}>実績で獲得したコイン</div>
          </div>
        </div>
      </section>

      <p className="how">
        アイデアを出す・議論する・評価する・続けて使う…といった<strong>活動に応じてバッジを獲得</strong>できます。
        実績を獲得すると<strong>難易度（ティア）に応じてコインを獲得</strong>できます（
        <span style={{ color: "var(--tier-bronze)", fontWeight: 700 }}>ブロンズ ◆20</span> /{" "}
        <span style={{ color: "var(--tier-silver)", fontWeight: 700 }}>シルバー ◆50</span> /{" "}
        <span style={{ color: "var(--tier-gold)", fontWeight: 700 }}>ゴールド ◆150</span>）。
        <strong>🔒 シークレット</strong>実績は達成するまで内容が伏せられます。
      </p>

      {/* 実績一覧＝DataTable（検索/絞込〔カテゴリー・ティア・状態〕/並び替え/表示切替/CSV/固定/ページャ）。カードは cardRaw で完全制御。 */}
      <div className="ach-grid">
        <DataTable<Ach>
          storageKey="sc40-ach"
          data={ACH}
          columns={columns}
          rowId={(a) => a.id}
          unit="件"
          perPage={24}
          perPageOptions={[12, 24, 48]}
          defaultView="card"
          searchFields="実績名"
          exportName="実績バッジ"
          emptyText="条件に合う実績がありません。"
          cardRaw={(a) => <AchCard a={a} />}
        />
      </div>

      <p className="role-note" style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
        実績を獲得すると、<strong>ティアに応じたコイン（ブロンズ◆20／シルバー◆50／ゴールド◆150）</strong>が付与されます。シークレット実績は、達成するまで名称・条件・報酬が伏せられます。
      </p>
    </section>
  );
}
