"use client";

// SC-30 ショップ（ゲーム層）＝コイン残高ヒーロー（CRTガラス）＋装備一覧（DataTable cardRaw）＋購入フロー。
// 正＝doc/画面設計/mocks/SC-30_ショップ.html・doc/画面設計/screens/SC-30_ショップ.md。
// 装備/コイン backend 未実装＝デモ fixtures（画面モック先行）。購入完了は報酬スナックバー（§14）で通知。
import Link from "next/link";
import { useState } from "react";

import { DataTable, useSnackbar } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";

import "../shop.css";

type Slot = "head" | "face" | "body" | "hand" | "bg";
type Rarity = "common" | "standard" | "rare";
type Item = { id: string; slot: Slot; name: string; icon: string; rarity: Rarity; price: number; owned: boolean };

const SLOT_LABEL: Record<Slot, string> = { head: "頭", face: "顔", body: "体", hand: "手持ち", bg: "背景" };
const RARITY_LABEL: Record<Rarity, string> = { common: "コモン", standard: "標準", rare: "レア" };
const RARITY_ORDER: Record<Rarity, number> = { common: 0, standard: 1, rare: 2 };
const SLOT_ORDER: Record<Slot, number> = { head: 0, face: 1, body: 2, hand: 3, bg: 4 };

// owned=所有済み（SC-31 の初期所有と一致）。価格はレアリティ帯（コモン10〜30/標準50〜150/レア300〜800）。
const INITIAL_ITEMS: Item[] = [
  { id: "crown", slot: "head", name: "王冠", icon: "👑", rarity: "rare", price: 600, owned: true },
  { id: "tophat", slot: "head", name: "シルクハット", icon: "🎩", rarity: "standard", price: 120, owned: true },
  { id: "cap", slot: "head", name: "キャップ", icon: "🧢", rarity: "common", price: 20, owned: true },
  { id: "straw", slot: "head", name: "麦わら帽", icon: "👒", rarity: "common", price: 20, owned: false },
  { id: "shades", slot: "face", name: "サングラス", icon: "🕶️", rarity: "standard", price: 90, owned: true },
  { id: "glasses", slot: "face", name: "メガネ", icon: "👓", rarity: "common", price: 15, owned: true },
  { id: "mask", slot: "face", name: "マスク", icon: "😷", rarity: "common", price: 15, owned: false },
  { id: "armor", slot: "body", name: "アーマー", icon: "🛡️", rarity: "rare", price: 700, owned: true },
  { id: "suit", slot: "body", name: "スーツ", icon: "👔", rarity: "standard", price: 150, owned: true },
  { id: "gi", slot: "body", name: "道着", icon: "🥋", rarity: "common", price: 30, owned: true },
  { id: "coat", slot: "body", name: "ロングコート", icon: "🧥", rarity: "standard", price: 120, owned: false },
  { id: "sword", slot: "hand", name: "剣", icon: "⚔️", rarity: "rare", price: 500, owned: true },
  { id: "wand", slot: "hand", name: "魔法の杖", icon: "🪄", rarity: "standard", price: 120, owned: true },
  { id: "book", slot: "hand", name: "本", icon: "📖", rarity: "common", price: 25, owned: true },
  { id: "hammer", slot: "hand", name: "大槌", icon: "🔨", rarity: "standard", price: 90, owned: false },
  { id: "sunset", slot: "bg", name: "夕焼けの海", icon: "🌅", rarity: "standard", price: 100, owned: true },
  { id: "galaxy", slot: "bg", name: "星空", icon: "🌌", rarity: "rare", price: 400, owned: true },
  { id: "forest", slot: "bg", name: "森", icon: "🌲", rarity: "common", price: 25, owned: true },
  { id: "castle", slot: "bg", name: "古城", icon: "🏰", rarity: "rare", price: 500, owned: false },
];
// 既定＝レアリティ順（以降はツールバーの並び替えで操作）。
const SORTED = [...INITIAL_ITEMS].sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.price - b.price);

type State = "owned" | "affordable" | "short";
const STATE_LABEL: Record<State, string> = { owned: "所有済", affordable: "購入可", short: "コイン不足" };

const SLOT_OPTIONS: [string, string][] = [["head", "頭"], ["face", "顔"], ["body", "体"], ["hand", "手持ち"], ["bg", "背景"]];
const RARITY_OPTIONS: [string, string][] = [["common", "コモン"], ["standard", "標準"], ["rare", "レア"]];
const STATE_OPTIONS: [string, string][] = [["owned", "所有済"], ["affordable", "購入可"], ["short", "コイン不足"]];

