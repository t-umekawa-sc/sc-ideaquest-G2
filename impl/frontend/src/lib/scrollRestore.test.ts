// M-TC-012: 一覧のスクロール位置復元の純ロジック（デザイン標準 §4.12）。
// キー生成 / TTL 判定 / クランプ を DOM 非依存で検証する。
import { describe, expect, it } from "vitest";

import { clampScroll, readSaved, storageKey } from "./scrollRestore";

describe("scrollRestore 純ロジック (M-TC-012)", () => {
  it("storageKey＝pathname を接頭辞付きで名前空間化", () => {
    expect(storageKey("/")).toBe("scroll:/");
    expect(storageKey("/notifications")).toBe("scroll:/notifications");
  });

  it("readSaved＝TTL 内の正当な保存は y を返す", () => {
    const now = 1_000_000;
    const ttl = 30 * 60 * 1000;
    const raw = JSON.stringify({ y: 800, t: now });
    expect(readSaved(raw, now, ttl)).toBe(800);
    expect(readSaved(raw, now + ttl - 1, ttl)).toBe(800); // 期限ちょうど手前
  });

  it("readSaved＝TTL 超過・欠損・壊れた JSON は null（誤復元しない）", () => {
    const now = 1_000_000;
    const ttl = 30 * 60 * 1000;
    expect(readSaved(JSON.stringify({ y: 800, t: now }), now + ttl + 1, ttl)).toBeNull();
    expect(readSaved(null, now, ttl)).toBeNull();
    expect(readSaved("not json", now, ttl)).toBeNull();
    expect(readSaved(JSON.stringify({ t: now }), now, ttl)).toBeNull(); // y 欠損
    expect(readSaved(JSON.stringify({ y: "x", t: now }), now, ttl)).toBeNull(); // y 非数値
  });

  it("clampScroll＝[0, max] に収める（縮んでも先頭に飛ばさない）", () => {
    expect(clampScroll(300, 1200)).toBe(300);
    expect(clampScroll(9999, 1200)).toBe(1200);
    expect(clampScroll(-5, 1200)).toBe(0);
  });
});
