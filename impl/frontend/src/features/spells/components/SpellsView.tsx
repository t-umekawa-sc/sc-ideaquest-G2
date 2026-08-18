"use client";

// SC-32 魔法/スキル（ゲーム層）＝SPステータス（CRTガラス）＋魔法カタログ（系統ごとの段階解放＝スキルツリー）。
// 解放した魔法は SC-24 アイデアチャットの魔法リアクションで発動。装飾/社交演出のみで XP/評価/投票に影響しない。
// 正＝doc/画面設計/mocks/SC-32_魔法スキル.html・doc/画面設計/screens/SC-32_魔法スキル.md。
// SP/魔法 backend 未実装＝デモ fixtures（画面モック先行）。解放は確認ダイアログ→完了は報酬スナックバー。
import Link from "next/link";
import { useState } from "react";

import { GameNav, useConfirm, useSnackbar } from "@/components/ui";

import "../spells.css";

type Rarity = "common" | "standard" | "rare";
type LineKey = "blaze" | "glow";
type Spell = {
  id: string;
  line: LineKey;
  icon: string;
  name: string;
  rarity: Rarity;
  fx: string; // spell-fx--*
  preview: string;
  desc: string;
  requires: string | null;
  cost: number;
  unlocked: boolean;
};

const RARITY: Record<Rarity, string> = { common: "コモン", standard: "標準", rare: "レア" };
const LINES: { key: LineKey; name: string }[] = [
  { key: "blaze", name: "🔥 烈火系" },
  { key: "glow", name: "🌟 静輝系" },
];

const INITIAL: Spell[] = [
  { id: "fire", line: "blaze", icon: "🔥", name: "炎", rarity: "common", fx: "spell-fx--fire", preview: "メッセージ枠が燃え上がる 🔥", desc: "対象メッセージの枠が炎に包まれる、熱意を示す定番の魔法。", requires: null, cost: 1, unlocked: true },
  { id: "thunder", line: "blaze", icon: "⚡", name: "雷", rarity: "standard", fx: "spell-fx--thunder", preview: "鋭い気づきに稲妻が走る ⚡", desc: "黄色い閃光が明滅。鋭い指摘・ハッとする気づきに。", requires: "fire", cost: 2, unlocked: true },
  { id: "rainbow", line: "blaze", icon: "🌈", name: "虹", rarity: "rare", fx: "spell-fx--rainbow", preview: "多彩な視点をたたえる虹 🌈", desc: "色相が回る多色グロー。斬新・多面的なアイデアへの最上級の賛辞。", requires: "thunder", cost: 3, unlocked: false },
  { id: "ice", line: "glow", icon: "❄️", name: "氷", rarity: "common", fx: "spell-fx--ice", preview: "冷静に、と伝える青い光 ❄️", desc: "冷たく澄んだ青のグロー。落ち着いた指摘・冷静な視点に。", requires: null, cost: 1, unlocked: true },
  { id: "sparkle", line: "glow", icon: "✨", name: "キラキラ", rarity: "standard", fx: "spell-fx--sparkle", preview: "素敵なアイデアに祝福を ✨", desc: "紫の柔らかな輝き。称賛・応援のニュアンスに。", requires: "ice", cost: 2, unlocked: false },
  { id: "aura", line: "glow", icon: "🌟", name: "オーラ", rarity: "rare", fx: "spell-fx--aura", preview: "神々しい光をまとう 🌟", desc: "エメラルドの光輪が脈動。特別なアイデアに、荘厳なオーラを。", requires: "sparkle", cost: 3, unlocked: false },
];

