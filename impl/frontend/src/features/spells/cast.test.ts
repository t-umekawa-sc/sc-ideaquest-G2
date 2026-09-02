import { describe, it, expect } from "vitest";
import {
  castEffect, castTier, castParticleCount, castParticles,
  castDelivery, boltPoints, iceShards, crescentCount,
  castBurstKind, radialBurst, firePillars, thunderBolts, thunderSparks, rainbowArcBands, auraMotes, iceCrackTree,
} from "./cast";

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

// G-TC-152: 属性別デリバリー（発射方式）の純ロジック（Phase B・SpellDeliveryFx / GF-AC-091）。
// effect→種別・稲妻ジグザグ・氷礫レイアウト・三日月本数を決定的に担保する。
describe("castDelivery", () => {
  it("effect ごとに発射方式が変わる", () => {
    expect(castDelivery("fire")).toBe("ball");
    expect(castDelivery("sparkle")).toBe("ball");
    expect(castDelivery("thunder")).toBe("bolt");
    expect(castDelivery("ice")).toBe("shards");
    expect(castDelivery("rainbow")).toBe("beam");
    expect(castDelivery("aura")).toBe("crescents");
  });
  it("未知の effect は sparkle 相当＝ball に畳む", () => {
    expect(castDelivery("unknown")).toBe("ball");
    expect(castDelivery("")).toBe("ball");
  });
});

describe("boltPoints", () => {
  it("点数は seg+1・t は 0→1 単調増加で両端 0/1", () => {
    const pts = boltPoints(6);
    expect(pts).toHaveLength(7);
    expect(pts[0].t).toBe(0);
    expect(pts[pts.length - 1].t).toBe(1);
    for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThan(pts[i - 1].t);
  });
  it("両端は横オフセット 0（発射元/着弾点に接続）・中間は交互に振れる", () => {
    const pts = boltPoints(6);
    expect(pts[0].off).toBe(0);
    expect(pts[pts.length - 1].off).toBe(0);
    const mids = pts.slice(1, -1).map((p) => p.off);
    expect(mids.some((o) => o > 0)).toBe(true);
    expect(mids.some((o) => o < 0)).toBe(true);
  });
  it("決定的（同入力で同結果）", () => {
    expect(boltPoints(6)).toEqual(boltPoints(6));
  });
});

describe("iceShards", () => {
  it("4片・大小が異なる・左右いずれにもズレる", () => {
    const sh = iceShards();
    expect(sh).toHaveLength(4);
    expect(new Set(sh.map((s) => s.scale)).size).toBeGreaterThan(1); // 一様でない
    expect(sh.some((s) => s.dx > 0)).toBe(true);
    expect(sh.some((s) => s.dx < 0)).toBe(true);
  });
  it("決定的（同入力で同結果）", () => {
    expect(iceShards()).toEqual(iceShards());
  });
});

describe("crescentCount", () => {
  it("4..9 にクランプ・距離が長いほど単調非減少", () => {
    expect(crescentCount(0)).toBe(4);
    expect(crescentCount(-100)).toBe(4);        // 下限
    expect(crescentCount(100000)).toBe(9);      // 上限
    let prev = crescentCount(0);
    for (let d = 0; d <= 600; d += 30) {
      const n = crescentCount(d);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(9);
      prev = n;
    }
  });
});

// G-TC-153: 着弾バースト（属性別幾何）の純ロジック（Phase C・SpellCastFx / GF-AC-091）。
describe("castBurstKind", () => {
  it("effect ごとにバースト幾何が変わる", () => {
    expect(castBurstKind("fire")).toBe("plume");
    expect(castBurstKind("thunder")).toBe("rays");
    expect(castBurstKind("ice")).toBe("shards");
    expect(castBurstKind("rainbow")).toBe("rings");
    expect(castBurstKind("aura")).toBe("motes");
    expect(castBurstKind("sparkle")).toBe("motes");
  });
  it("未知の effect は sparkle 相当＝motes に畳む", () => {
    expect(castBurstKind("unknown")).toBe("motes");
    expect(castBurstKind("")).toBe("motes");
  });
});

