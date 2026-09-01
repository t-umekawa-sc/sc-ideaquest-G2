"use client";

// SC-32 魔法/スキル（ゲーム層）＝SPステータス（CRTガラス）＋魔法カタログ（系統ごとの段階解放＝スキルツリー）。
// G 実接続＝getSpells（カタログ＋unlocked/can_unlock＋SP残高）・unlockSpell（SP消費・前提/二重解放はサーバー強制）。
// 解放した魔法は SC-24 チャットの魔法リアクションで発動。装飾/社交演出のみで XP/評価/投票に影響しない。
// 正＝doc/画面設計/mocks/SC-32_魔法スキル.html・doc/画面設計/screens/SC-32_魔法スキル.md。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner, CountUp, GameNav, SpellCastFx, useConfirm, useSnackbar, type CastRect } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { reduceMotion } from "@/lib/motion";

import { getSpells, unlockSpell, type SpellDTO } from "../api";
import "../spells.css";

const RARITY: Record<string, string> = { common: "コモン", standard: "標準", rare: "レア" };
// 系統（backend line）→ 表示名。flame=烈火系・quiet_light=静輝系。
const LINES: { key: string; name: string; short: string }[] = [
  { key: "flame", name: "🔥 烈火系", short: "烈火系" },
  { key: "quiet_light", name: "🌟 静輝系", short: "静輝系" },
];
// エフェクト種別 → CSS（spell-fx--*）。
const FX: Record<string, string> = { fire: "spell-fx--fire", thunder: "spell-fx--thunder", rainbow: "spell-fx--rainbow", ice: "spell-fx--ice", sparkle: "spell-fx--sparkle", aura: "spell-fx--aura" };
// エフェクト種別 → プレビュー演出コピー（presentation・backend の description_ja が無い場合の既定）。
const FLAVOR: Record<string, { preview: string; desc: string }> = {
  fire: { preview: "メッセージ枠が燃え上がる 🔥", desc: "対象メッセージの枠が炎に包まれる、熱意を示す定番の魔法。" },
  thunder: { preview: "鋭い気づきに稲妻が走る ⚡", desc: "黄色い閃光が明滅。鋭い指摘・ハッとする気づきに。" },
  rainbow: { preview: "多彩な視点をたたえる虹 🌈", desc: "色相が回る多色グロー。斬新・多面的なアイデアへの最上級の賛辞。" },
  ice: { preview: "冷静に、と伝える青い光 ❄️", desc: "冷たく澄んだ青のグロー。落ち着いた指摘・冷静な視点に。" },
  sparkle: { preview: "素敵なアイデアに祝福を ✨", desc: "紫の柔らかな輝き。称賛・応援のニュアンスに。" },
  aura: { preview: "神々しい光をまとう 🌟", desc: "エメラルドの光輪が脈動。特別なアイデアに、荘厳なオーラを。" },
};