export function ShopView() {
  const snack = useSnackbar();
  const [items, setItems] = useState<Item[]>(SORTED);
  const [coins, setCoins] = useState(320);
  const [flashId, setFlashId] = useState<string | null>(null);

  const stateOf = (it: Item): State => (it.owned ? "owned" : it.price <= coins ? "affordable" : "short");

  function buy(it: Item) {
    if (it.owned || it.price > coins) return;
    if (!window.confirm(`「${it.name}」を ◆${it.price} で購入しますか？\n（残高 ◆${coins} → ◆${coins - it.price}）`)) return;
    setCoins((c) => c - it.price);
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, owned: true } : x)));
    setFlashId(it.id);
    setTimeout(() => setFlashId((f) => (f === it.id ? null : f)), 500);
    snack({
      type: "reward",
      title: "装備を購入しました",
      msg: `「${it.name}」を入手！ きせかえで装備できます。`,
      rewards: [{ k: "coin", t: `◆ -${it.price}` }],
    });
  }

  const columns: DataTableColumn<Item>[] = [
    {
      key: "name", label: "装備", locked: true, width: 200, sortable: true, filter: { type: "text" },
      sortVal: (i) => i.name, searchVal: (i) => i.name, csvVal: (i) => i.name,
      render: (i) => (
        <span className="row-center" style={{ gap: 6 }}>
          {i.icon}
          <span className="idea-title">{i.name}</span>
        </span>
      ),
    },
    { key: "slot", label: "スロット", width: 110, sortable: true, filter: { type: "enum", options: SLOT_OPTIONS }, sortVal: (i) => SLOT_ORDER[i.slot], filterVal: (i) => i.slot, csvVal: (i) => SLOT_LABEL[i.slot], render: (i) => SLOT_LABEL[i.slot] },
    { key: "rarity", label: "レアリティ", width: 120, sortable: true, filter: { type: "enum", options: RARITY_OPTIONS }, sortVal: (i) => RARITY_ORDER[i.rarity], filterVal: (i) => i.rarity, csvVal: (i) => RARITY_LABEL[i.rarity], render: (i) => <span className={`rarity-${i.rarity}`} style={{ fontWeight: 700 }}>{RARITY_LABEL[i.rarity]}</span> },
    { key: "price", label: "価格", width: 100, align: "num", sortable: true, filter: { type: "number" }, sortVal: (i) => i.price, filterVal: (i) => i.price, csvVal: (i) => i.price, render: (i) => `◆ ${i.price}` },
    { key: "state", label: "状態", width: 120, filter: { type: "enum", options: STATE_OPTIONS }, filterVal: (i) => stateOf(i), csvVal: (i) => STATE_LABEL[stateOf(i)], render: (i) => { const s = stateOf(i); const cls = s === "owned" ? "badge-muted" : s === "affordable" ? "badge-success" : "badge-danger"; return <span className={`badge ${cls}`}>{STATE_LABEL[s]}</span>; } },
  ];

  function cardRaw(it: Item) {
    const canAfford = it.price <= coins;
    return (
      <article className={`card buy rarity-${it.rarity}${flashId === it.id ? " just-bought" : ""}`} data-id={it.id}>
        <div className="buy__thumb">{it.icon}</div>
        <div className="buy__meta">
          <span className="buy__slot">{SLOT_LABEL[it.slot]}</span>・<span className="buy__rarity">{RARITY_LABEL[it.rarity]}</span>
        </div>
        <div className="buy__name">{it.name}</div>
        <div className={`buy__price${!it.owned && !canAfford ? " short" : ""}`}>◆ {it.price}</div>
        {it.owned ? (
          <div className="buy__foot">
            <span className="buy__owned">✓ 所有済み</span>
            <Link className="buy__equip" href="/avatar">▶ きせかえで装備</Link>
          </div>
        ) : (
          <div className="buy__foot">
            <button className="btn-pixel btn-pixel--sm" type="button" disabled={!canAfford} onClick={() => buy(it)}>
              購入する
            </button>
            {!canAfford && <div className="buy__hint">コイン不足（あと ◆{it.price - coins}）</div>}
          </div>
        )}
      </article>
    );
  }

  return (
    <section aria-label="ショップ">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="shop-title">ショップ</h1>

      {/* コイン残高（ゲーム層・CRTガラス） */}
      <section className="pixel-panel" aria-label="コイン残高">
        <div className="wallet">
          <div>
            <div className="wallet__num">◆ {coins}</div>
            <div className="wallet__label">COIN</div>
          </div>
          <div className="wallet__meta">
            <span>▶ コインは<strong>アイデアの評価点に連動</strong>して貯まる希少通貨</span>
            <span>▶ 装備は<strong>コイン購入のみ</strong>で入手（各スロット付け替えは<strong>きせかえ</strong>で）</span>
          </div>
          <div className="wallet__actions">
            <Link className="btn-pixel" href="/avatar">▶ きせかえへ</Link>
          </div>
        </div>
      </section>

      <p className="how">
        アバターは <strong>5スロット（頭 / 顔 / 体 / 手持ち / 背景）</strong>。装備には
        <span className="rarity-common">コモン（◆10〜30）</span>・<span className="rarity-standard">標準（◆50〜150）</span>・
        <span className="rarity-rare">レア（◆300〜800）</span>
        のレアリティがあります。購入した装備は <Link href="/avatar">きせかえ</Link> で着せ替えできます。
      </p>

      {/* 装備一覧＝DataTable（検索/絞込〔スロット・レアリティ・価格・状態〕/並び替え/表示切替/CSV/固定/ページャ）。カードは cardRaw で完全制御。 */}
      <div className="shop-grid">
        <DataTable<Item>
          storageKey="sc30-shop"
          data={items}
          columns={columns}
          rowId={(i) => i.id}
          unit="件"
          perPage={24}
          perPageOptions={[12, 24, 48]}
          defaultView="card"
          searchFields="装備名"
          exportName="ショップ装備"
          emptyText="条件に合う装備がありません。絞り込みを見直してください。"
          cardRaw={cardRaw}
        />
      </div>

      <p className="role-note" style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
        購入したアイテムはずっと持てます（コイン残高を確認して購入します）。着せ替えは「アバター着せ替え」画面で反映できます。
      </p>
    </section>
  );
}
