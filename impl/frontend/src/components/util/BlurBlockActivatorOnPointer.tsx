"use client";

// 横断ユーティリティ＝マウス/タッチのクリックで「ブロック活性要素」（一覧の行・カード・カードリンク・
// 全文検索結果・参加リクエスト行 等＝要素全体がクリックで詳細/ダイアログを開く UI）を操作した後、その要素に
// フォーカスが残って `:focus-visible` の枠線/背景が居座る問題を、個別コンポーネントに手を入れず一括で解消する。
//
// なぜグローバルか＝この動線が多数（DataTable 行/カード・ft-result・join-req-row・quest-card 等）に散在し、
// 都度パッチだと漏れる（ユーザー指摘の「横展開」）。ブロック活性要素だけを対象にし、通常のボタン/入力/リンクの
// フォーカス復帰（フォーム系ダイアログの a11y）には触れない。
//
// キーボード発火（Enter/Space 由来の click は detail===0）は blur しない＝キーボードのフォーカス可視（WCAG）を維持。
import { useEffect } from "react";

const SELECTOR =
  ".dt-row--link,.dt-card--link,.ft-result,.join-req-row,.quest-card,.draft-card,[data-block-activator]";

export function BlurBlockActivatorOnPointer() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return; // キーボード（Enter/Space）由来 → フォーカス維持
      const el = (e.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null;
      // 要素自身がフォーカスを持つ時だけ外れる（内側のボタン等にフォーカスがある場合は no-op）。
      if (el) el.blur();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
