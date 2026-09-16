// I-TC-156: 通知の相対時刻ラベル／グルーピング（SC-01 ダッシュボード・SC-02 一覧で共有）。
// now を固定して決定的に検証する（相対差分ブランチは tz 非依存・昨日/M-D は now 基準で構成）。
import { describe, expect, it } from "vitest";

import { groupOf, timeLabel } from "./time";

const NOW = new Date("2026-09-16T12:00:00"); // ローカル基準（昨日/M-D も同基準で構成し決定的に）
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

describe("timeLabel (I-TC-156)", () => {
  it("直近＝たった今 / n分前 / n時間前（今日）", () => {
    expect(timeLabel(iso(30 * 1000), NOW)).toBe("たった今"); // 60秒未満
    expect(timeLabel(iso(5 * 60 * 1000), NOW)).toBe("5分前");
    expect(timeLabel(iso(3 * 3600 * 1000), NOW)).toBe("3時間前"); // 同日
  });

  it("昨日は『昨日 hh:mm』・それ以前は M/D", () => {
    expect(timeLabel(iso(24 * 3600 * 1000), NOW)).toBe("昨日 12:00");
    expect(timeLabel(iso(3 * 24 * 3600 * 1000), NOW)).toBe("9/13");
  });
});

describe("groupOf (I-TC-156)", () => {
  it("today / yesterday / earlier を境界で判定", () => {
    expect(groupOf(iso(1 * 3600 * 1000), NOW)).toBe("today"); // 今日
    expect(groupOf(iso(24 * 3600 * 1000), NOW)).toBe("yesterday");
    expect(groupOf(iso(3 * 24 * 3600 * 1000), NOW)).toBe("earlier");
  });
});
