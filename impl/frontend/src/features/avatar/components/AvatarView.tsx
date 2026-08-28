"use client";

// SC-31 アバター/着せ替え（ゲーム層）＝3Dアバタービューア（CRTガラス・モックはマスコットで代用）＋
// ワードローブ（5スロット×装備・クリック着替え・即反映）。装備セットは SC-30 ショップと共通。
// 正＝doc/画面設計/mocks/SC-31_アバター着せ替え.html・screens/SC-31・API設計 G.1/G.2。
// G 実接続＝getItems（カタログ＋所有＋装備＋残高）／updateEquipment（各スロット1点はサーバー強制）。未所有はショップ導線。
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Spinner, GameNav, useConfirm, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { getItems, ITEM_ICON, updateEquipment } from "@/features/shop/api";

import { updateAvatarBase } from "../api";
import { AVATAR_BASE_LABEL, AVATAR_BASES, type AvatarBase } from "../base";
import { supportsWebGL } from "../webgl";
import "../avatar.css";

// 3Dビューアは WebGL/DOM 依存＝SSR 不可。client でのみ動的ロード（非対応時はそもそも描画しない・§9.3）。
const AvatarViewer3D = dynamic(() => import("./AvatarViewer3D").then((m) => m.AvatarViewer3D), { ssr: false });

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
const EMPTY_ITEMS: Record<SlotKey, Item[]> = { head: [], face: [], body: [], hand: [], bg: [] };
// view スロット（bg）↔ backend スロット（background）。
const toSlot = (s: string): SlotKey => (s === "background" ? "bg" : s) as SlotKey;
const backendSlot = (s: SlotKey): string => (s === "bg" ? "background" : s);

export function AvatarView({ initialAvatarBase = "male" }: { initialAvatarBase?: AvatarBase } = {}) {
  const router = useRouter();
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [items, setItems] = useState<Record<SlotKey, Item[]>>(EMPTY_ITEMS);
  const [equipped, setEquipped] = useState<Record<SlotKey, string | null>>({ head: null, face: null, body: null, hand: null, bg: null });
  const [coins, setCoins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [base, setBase] = useState<AvatarBase>(initialAvatarBase);
  const [justEquippedId, setJustEquippedId] = useState<string | null>(null); // #14: 装着したカードの一瞬フラッシュ
  // WebGL 検出は client のみ（SSR/初回描画は 2D フォールバックで一致→mount 後に 3D へ昇格・§9.3）。
  const [webgl, setWebgl] = useState(false);
  useEffect(() => { setWebgl(supportsWebGL()); }, []);

  async function switchBase(next: AvatarBase) {
    if (next === base) return;
    const prev = base;
    setBase(next); // 楽観更新
    const res = await updateAvatarBase(next).catch(() => null);
    if (!res) {
      setBase(prev); // ロールバック
      snack({ type: "error", msg: "ベースの変更に失敗しました。" });
    }
  }

  const load = useCallback(async () => {
    const r = await getItems().catch(() => null);
    if (r) {
      const grouped: Record<SlotKey, Item[]> = { head: [], face: [], body: [], hand: [], bg: [] };
      const eq: Record<SlotKey, string | null> = { head: null, face: null, body: null, hand: null, bg: null };
      for (const d of r.data) {
        const slot = toSlot(d.slot);
        if (!grouped[slot]) continue;
        grouped[slot].push({ id: d.id, name: d.name_ja, icon: ITEM_ICON[d.code] ?? "❔", rarity: d.rarity as Rarity, owned: d.owned, price: d.price_coin });
        if (d.is_equipped) eq[slot] = d.id;
      }
      setItems(grouped);
      setEquipped(eq);
      setCoins(r.coin_balance);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const itemOf = (slot: SlotKey, id: string | null) => (id ? items[slot].find((i) => i.id === id) ?? null : null);
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

  async function equip(slot: SlotKey, id: string | null) {
    const prev = equipped[slot];
    setEquipped((e) => ({ ...e, [slot]: id })); // 楽観更新
    try {
      const res = await updateEquipment({ [backendSlot(slot)]: id });
      if (res) {
        const newId = res.equipped[backendSlot(slot)] ?? null;
        setEquipped((e) => ({ ...e, [slot]: newId }));
        // #14: 装着（外す=null は除く）でカードを一瞬フラッシュ。アバター側の装着ポップは viewer__slot の keyed 内側要素（CSS）。
        if (newId) {
          setJustEquippedId(newId);
          setTimeout(() => setJustEquippedId((j) => (j === newId ? null : j)), 650);
        }
      }
    } catch (err) {
      setEquipped((e) => ({ ...e, [slot]: prev })); // ロールバック
      const st = err instanceof ApiError ? err.status : 0;
      snack({ type: "error", msg: st === 422 ? "この装備は着用できません。" : "着せ替えに失敗しました。" });
    }
  }

  if (loading) {
    return (
      <section aria-label="アバター / 着せ替え">
        <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
        <Spinner label="読み込み中…" />
      </section>
    );
  }

  return (
    <section aria-label="アバター / 着せ替え">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="dressup-title">アバター / 着せ替え</h1>
      <GameNav current="avatar" />

      <div className="dressup">
        {/* 左: 3Dアバタービューア（ゲーム層・CRTガラス） */}
        <section className="pixel-panel viewer" aria-label="アバタープレビュー">
          <div className="viewer__stage">
            <div className="viewer__bg">{preview("bg")}</div>
            {webgl ? (
              <AvatarViewer3D base={base} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="viewer__avatar" src="/assets/mascot-hero.png" alt="あなたのアバター" />
            )}
            {/* 装備プレビュー（絵文字重ね）＝2D 見立て。3D の実パーツ反映はアセット導入時（§9.2 seam）。
                #14: 内側 <i> を装備 id で key 化＝装着した瞬間にその要素が再マウントし CSS pop＋sparkle を再生
                （外側 .viewer__slot は位置決めの transform を持つため、pop は内側要素で行い衝突を避ける）。 */}
            <span className="viewer__slot" data-slot="head">{preview("head") && <i className="slot-fx" key={equipped.head ?? ""}>{preview("head")}</i>}</span>
            <span className="viewer__slot" data-slot="face">{preview("face") && <i className="slot-fx" key={equipped.face ?? ""}>{preview("face")}</i>}</span>
            <span className="viewer__slot" data-slot="hand">{preview("hand") && <i className="slot-fx" key={equipped.hand ?? ""}>{preview("hand")}</i>}</span>
          </div>
          {/* ベース切替（男/女・§4.1/§9.2）＝即時プレビュー反映＋PUT /me/avatar-base で永続 */}
          <div className="viewer__base" role="group" aria-label="ベース体の切替">
            {AVATAR_BASES.map((b) => (
              <button
                key={b}
                type="button"
                className={`btn btn-pixel viewer__base-btn${b === base ? " is-active" : ""}`}
                aria-pressed={b === base}
                onClick={() => void switchBase(b)}
              >
                {AVATAR_BASE_LABEL[b]}
              </button>
            ))}
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

                  {items[slot.key].map((it) => {
                    const isEq = eqId === it.id;
                    const act = () => (it.owned ? void equip(slot.key, it.id) : void onLocked(slot.key, it));
                    return (
                      <article
                        key={it.id}
                        className={`card item rarity-${it.rarity}${isEq ? " is-equipped" : ""}${it.owned ? "" : " is-locked"}${justEquippedId === it.id ? " just-equipped" : ""}`}
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
