// WebGL 対応判定＋モーション設定（progressive enhancement・SC-31 §9.3）。
// 3D（WebGL）が使える時のみ 3D ビューアを載せ、非対応/初期化失敗時は 2D フォールバック（マスコット）へ。
// DOM/WebGL に触れるため SSR・テスト（node）では false を返す（＝呼び出し側は 2D にフォールバック）。

export function supportsWebGL(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false; // SSR/node
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false; // 初期化失敗＝非対応扱い（2D フォールバック・§9.3）
  }
}

// 回転/演出は prefers-reduced-motion を尊重（SC-31 §9.3/§7）。未対応環境では false（＝演出あり）。
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
