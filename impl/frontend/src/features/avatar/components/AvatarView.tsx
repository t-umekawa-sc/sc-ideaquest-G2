"use client";

// SC-31 アバター/着せ替え（ゲーム層）＝3Dアバタービューア（CRTガラス・モックはマスコットで代用）＋
// ワードローブ（5スロット×装備・クリック着替え・即反映）。装備セットは SC-30 ショップと共通。
// 正＝doc/画面設計/mocks/SC-31_アバター着せ替え.html・doc/画面設計/screens/SC-31_アバター着せ替え.md。
// 装備/コイン backend 未実装＝デモ fixtures（画面モック先行）。未所有クリックはショップ導線（確認ダイアログ）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useConfirm } from "@/components/ui";

import "../avatar.css";

type SlotKey = "head" | "face" | "body" | "hand" | "bg";
type Rarity = "common" | "standard" | "rare";
type Item = { id: string; name: string; icon: string; rarity: Rarity; owned: boolean; price?: number };

const SLOTS: { key: SlotKey; label: string; preview: boolean }[] = [
  { key: "head", label: "頭", preview: true },
  { key: "face", label: "顔", preview: true },
  { key: "body", label: "体", preview: false }, // 体はアバター画像そのもの（モックでは重ねない）
  { key: "hand", label: "手持ち", preview: true },
  { key: "bg", label: "背景", preview: true },
];
const RARITY: Record<Rarity, string> = { common: "コモン", standard: "標準", rare: "レア" };

const ITEMS: Record<SlotKey, Item[]> = {
  head: [
    { id: "crown", name: "王冠", icon: "👑", rarity: "rare", owned: true },
    { id: "tophat", name: "シルクハット", icon: "🎩", rarity: "standard", owned: true },
    { id: "cap", name: "キャップ", icon: "🧢", rarity: "common", owned: true },
    { id: "straw", name: "麦わら帽", icon: "👒", rarity: "common", owned: false, price: 20 },
  ],
  face: [
    { id: "shades", name: "サングラス", icon: "🕶️", rarity: "standard", owned: true },
    { id: "glasses", name: "メガネ", icon: "👓", rarity: "common", owned: true },
    { id: "mask", name: "マスク", icon: "😷", rarity: "common", owned: false, price: 15 },
  ],
  body: [
    { id: "armor", name: "アーマー", icon: "🛡️", rarity: "rare", owned: true },
    { id: "suit", name: "スーツ", icon: "👔", rarity: "standard", owned: true },
    { id: "gi", name: "道着", icon: "🥋", rarity: "common", owned: true },
    { id: "coat", name: "ロングコート", icon: "🧥", rarity: "standard", owned: false, price: 120 },
  ],
  hand: [
    { id: "sword", name: "剣", icon: "⚔️", rarity: "rare", owned: true },
    { id: "wand", name: "魔法の杖", icon: "🪄", rarity: "standard", owned: true },
    { id: "book", name: "本", icon: "📖", rarity: "common", owned: true },
    { id: "hammer", name: "大槌", icon: "🔨", rarity: "standard", owned: false, price: 90 },
  ],
  bg: [
    { id: "sunset", name: "夕焼けの海", icon: "🌅", rarity: "standard", owned: true },
    { id: "galaxy", name: "星空", icon: "🌌", rarity: "rare", owned: true },
    { id: "forest", name: "森", icon: "🌲", rarity: "common", owned: true },
    { id: "castle", name: "古城", icon: "🏰", rarity: "rare", owned: false, price: 500 },
  ],
};

const coins = 320;

