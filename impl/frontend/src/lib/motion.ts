// アニメ抑制の実効判定（デザイン標準 §4.9・横断の単一の正）。
// 実効 = OS の prefers-reduced-motion **OR** ユーザー設定（accounts.reduce_motion）。
// OS が最優先の下限＝OS reduce なら常に抑制（ユーザー設定では ON に戻せない）。
// 動きを伴う演出（カウントアップ・座標バースト・魔法発動 等）は必ず本ヘルパで発火可否を判定する
// （window.matchMedia を各所に散らさない＝DRY）。

/** 実効的にモーションを抑制すべきか（純ロジック）。OS reduce OR ユーザー設定 OFF。 */
export function isMotionReduced(osReduce: boolean, userReduce: boolean): boolean {
  return osReduce || userReduce;
}

/**
 * 実行時の実効判定＝OS の prefers-reduced-motion OR アプリ設定。
 * アプリ設定は `(app)` レイアウトが `GET /me` の `account.reduce_motion` で立てる
 * `[data-anim-reduced="true"]`（app-shell 要素）を DOM から読む。SSR/未設定は false（演出あり）。
 */
export function reduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  const osReduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const userReduce =
    typeof document !== "undefined" && document.querySelector('[data-anim-reduced="true"]') !== null;
  return isMotionReduced(osReduce, userReduce);
}
