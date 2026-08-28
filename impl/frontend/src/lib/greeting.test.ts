// I-TC-154: 時間帯→挨拶の純ロジック（#31・E 時間/環境）。表示（日付・フェード）はブラウザ受入（GF-AC）。
import { describe, expect, it } from "vitest";

import { greetingFor } from "./greeting";

describe("greetingFor (I-TC-154)", () => {
  it("5〜10 は おはようございます", () => {
    expect(greetingFor(5)).toBe("おはようございます");
    expect(greetingFor(10)).toBe("おはようございます");
  });
  it("11〜17 は こんにちは", () => {
    expect(greetingFor(11)).toBe("こんにちは");
    expect(greetingFor(17)).toBe("こんにちは");
  });
  it("18〜4 は こんばんは", () => {
    expect(greetingFor(18)).toBe("こんばんは");
    expect(greetingFor(23)).toBe("こんばんは");
    expect(greetingFor(0)).toBe("こんばんは");
    expect(greetingFor(4)).toBe("こんばんは");
  });
  it("負/24以上は 24 で正規化", () => {
    expect(greetingFor(25)).toBe("こんばんは"); // 25→1
    expect(greetingFor(-1)).toBe("こんばんは"); // -1→23
    expect(greetingFor(30)).toBe("おはようございます"); // 30→6
  });
  it("NaN は正午扱い（こんにちは）", () => {
    expect(greetingFor(Number.NaN)).toBe("こんにちは");
  });
});
