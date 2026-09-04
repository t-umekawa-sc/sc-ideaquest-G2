// canvas 魔法エンジンの共通契約とレジストリ（Phase E・GF-AC-091）。
// 受入済みモック（style-guide.html §17b-h）の自己完結 canvas+rAF エンジンを production へ移植する際の
// 共通インターフェース。ハーネス（SpellCanvasFx/useSpellEngine）がこの契約に対してライフサイクルを管理する。
import { createSparkleEngine } from "./sparkle";

export type SpellEngine = {
  canvas: HTMLCanvasElement;
  // 能動発動＝発射(origin)→中央着弾→永続を1枚で再生。origin 省略時は既定位置から。
  start(ox?: number, oy?: number): void;
  // 履歴メッセージ＝発射演出なしで永続だけを再生（リロードのたびに流れ星を再生しない）。
  startPersist(): void;
  // 画面外→再可視で rAF だけ再開（state 保持＝発射からやり直さない）。
  resume(): void;
  // reduce-motion＝rAF を回さず静的1枚を描く。
  reduceStatic(): void;
  // rAF 停止（state は保持）。
  stop(): void;
};

export type EngineOpts = { w: number; h: number; dpr: number; rng?: () => number };
export type EngineFactory = (opts: EngineOpts) => SpellEngine;

// 移植済み（canvas 化済み）の effect のみ登録。未登録の effect は従来の CSS 経路（SpellPersistFx）を使う。
const ENGINES: Record<string, EngineFactory> = {
  sparkle: createSparkleEngine,
};

// canvas エンジンへ寄せる effect か（混在期のゲート）。リテラル一致＝未知は CSS 側に残す。
export function isCanvasEffect(effect: string): boolean {
  return Object.prototype.hasOwnProperty.call(ENGINES, effect);
}

export function engineFor(effect: string): EngineFactory | null {
  return ENGINES[effect] ?? null;
}