export function AvatarView() {
  const router = useRouter();
  const confirm = useConfirm();
  // 初期装備（各スロット1点・null=未装備）
  const [equipped, setEquipped] = useState<Record<SlotKey, string | null>>({
    head: "crown", face: "shades", body: "armor", hand: "sword", bg: "galaxy",
  });

  const itemOf = (slot: SlotKey, id: string | null) => (id ? ITEMS[slot].find((i) => i.id === id) ?? null : null);
  const preview = (slot: SlotKey) => itemOf(slot, equipped[slot])?.icon ?? "";

  async function onLocked(_slot: SlotKey, it: Item) {
    // ここは購入ではなくショップへの導線＝残高プレビュー（cost）は出さない（購入と誤認させないため）。価格は文言で示す。
    const ok = await confirm({
      variant: "game",
      title: "▶ ショップへ移動",
      msg: `${it.icon}「${it.name}」（${RARITY[it.rarity]}・◆${it.price}）はショップで購入できます。ショップへ移動しますか？`,
      confirmLabel: "ショップへ",
    });
    if (ok) router.push("/shop");
  }

  function equip(slot: SlotKey, id: string | null) {
    setEquipped((e) => ({ ...e, [slot]: id }));
  }

  return (
    <section aria-label="アバター / 着せ替え">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="dressup-title">アバター / 着せ替え</h1>

      <div className="dressup">
        {/* 左: 3Dアバタービューア（ゲーム層・CRTガラス） */}
        <section className="pixel-panel viewer" aria-label="アバタープレビュー">
          <div className="viewer__stage">
            <div className="viewer__bg">{preview("bg")}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="viewer__avatar" src="/assets/mascot-hero.png" alt="あなたのアバター" />
            <span className="viewer__slot" data-slot="head">{preview("head")}</span>
            <span className="viewer__slot" data-slot="face">{preview("face")}</span>
            <span className="viewer__slot" data-slot="hand">{preview("hand")}</span>
          </div>
          <div className="viewer__foot">
            <span className="viewer__name">山田 太郎</span>
            <span className="viewer__lv">Lv.7</span>
          </div>
        </section>

        {/* 右: ワードローブ（スロットごと） */}
        <section className="wardrobe" aria-label="装備一覧">
          <div className="wardrobe__top">
            <span className="coin-line" title="コイン残高">◆ {coins} コイン</span>
            <Link className="btn btn-primary" href="/shop">🛒 ショップへ（装備を買う）</Link>
          </div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", marginBottom: "var(--space-5)", lineHeight: 1.7 }}>
            アバターは <strong>5スロット（頭 / 顔 / 体 / 手持ち / 背景）</strong>・各スロット1点まで装備できます。
            所有済みの装備をクリックで<strong>着せ替え</strong>（即反映）。未所有はショップでコイン購入。
          </p>

          {SLOTS.map((slot) => {
            const eqId = equipped[slot.key];
            const eqItem = itemOf(slot.key, eqId);
            const eqLabel = eqItem ? `${eqItem.icon} ${eqItem.name}` : "なし";
            return (
              <section className="slot" aria-label={`${slot.label}スロット`} key={slot.key}>
                <div className="slot__head">
                  <span className="slot__name">{slot.label}</span>
                  <span className="slot__equipped">
                    装備中: <strong>{eqLabel}</strong>
                  </span>
                </div>
                <div className="item-grid">
                  {/* 「外す」カード */}
                  <article
                    className={`card item item--none${eqId ? "" : " is-equipped"}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => equip(slot.key, null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        equip(slot.key, null);
                      }
                    }}
                  >
                    <div className="item__thumb">✕</div>
                    <div className="item__name">外す</div>
                    <div className="item__rarity">&nbsp;</div>
                    {!eqId && <span className="badge item__equipped-badge">装備中</span>}
                  </article>

                  {ITEMS[slot.key].map((it) => {
                    const isEq = eqId === it.id;
                    const act = () => (it.owned ? equip(slot.key, it.id) : onLocked(slot.key, it));
                    return (
                      <article
                        key={it.id}
                        className={`card item${isEq ? " is-equipped" : ""}${it.owned ? "" : " is-locked"}`}
                        role="button"
                        tabIndex={0}
                        onClick={act}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            act();
                          }
                        }}
                      >
                        <div className="item__thumb">{it.icon}</div>
                        <div className="item__name">{it.name}</div>
                        <div className={`item__rarity rarity-${it.rarity}`}>{RARITY[it.rarity]}</div>
                        {!it.owned && <div className="item__price">◆ {it.price}</div>}
                        {!it.owned && <div className="item__buy" style={{ color: "var(--color-text-muted)" }}>🔒 ショップで購入</div>}
                        {isEq && <span className="badge item__equipped-badge">装備中</span>}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <p className="role-note" style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
            アイテムの入手は<strong>コイン購入のみ</strong>です（レベルや実績で装備が直接手に入ることはありません。実績ではコインを獲得できます）。
          </p>
        </section>
      </div>
    </section>
  );
}