describe("radialBurst", () => {
  it("要素数は n（n≤0 は空）", () => {
    expect(radialBurst(8, 40)).toHaveLength(8);
    expect(radialBurst(0, 40)).toHaveLength(0);
    expect(radialBurst(-3, 40)).toHaveLength(0);
  });
  it("各点は半径 r にほぼ一致・隣接角は 360/n で等間隔", () => {
    const n = 8, r = 50;
    const ps = radialBurst(n, r);
    for (const p of ps) expect(Math.abs(Math.hypot(p.dx, p.dy) - r)).toBeLessThanOrEqual(2);
    const degs = ps.map((p) => p.deg);
    for (let i = 1; i < degs.length; i++) expect(degs[i] - degs[i - 1]).toBe(360 / n);
  });
  it("既定の起点は真上（先頭 dx≈0, dy<0）", () => {
    const [head] = radialBurst(6, 40);
    expect(Math.abs(head.dx)).toBeLessThanOrEqual(1);
    expect(head.dy).toBeLessThan(0);
  });
  it("決定的（同入力で同結果）", () => {
    expect(radialBurst(9, 60, -90)).toEqual(radialBurst(9, 60, -90));
  });
});

// G-TC-154: 属性別永続エフェクトの純ロジック（Phase D・SpellPersistFx / GF-AC-091）。
describe("firePillars", () => {
  it("8本・left は左→右へ単調増加で 0..100%・高さは一様でない", () => {
    const ps = firePillars();
    expect(ps).toHaveLength(8);
    for (let i = 1; i < ps.length; i++) expect(ps[i].left).toBeGreaterThan(ps[i - 1].left);
    for (const p of ps) { expect(p.left).toBeGreaterThanOrEqual(0); expect(p.left).toBeLessThanOrEqual(100); }
    expect(new Set(ps.map((p) => p.h)).size).toBeGreaterThan(1); // 背の高い火柱がある
  });
  it("決定的（同入力で同結果）", () => {
    expect(firePillars()).toEqual(firePillars());
  });
});

describe("thunderBolts / thunderSparks", () => {
  it("稲妻3本・スパーク2個・left は 0..100%・決定的", () => {
    const bolts = thunderBolts();
    const sparks = thunderSparks();
    expect(bolts).toHaveLength(3);
    expect(sparks).toHaveLength(2);
    for (const b of [...bolts, ...sparks]) { expect(b.left).toBeGreaterThanOrEqual(0); expect(b.left).toBeLessThanOrEqual(100); }
    expect(thunderBolts()).toEqual(thunderBolts());
    expect(thunderSparks()).toEqual(thunderSparks());
  });
});

describe("rainbowArcBands", () => {
  it("7バンド・色は相異・feetY 単調増加・両端まで架かる・決定的", () => {
    const bands = rainbowArcBands();
    expect(bands).toHaveLength(7);
    expect(new Set(bands.map((b) => b.color)).size).toBe(7);
    for (let i = 1; i < bands.length; i++) expect(bands[i].feetY).toBeGreaterThan(bands[i - 1].feetY);
    for (const b of bands) { expect(b.d).toContain("M 198"); expect(b.d).toContain(" 2 "); } // 右端→左端
    expect(rainbowArcBands()).toEqual(rainbowArcBands());
  });
});

describe("auraMotes", () => {
  it("12粒・中央から四方八方・半径3段でばらつく・決定的", () => {
    const ms = auraMotes();
    expect(ms).toHaveLength(12);
    expect(ms.some((m) => m.dx > 0)).toBe(true);
    expect(ms.some((m) => m.dx < 0)).toBe(true);
    expect(ms.some((m) => m.dy > 0)).toBe(true);
    expect(ms.some((m) => m.dy < 0)).toBe(true);
    const radii = new Set(ms.map((m) => Math.round(Math.hypot(m.dx, m.dy))));
    expect(radii.size).toBeGreaterThanOrEqual(3); // 半径のばらつき
    expect(auraMotes()).toEqual(auraMotes());
  });
});

describe("iceCrackTree", () => {
  it("四隅から t1×4→t2×8→t3×8→t4×4＋致命ヒビ5本・有限座標・決定的", () => {
    const segs = iceCrackTree(300, 110);
    const count = (t: string) => segs.filter((s) => s.tier === t).length;
    expect(count("t1")).toBe(4);
    expect(count("t2")).toBe(8);
    expect(count("t3")).toBe(8);
    expect(count("t4")).toBe(4);
    expect(segs.filter((s) => s.tier === "fa" || s.tier === "fb" || s.tier === "fc")).toHaveLength(5);
    for (const s of segs) { expect(Number.isFinite(s.leftPct)).toBe(true); expect(Number.isFinite(s.topPct)).toBe(true); }
    expect(iceCrackTree(300, 110)).toEqual(iceCrackTree(300, 110));
  });
  it("枠の実寸でスケールする（横長パネルと縦長で結果が変わる）", () => {
    expect(iceCrackTree(400, 80)).not.toEqual(iceCrackTree(200, 160));
  });
});