export function SpellsView() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [spells, setSpells] = useState<SpellDTO[]>([]);
  const [sp, setSp] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // #11: 魔法解放の瞬間演出（解放したカード矩形にその魔法の signature エフェクトを弾く・reduce-motion 尊重）。
  const [casts, setCasts] = useState<{ id: number; rect: CastRect; effect: string; rarity: string }[]>([]);
  const castId = useRef(0);
  const fireCast = (cardId: string, effect: string, rarity: string) => {
    if (reduceMotion()) return;
    const el = typeof document !== "undefined" ? document.getElementById(cardId) : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const id = ++castId.current;
    setCasts((c) => [...c, { id, rect: { top: r.top, left: r.left, width: r.width, height: r.height }, effect, rarity }]);
    setTimeout(() => setCasts((c) => c.filter((z) => z.id !== id)), 1000);
  };

  const load = useCallback(async () => {
    try {
      const r = await getSpells();
      if (!r) { setLoadError("魔法カタログの取得に失敗しました。"); return; }
      setSpells(r.data);
      setSp(r.skill_point_balance);
      setLoadError(null);
    } catch {
      setLoadError("魔法カタログの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byId = (id: string | null | undefined) => (id ? spells.find((s) => s.id === id) : undefined);
  const isUnlocked = (id: string | null | undefined) => (id ? !!byId(id)?.unlocked : true);
  const labelOf = (id: string) => { const s = byId(id); return s ? `${s.icon} ${s.name_ja}` : id; };
  const unlockedCount = spells.filter((s) => s.unlocked).length;

  const unlock = async (s: SpellDTO) => {
    if (s.unlocked || busyId) return;
    const ok = await confirm({
      variant: "game",
      title: "▶ 魔法を解放",
      msg: `${s.icon}「${s.name_ja}」を ✦${s.sp_cost} SP で解放しますか？（恒久・取り消し不可）`,
      confirmLabel: "解放する",
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      const res = await unlockSpell(s.id);
      if (res) setSp(res.skill_point_balance);
      fireCast("spell-" + s.id, s.effect, s.rarity); // 解放の瞬間演出（signature エフェクト・レアリティで派手さ変化）
      await load(); // unlocked/can_unlock を最新化
      snack({
        type: "reward",
        title: "魔法を解放しました",
        msg: `「${s.name_ja}」をチャットの魔法リアクションで使えます。`,
        rewards: [{ k: "sp", t: `✦ -${s.sp_cost} SP` }],
      });
    } catch (err) {
      const reason = err instanceof ApiError ? (err.body as { errors?: { reason?: string }[] } | undefined)?.errors?.[0]?.reason : undefined;
      snack({
        type: "error",
        msg:
          reason === "insufficient_sp" ? "スキルポイントが不足しています。"
          : reason === "prerequisite_not_met" ? "前提の魔法を先に解放してください。"
          : reason === "already_unlocked" ? "すでに解放済みです。"
          : "解放に失敗しました。時間をおいて再度お試しください。",
      });
    } finally {
      setBusyId(null);
    }
  };

  const buttonState = (s: SpellDTO): { disabled: boolean; label: string } => {
    if (s.requires_spell_id && !isUnlocked(s.requires_spell_id)) return { disabled: true, label: `前提: ${labelOf(s.requires_spell_id)} が必要` };
    if (sp < s.sp_cost) return { disabled: true, label: `SP不足（あと ${s.sp_cost - sp}）` };
    return { disabled: false, label: "解放する" };
  };

  if (loading) {
    return <section aria-label="魔法 / スキル"><Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link><Spinner label="読み込み中…" /></section>;
  }
  if (loadError) {
    return <section aria-label="魔法 / スキル"><Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link><div className="form-error" role="alert" style={{ marginTop: "var(--space-4)" }}>{loadError}</div></section>;
  }

  return (
    <section aria-label="魔法 / スキル">
      {/* #11: 魔法解放の瞬間演出（解放カード矩形に固定オーバーレイ・自分の解放時のみ） */}
      {casts.map((c) => <SpellCastFx key={c.id} rect={c.rect} effect={c.effect} rarity={c.rarity} />)}
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="spells-title">魔法 / スキル</h1>
      <GameNav current="spells" />

      {/* SPステータス（ゲーム層・CRTガラス） */}
      <section className="pixel-panel" aria-label="スキルポイント">
        <div className="sp-hero">
          <div>
            <div className="sp-hero__num">✦ <CountUp value={sp} /></div>
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
                  const reqMet = isUnlocked(s.requires_spell_id);
                  const flavor = FLAVOR[s.effect] ?? { preview: s.name_ja, desc: "" };
                  return (
                    <article className={`card spell-card rarity-${s.rarity}`} key={s.id} id={"spell-" + s.id}>
                      <div className="spell-card__head">
                        <span className="spell-card__icon">{s.icon}</span>
                        <span className="spell-card__name">{s.name_ja}</span>
                        <span className={`badge rarity-${s.rarity} spell-card__rarity`}>{RARITY[s.rarity] ?? s.rarity}</span>
                      </div>
                      <div className={`spell-preview spell-fx ${FX[s.effect] ?? ""}`}>{flavor.preview}</div>
                      <p className="spell-desc">{flavor.desc}</p>
                      {s.requires_spell_id ? (
                        <div className={`spell-req ${reqMet ? "met" : "unmet"}`}>
                          {reqMet ? "✓ 前提: " : "🔒 前提: "}
                          {labelOf(s.requires_spell_id)}
                        </div>
                      ) : (
                        <div className="spell-req">前提なし（{line.short}の起点）</div>
                      )}
                      <div className="spell-card__foot">
                        <span className="spell-cost">
                          ✦ {s.sp_cost} <span className="muted">SP</span>
                        </span>
                        {s.unlocked ? (
                          <span className="spell-state">✓ 解放済み</span>
                        ) : (
                          <button className="btn-pixel btn-pixel--sm" type="button" disabled={btn.disabled || busyId === s.id} onClick={() => void unlock(s)}>
                            {busyId === s.id ? "解放中…" : btn.label}
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
