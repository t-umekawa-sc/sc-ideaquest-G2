import { describe, it, expect } from "vitest";
import { castEffect, castTier, castParticleCount, castParticles } from "./cast";

// G-TC-151: 魔法発動演出（SpellCastFx / GF-AC-091）の純ロジック。
// 種別の正規化・レアリティ強度・「中央から外側へ広がる」放射状粒子配置を担保する。
describe("castEffect", () => {
  it("既知の種別はそのまま返す", () => {
    for (const e of ["fire", "thunder", "ice", "sparkle", "rainbow", "aura"]) {
      expect(castEffect(e)).toBe(e);
    }
  });
  it("未知の種別は sparkle に畳む（既定アイコンと一致）", () => {
    expect(castEffect("unknown")).toBe("sparkle");
    expect(castEffect("")).toBe("sparkle");
  });
});

describe("castTier", () => {
  it("既知のレアリティはそのまま返す", () => {
    expect(castTier("common")).toBe("common");
    expect(castTier("standard")).toBe("standard");
    expect(castTier("rare")).toBe("rare");
  });
  it("未知のレアリティは standard に畳む", () => {
    expect(castTier("legendary")).toBe("standard");
    expect(castTier("")).toBe("standard");
  });
});

describe("castParticleCount", () => {
  it("レアリティが高いほど粒子が増える（common<standard<rare）", () => {
    const c = castParticleCount("common");
    const s = castParticleCount("standard");
    const r = castParticleCount("rare");
    expect(c).toBeLessThan(s);
    expect(s).toBeLessThan(r);
  });
  it("未知は standard 相当", () => {
    expect(castParticleCount("legendary")).toBe(castParticleCount("standard"));
  });
});

describe("castParticles", () => {
  it("粒子数は castParticleCount と一致する", () => {
    for (const rar of ["common", "standard", "rare"]) {
      expect(castParticles(rar)).toHaveLength(castParticleCount(rar));
    }
  });
  it("先頭の粒子は真上へ放射する（中央から外側・dx≈0, dy<0）", () => {
    const [head] = castParticles("standard");
    expect(Math.abs(head.dx)).toBeLessThanOrEqual(1);
    expect(head.dy).toBeLessThan(0);
  });
  it("全粒子がほぼ等半径で全周に散る（放射状）", () => {
    const ps = castParticles("rare");
    const radii = ps.map((p) => Math.hypot(p.dx, p.dy));
    const max = Math.max(...radii);
    const min = Math.min(...radii);
    expect(max - min).toBeLessThanOrEqual(2); // 丸め誤差のみ
    // 上下左右いずれにも向く粒子がある＝全周に広がる
    expect(ps.some((p) => p.dy > 0)).toBe(true);
    expect(ps.some((p) => p.dx > 0)).toBe(true);
    expect(ps.some((p) => p.dx < 0)).toBe(true);
  });
  it("レアリティが高いほど広く散る（rare の半径 > common）", () => {
    const rCommon = Math.hypot(castParticles("common")[0].dx, castParticles("common")[0].dy);
    const rRare = Math.hypot(castParticles("rare")[0].dx, castParticles("rare")[0].dy);
    expect(rRare).toBeGreaterThan(rCommon);
  });
  it("決定的（同入力で同結果）", () => {
    expect(castParticles("rare")).toEqual(castParticles("rare"));
  });
});