export function SpellsView() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [spells, setSpells] = useState<Spell[]>(INITIAL);
  const [sp, setSp] = useState(3);

  const byId = (id: string) => spells.find((s) => s.id === id);
  const isUnlocked = (id: string | null) => (id ? !!byId(id)?.unlocked : true);
  const labelOf = (id: string) => {
    const s = byId(id);
    return s ? `${s.icon} ${s.name}` : id;
  };
  const unlockedCount = spells.filter((s) => s.unlocked).length;

  async function unlock(s: Spell) {
    if (s.unlocked) return;
    if (s.requires && !isUnlocked(s.requires)) return;
    if (sp < s.cost) return;
    const ok = await confirm({
      variant: "game",
      title: "▶ 魔法を解放",
      msg: `${s.icon}「${s.name}」を ✦${s.cost} SP で解放しますか？（恒久・取り消し不可）`,
      confirmLabel: "解放する",
    });
    if (!ok) return; // キャンセル（処理なし）＝スナックバーは出さない
    setSp((v) => v - s.cost);
    setSpells((xs) => xs.map((x) => (x.id === s.id ? { ...x, unlocked: true } : x)));
    snack({
      type: "reward",
      title: "魔法を解放しました",
      msg: `「${s.name}」をチャットの魔法リアクションで使えます。`,
      rewards: [{ k: "sp", t: `✦ -${s.cost} SP` }],
    });
  }

  function buttonState(s: Spell): { disabled: boolean; label: string } {
    if (s.requires && !isUnlocked(s.requires)) return { disabled: true, label: `前提: ${labelOf(s.requires)} が必要` };
    if (sp < s.cost) return { disabled: true, label: `SP不足（あと ${s.cost - sp}）` };
    return { disabled: false, label: "解放する" };
  }

  return (
    <section aria-label="魔法 / スキル">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="spells-title">魔法 / スキル</h1>
      <GameNav current="spells" />

      {/* SPステータス（ゲーム層・CRTガラス） */}
      <section className="pixel-panel" aria-label="スキルポイント">
        <div className="sp-hero">
          <div>
            <div className="sp-hero__num">✦ {sp}</div>
            <div className="sp-hero__label">SKILL POINT</div>
          </div>
          <div className="sp-hero__meta">
            <span>▶ レベルアップごとに <strong>+1 SP</strong> を獲得</span>
            <span>▶ SP を使って下の<strong>魔法を解放</strong>（恒久・一度きり）</span>
            <span>▶ 解放した魔法は<strong>チャットの魔法リアクション</strong>で発動</span>
          </div>
          <div className="sp-hero__progress">
            <div className="sp-hero__unlocked">解放 {unlockedCount} / {spells.length}</div>
            <div className="sp-hero__label" style={{ opacity: 0.7 }}>MAGIC UNLOCKED</div>
          </div>
        </div>
      </section>

      <p className="how">
        魔法は<strong>装飾/社交演出のみ</strong>で、XP・評価・投票には影響しません。各魔法は
        <strong>1つのアイデアチャットにつき1回</strong>だけ発動でき、通常リアクション同様に<strong>取り消して別メッセージへ付け替え</strong>できます。
        <strong>系統ごとに下位から順に解放</strong>（上位の解放には<strong>同系統の下位魔法が解放済み</strong>である必要があります）。
        発動は アイデアチャット のメッセージのリアクションから。
      </p>

      <h2 className="spells-title" style={{ fontSize: "var(--text-xl)" }}>魔法カタログ</h2>
      <div>
        {LINES.map((line) => (
          <section className="spell-line" aria-label={line.name} key={line.key}>
            <div className="spell-line__head">
              <span className="spell-line__name">{line.name}</span>
              <span className="spell-line__sub">下位から順に解放（コモン → 標準 → レア）</span>
            </div>
            <div className="spell-grid">
              {spells
                .filter((s) => s.line === line.key)
                .map((s) => {
                  const btn = buttonState(s);
                  const reqMet = isUnlocked(s.requires);
                  return (
                    <article className="card spell-card" key={s.id}>
                      <div className="spell-card__head">
                        <span className="spell-card__icon">{s.icon}</span>
                        <span className="spell-card__name">{s.name}</span>
                        <span className={`badge rarity-${s.rarity} spell-card__rarity`}>{RARITY[s.rarity]}</span>
                      </div>
                      <div className={`spell-preview spell-fx ${s.fx}`}>{s.preview}</div>
                      <p className="spell-desc">{s.desc}</p>
                      {s.requires ? (
                        <div className={`spell-req ${reqMet ? "met" : "unmet"}`}>
                          {reqMet ? "✓ 前提: " : "🔒 前提: "}
                          {labelOf(s.requires)}
                        </div>
                      ) : (
                        <div className="spell-req">前提なし（{line.name.replace(/^\S+\s?/, "")}の起点）</div>
                      )}
                      <div className="spell-card__foot">
                        <span className="spell-cost">
                          ✦ {s.cost} <span className="muted">SP</span>
                        </span>
                        {s.unlocked ? (
                          <span className="spell-state">✓ 解放済み</span>
                        ) : (
                          <button className="btn-pixel btn-pixel--sm" type="button" disabled={btn.disabled} onClick={() => unlock(s)}>
                            {btn.label}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </div>

      <p className="role-note" style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
        魔法の解放には、<strong>同じ系統の下位魔法が解放済み</strong>であることと <strong>SP の消費</strong>が必要です。解放した魔法はずっと使えます。
      </p>
    </section>
  );
}
