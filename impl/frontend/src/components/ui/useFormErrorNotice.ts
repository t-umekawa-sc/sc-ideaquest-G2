"use client";

// 入力検証エラーの可視化フック（デザイン標準 §4.7・確定 2026-08-22）。
// スクロールするダイアログでは上部サマリ／インライン枠が画面外に隠れ「押したのに無反応」に見えるため、
// 送信失敗時に (1) 上部サマリへスクロール（フォーカスは奪わない・§4.7）(2) 自動消滅しないエラースナックバー（§14）を出す。
// 併せて FormFooterError（常時見えるフッターのヒント）を使う。
import { useCallback, useRef } from "react";

import { useSnackbar } from "./Snackbar";

export function useFormErrorNotice() {
  const snack = useSnackbar();
  const summaryRef = useRef<HTMLDivElement>(null);

  // 送信失敗時に呼ぶ。summary＝上部サマリと同じ文言配列（空なら何もしない）。
  const notify = useCallback(
    (summary: string[]) => {
      if (summary.length === 0) return;
      // フォーカスは移動しない＝scrollIntoView のみ（§4.7）。初回エラーはサマリ描画前なので次フレームで実行。
      requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
      snack({
        type: "error",
        title: "入力内容をご確認ください",
        msg: summary.length === 1 ? summary[0] : `${summary.length} 件の入力エラーがあります。`,
        duration: 0, // 自動消滅しない（✕で閉じる・§4.7 は持続的情報）
      });
    },
    [snack],
  );

  return { summaryRef, notify };
}
