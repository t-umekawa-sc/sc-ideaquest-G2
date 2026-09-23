// 内容・説明の入力欄（contentEditable .rt__area）用＝ネイティブの縦リサイズ（resize: vertical）と自動伸長を両立する。
//
// 課題＝resize のドラッグはインライン `height`（固定値）を設定するため、以後は overflow:auto で内容が
// 超えるとスクロールになり自動伸長が止まる（ユーザー報告）。
// 対策＝ドラッグで設定された固定 height を検出したら、その高さを **min-height（下限）** に付け替え、
// height は auto に戻す。こうすると「手動で好みの高さに広げる」＋「その高さを下限に内容で更に伸びる
// （スクロールを出さない）」を両立できる。content 由来の伸長（height:auto）とドラッグ（inline height）は
// style.height の有無で区別できる。
export function attachGrowableResize(el: HTMLElement): () => void {
  const ro = new ResizeObserver(() => {
    const h = el.style.height;
    // content 由来の伸長は style.height 未設定 or 'auto'＝無視。ドラッグ時のみ inline に px が入る。
    if (h && h !== "auto") {
      const px = Math.round(el.getBoundingClientRect().height); // box-sizing:border-box 前提
      el.style.height = "auto";           // 高さは content に委ねる（下限より下がらず、超えれば伸びる）
      el.style.minHeight = `${px}px`;      // ドラッグした高さを新しい下限に
    }
  });
  ro.observe(el);
  return () => ro.disconnect();
}
