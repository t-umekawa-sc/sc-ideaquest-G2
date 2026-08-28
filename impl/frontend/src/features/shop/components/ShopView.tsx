"use client";

// SC-30 ショップ（ゲーム層）＝コイン残高ヒーロー（CRTガラス）＋装備一覧（DataTable cardRaw）＋購入フロー。
// 正＝doc/画面設計/mocks/SC-30_ショップ.html・doc/画面設計/screens/SC-30_ショップ.md・API設計 G.1。
// G 実接続＝getItems（マスタ＋所有＋残高）／purchaseItem（コイン消費・残高不足/所有済みはサーバー権威 409）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CountUp, DataTable, GameNav, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { reduceMotion } from "@/lib/motion";

import { getItems, ITEM_ICON, purchaseItem } from "../api";
import { ItemGetFx, type GetRect } from "./ItemGetFx";
import "../shop.css";

type Slot = "head" | "face" | "body" | "hand" | "bg";
type Rarity = "common" | "standard" | "rare";
type Item = { id: string; slot: Slot; name: string; icon: string; rarity: Rarity; price: number; owned: boolean };

// backend slot（background）→ 表示スロット（bg）。
function toSlot(s: string): Slot {
  return (s === "background" ? "bg" : s) as Slot;
}

const SLOT_LABEL: Record<Slot, string> = { head: "頭", face: "顔", body: "体", hand: "手持ち", bg: "背景" };
const RARITY_LABEL: Record<Rarity, string> = { common: "コモン", standard: "標準", rare: "レア" };
const RARITY_ORDER: Record<Rarity, number> = { common: 0, standard: 1, rare: 2 };
const SLOT_ORDER: Record<Slot, number> = { head: 0, face: 1, body: 2, hand: 3, bg: 4 };

type State = "owned" | "affordable" | "short";
const STATE_LABEL: Record<State, string> = { owned: "所有済", affordable: "購入可", short: "コイン不足" };

const SLOT_OPTIONS: [string, string][] = [["head", "頭"], ["face", "顔"], ["body", "体"], ["hand", "手持ち"], ["bg", "背景"]];
const RARITY_OPTIONS: [string, string][] = [["common", "コモン"], ["standard", "標準"], ["rare", "レア"]];
const STATE_OPTIONS: [string, string][] = [["owned", "所有済"], ["affordable", "購入可"], ["short", "コイン不足"]];

export function ShopView() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [coins, setCoins] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // #12: 購入成立の「アイテム入手」演出（購入カード矩形に one-shot・reduce-motion 尊重）。
  const [gets, setGets] = useState<{ id: number; rect: GetRect; icon: string; cost: number }[]>([]);
  const getId = useRef(0);
  const fireGet = (itemId: string, icon: string, cost: number) => {
    if (reduceMotion()) return;
    const el = typeof document !== "undefined" ? document.querySelector<HTMLElement>(`[data-id="${itemId}"]`) : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const id = ++getId.current;
    setGets((g) => [...g, { id, rect: { top: r.top, left: r.left, width: r.width, height: r.height }, icon, cost }]);
    setTimeout(() => setGets((g) => g.filter((z) => z.id !== id)), 1000);
  };

  const load = useCallback(async () => {
    const r = await getItems().catch(() => null);
    if (r) {
      setItems(
        r.data.map((d) => ({
          id: d.id, slot: toSlot(d.slot), name: d.name_ja, icon: ITEM_ICON[d.code] ?? "❔",
          rarity: d.rarity as Rarity, price: d.price_coin, owned: d.owned,
        })),
      );
      setCoins(r.coin_balance);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stateOf = (it: Item): State => (it.owned ? "owned" : it.price <= coins ? "affordable" : "short");

  // 行アクション（リスト表示の「操作」⋯）。状態で内容が変わる＝購入可は「購入する」・所有済みは着せ替え導線・
  // コイン不足は理由提示（RowMenuItem に disabled が無いため、押下で不足を通知）。カード表示の購入ボタンと同じ buy() を呼ぶ。
  const itemMenu = (it: Item): RowMenuItem[] => {
    if (it.owned) return [{ label: "▶ きせかえで装備", onClick: () => router.push("/avatar") }];
    if (it.price <= coins) return [{ label: "購入する", onClick: () => void buy(it) }];
    return [{ label: `コイン不足（あと ◆${it.price - coins}）`, onClick: () => snack({ type: "info", msg: `コインが不足しています（あと ◆${it.price - coins}）。評価などでコインを貯めましょう。` }) }];
  };

  async function buy(it: Item) {
    if (it.owned || it.price > coins) return;
    const ok = await confirm({
      variant: "game",
      title: "▶ 購入の確認",
      msg: "この装備を購入します。よろしいですか？",
      cost: { icon: it.icon, name: `${it.name}（${RARITY_LABEL[it.rarity]}）`, price: it.price, balance: coins },
    });
    if (!ok) return; // キャンセル（処理なし）＝スナックバーは出さない
    try {
      const res = await purchaseItem(it.id);
      if (res) setCoins(res.coin_balance);
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, owned: true } : x)));
      setFlashId(it.id);
      setTimeout(() => setFlashId((f) => (f === it.id ? null : f)), 500);
      fireGet(it.id, it.icon, it.price); // 入手の瞬間演出（カードにアイコンポップ＋◆-N）

      snack({
        type: "reward",
        title: "装備を購入しました",
        msg: `「${it.name}」を入手！ きせかえで装備できます。`,
        rewards: [{ k: "coin", t: `◆ -${it.price}` }],
      });
    } catch (err) {
      const reason = err instanceof ApiError ? (err.body as { errors?: { reason?: string }[] } | undefined)?.errors?.[0]?.reason : undefined;
      snack({
        type: "error",
        msg: reason === "insufficient_balance" ? "コインが不足しています。" : reason === "already_owned" ? "すでに所有しています。" : "購入に失敗しました。",
      });
      void load(); // サーバー権威に整合
    }
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
    { key: "price", label: "価格", width: 100, align: "num", sortable: true, filter: { type: "number" }, sortVal: (i) => i.price, filterVal: (i) => i.price, csvVal: (i) => String(i.price), render: (i) => `◆ ${i.price}` },
    { key: "state", label: "状態", width: 120, filter: { type: "enum", options: STATE_OPTIONS }, filterVal: (i) => stateOf(i), csvVal: (i) => STATE_LABEL[stateOf(i)], render: (i) => { const s = stateOf(i); const cls = s === "owned" ? "badge-muted" : s === "affordable" ? "badge-success" : "badge-danger"; return <span className={`badge ${cls}`}>{STATE_LABEL[s]}</span>; } },
    // リスト表示の行アクション（購入する / 着せ替え / コイン不足）。カード表示は cardRaw の購入ボタンで導線あり。
    { key: "_actions", label: "", actions: true, locked: true, width: 64, render: (i) => <RowMenu items={itemMenu(i)} /> },
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
      {/* #12: 購入成立の「アイテム入手」演出（購入カード矩形に固定オーバーレイ） */}
      {gets.map((g) => <ItemGetFx key={g.id} rect={g.rect} icon={g.icon} cost={g.cost} />)}
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="shop-title">ショップ</h1>
      <GameNav current="shop" />
      {loading && <p className="admin-muted" style={{ marginTop: "var(--space-4)" }}>読み込み中…</p>}

      {/* コイン残高（ゲーム層・CRTガラス） */}
      <section className="pixel-panel" aria-label="コイン残高">
        <div className="wallet">
          <div>
            <div className="wallet__num">◆ <CountUp value={coins} /></div>
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
