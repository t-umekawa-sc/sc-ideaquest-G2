"use client";

// SC-40 実績/バッジ（ゲーム層）＝収集サマリー（CRTガラス）＋実績一覧（DataTable cardRaw）。G.4 実接続。
// 活動に応じてサーバー（台帳フック）が自動付与＝フロントは表示のみ。シークレット未獲得はサーバーで伏せる（？？？）。
// 正＝doc/画面設計/mocks/SC-40_実績バッジ.html・screens/SC-40・API設計 G.4。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Spinner, DataTable } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";

import { getAchievements } from "../api";
import { AchievementCelebration } from "./AchievementCelebration";
import "../achievements.css";

type Tier = "bronze" | "silver" | "gold";
type Ach = {
  id: string;
  category: string;
  tier: Tier | null;
  icon: string;
  name: string;
  desc: string;
  cond: string;
  coin: number;
  earned: string | null; // 獲得日（YYYY/MM/DD）or null
  prog: { cur: number; max: number | null } | null;
  secret: boolean;
};

const TIER_LABEL: Record<Tier, string> = { bronze: "ブロンズ", silver: "シルバー", gold: "ゴールド" };
const TIER_ORDER: Record<string, number> = { bronze: 0, silver: 1, gold: 2 };
const TIER_OPTIONS: [string, string][] = [["bronze", "ブロンズ"], ["silver", "シルバー"], ["gold", "ゴールド"]];
const STATE_OPTIONS: [string, string][] = [["earned", "獲得済み"], ["locked", "未獲得"]];

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function AchCard({ a }: { a: Ach }) {
  const earned = !!a.earned;
  const locked = !earned;
  const secretLocked = a.secret && !earned;
  const tierClass = a.tier ? `tier-${a.tier}` : "";
  const tierLabel = a.tier ? TIER_LABEL[a.tier] : "？？？";
  const pct = a.prog && a.prog.max ? Math.round((a.prog.cur / a.prog.max) * 100) : 0;
  return (
    <article className={["card", "ach", tierClass, locked ? "is-locked" : "", secretLocked ? "is-secret" : ""].filter(Boolean).join(" ")}>
      {a.secret && <span className="badge badge-muted ach__secret-badge">シークレット</span>}
      <div className="ach__medal">{secretLocked ? "🔒" : a.icon}</div>
      <div className="ach__tier">{tierLabel}</div>
      <div className="ach__name">{a.name}</div>
      <div className="ach__desc">{secretLocked ? "これはシークレット実績です。達成すると内容が明らかになります。" : a.desc}</div>
      <div className="ach__cond">条件: {secretLocked ? "？？？" : a.cond}</div>
      <div className="ach__reward">
        <span className="lbl">{earned ? "獲得コイン" : "報酬"}</span> ◆{secretLocked ? "?" : a.coin}
      </div>
      {locked && a.prog && a.prog.max && !secretLocked && (
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

export function AchievementsView({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<Ach[]>([]);
  const [summary, setSummary] = useState<{ unlocked: number; total: number; coin_earned: number }>({ unlocked: 0, total: 0, coin_earned: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await getAchievements().catch(() => null);
    if (r) {
      setRows(r.data.map((d) => ({
        id: d.id,
        category: d.category ?? "—",
        tier: (d.tier as Tier | null) ?? null,
        icon: d.icon ?? "🏅",
        name: d.name ?? "？？？",
        desc: d.description ?? "",
        cond: d.condition_label ?? "",
        coin: d.coin_reward ?? 0,
        earned: fmtDate(d.unlocked_at ?? null),
        prog: d.progress ? { cur: d.progress.current, max: d.progress.target ?? null } : null,
        secret: !!d.is_secret,
      })));
      setSummary(r.summary);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const catOptions: [string, string][] = Array.from(new Set(rows.map((a) => a.category))).map((c) => [c, c]);

  const columns: DataTableColumn<Ach>[] = [
    {
      key: "name", label: "実績", locked: true, width: 220, sortable: true, filter: { type: "text" },
      sortVal: (a) => a.name, searchVal: (a) => a.name, csvVal: (a) => a.name,
      render: (a) => (
        <span className="row-center" style={{ gap: 6 }}>
          {a.secret && !a.earned ? "🔒" : a.icon}
          <span className="idea-title">{a.name}</span>
        </span>
      ),
    },
    { key: "category", label: "カテゴリー", width: 150, sortable: true, filter: { type: "enum", options: catOptions }, sortVal: (a) => a.category, filterVal: (a) => a.category, csvVal: (a) => a.category, render: (a) => a.category },
    { key: "tier", label: "ティア", width: 110, sortable: true, filter: { type: "enum", options: TIER_OPTIONS }, sortVal: (a) => (a.tier ? TIER_ORDER[a.tier] : 99), filterVal: (a) => a.tier ?? "", csvVal: (a) => (a.tier ? TIER_LABEL[a.tier] : ""), render: (a) => (a.tier ? <span className={`tier-${a.tier}`} style={{ fontWeight: 700 }}>{TIER_LABEL[a.tier]}</span> : <span className="muted">？？？</span>) },
    { key: "state", label: "状態", width: 110, sortable: true, filter: { type: "enum", options: STATE_OPTIONS }, sortVal: (a) => (a.earned ? 0 : 1), filterVal: (a) => (a.earned ? "earned" : "locked"), csvVal: (a) => (a.earned ? "獲得済み" : "未獲得"), render: (a) => (a.earned ? <span className="badge badge-success">✓ 獲得</span> : <span className="badge badge-muted">🔒 未獲得</span>) },
    { key: "reward", label: "報酬", width: 90, align: "num", sortable: true, filter: { type: "number" }, sortVal: (a) => a.coin, filterVal: (a) => a.coin, csvVal: (a) => String(a.coin), render: (a) => (a.secret && !a.earned ? "◆?" : `◆${a.coin}`) },
    { key: "earned", label: "獲得日", width: 120, hiddenDefault: true, sortable: true, sortVal: (a) => a.earned || "", csvVal: (a) => a.earned || "", render: (a) => a.earned || <span className="muted">—</span> },
  ];

  const pct = summary.total ? Math.round((summary.unlocked / summary.total) * 100) : 0;

  return (
    <section aria-label="実績 / バッジ">
      {/* ゲーム感 #6: 新規解放された実績の祝福（読み込み完了後に前回観測と差分・純ロジック celebrate.ts） */}
      <AchievementCelebration
        accountId={accountId}
        ready={!loading}
        unlocked={rows.filter((a) => a.earned).map((a) => ({ id: a.id, name: a.name, icon: a.icon }))}
      />
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="ach-title">実績 / バッジ</h1>

      {/* 収集サマリー（ゲーム層・CRTガラス・実データ summary） */}
      <section className="pixel-panel" aria-label="収集状況">
        <div className="col-hero">
          <div>
            <div className="col-hero__num">{summary.unlocked} / {summary.total}</div>
            <div className="col-hero__label">ACHIEVEMENTS</div>
          </div>
          <div className="col-hero__bar">
            <div className="xp-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="col-hero__pct">達成率 {pct}%</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-pixel)", color: "var(--pixel-coin)", fontSize: "var(--text-lg)" }}>◆ {summary.coin_earned}</div>
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

      {loading && <Spinner label="読み込み中…" />}

      {/* 実績一覧＝DataTable（検索/絞込/並び替え/表示切替/CSV/固定/ページャ）。カードは cardRaw で完全制御。 */}
      <div className="ach-grid">
        <DataTable<Ach>
          storageKey="sc40-ach"
          data={rows}
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
