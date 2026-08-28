// C-TC-210: 締切→切迫度/残日表示の純ロジック（#24・ゲーム感）。視覚（バッジ色/脈動）はブラウザ受入（GF-AC）。
import { describe, expect, it } from "vitest";

import { deadlineCountdown, deadlineUrgency } from "./deadline";

const TODAY = "2026-08-27";

describe("deadlineUrgency (C-TC-210)", () => {
  it("締切なし/不正は none", () => {
    expect(deadlineUrgency(null, TODAY)).toEqual({ level: "none", days: null });
    expect(deadlineUrgency(undefined, TODAY)).toEqual({ level: "none", days: null });
    expect(deadlineUrgency("not-a-date", TODAY)).toEqual({ level: "none", days: null });
  });
  it("当日〜2日は urgent", () => {
    expect(deadlineUrgency("2026-08-27", TODAY)).toEqual({ level: "urgent", days: 0 });
    expect(deadlineUrgency("2026-08-29", TODAY)).toEqual({ level: "urgent", days: 2 });
  });
  it("3〜7日は soon", () => {
    expect(deadlineUrgency("2026-08-30", TODAY)).toEqual({ level: "soon", days: 3 });
    expect(deadlineUrgency("2026-09-03", TODAY)).toEqual({ level: "soon", days: 7 });
  });
  it("8日以上は safe", () => {
    expect(deadlineUrgency("2026-09-04", TODAY)).toEqual({ level: "safe", days: 8 });
  });
  it("過去は over（days<0）", () => {
    expect(deadlineUrgency("2026-08-26", TODAY)).toEqual({ level: "over", days: -1 });
  });
});

describe("deadlineCountdown (C-TC-210)", () => {
  it("null→空・負→締切超過・0→今日締切・正→残りN日", () => {
    expect(deadlineCountdown(null)).toBe("");
    expect(deadlineCountdown(-1)).toBe("締切超過");
    expect(deadlineCountdown(0)).toBe("今日締切");
    expect(deadlineCountdown(5)).toBe("残り5日");
  });
});
