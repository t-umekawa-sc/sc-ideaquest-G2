// 内容・説明の入力欄（contentEditable .rt__area）用＝ネイティブの縦リサイズ（resize: vertical）と自動伸長を両立する。
//
// 方針（DFT-N-004/005）＝
//  - 自動伸長：内容がはみ出す時だけ「はみ出さない高さ」まで **伸ばす**（内部スクロールを出さない）。
//  - 手動リサイズ：拡大・縮小ともユーザーのドラッグに委ねる。縮小は内容の高さ（=スクロールが出ない範囲）と
//    CSS の `min-height:140px`（元サイズ）まで。min-height を書き換えないので「一度広げると縮められない」
//    という不具合（DFT-N-005）を避ける。
//  - 縮小方向へ内容より小さくドラッグした場合は clip（はみ出し）になるため、内容の高さまで戻す（＝スクロール回避）。
//
// content 由来の増加は MutationObserver、ドラッグ由来のサイズ変更は ResizeObserver で拾い、共通の fit() を呼ぶ。
// fit() は「はみ出している時だけ伸ばす」ので、拡大ドラッグ（余白）や内容以上の高さは尊重し、縮小を妨げない。
export function attachGrowableResize(el: HTMLElement): () => void {
  let guard = false; // 自分の style.height 変更で ResizeObserver が再入するのを無視
  const fit = () => {
    if (guard) return;
    // はみ出している（内容 > 表示高さ）時だけ、内容が収まる高さまで伸ばす。収まっていれば何もしない（縮小は妨げない）。
    if (el.scrollHeight > el.clientHeight) {
      guard = true;
      el.style.height = `${el.scrollHeight}px`;
      guard = false;
    }
  };
  const ro = new ResizeObserver(() => fit()); // ドラッグ後にはみ出していれば内容まで戻す（＝内容より小さくは縮まない）
  ro.observe(el);
  const mo = new MutationObserver(() => fit()); // 入力/貼付/画像挿入/プログラム設定での内容増加に追従
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  fit();
  return () => { ro.disconnect(); mo.disconnect(); };
}
