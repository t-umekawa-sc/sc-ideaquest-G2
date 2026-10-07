import { describe, it, expect } from "vitest";

import { belowStuckBar } from "./floatHeadTop";

// M-TC-019: floatHead が sticky バー（.tabs/.ctx）の下へ潜り込む純ロジック（会社名/列名フローティングの
// 重なり回避・2026-10-07 ユーザー指摘）。正＝デザイン標準 §4.5/§4.10。
describe("belowStuckBar", () => {
  const base = 56; // --header-h 相当

  it("バー無し（null/undefined）は top をそのまま返す", () => {
    expect(belowStuckBar(base, null)).toBe(base);
    expect(belowStuckBar(base, undefined)).toBe(base);
  });

  it("固定位置に張り付いているバーは、その下端＋余白まで下げる（重なり回避）", () => {
    // ctx が top(56) に張り付き・高さ 98 → 下端 154。gap 8 で 162。
    expect(belowStuckBar(base, { top: 56, bottom: 154 }, 8)).toBe(162);
    // gap 既定0（タブ）＝下端ちょうど。
    expect(belowStuckBar(base, { top: 56, bottom: 120 })).toBe(120);
  });

  it("上にスクロールで流れきったバー（下端が固定位置より上）は無影響", () => {
    // バーが画面外へ流れた＝bottom(40) <= top(56) → 変えない。
    expect(belowStuckBar(base, { top: -60, bottom: 40 }, 8)).toBe(base);
  });

  it("まだ固定位置まで降りてきていないバー（上端が top より十分下）は無影響", () => {
    // バー上端 200 > top+4 → まだ張り付いていない＝変えない。
    expect(belowStuckBar(base, { top: 200, bottom: 300 }, 8)).toBe(base);
  });
});
