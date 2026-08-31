// avatar 純ロジックの単体（vitest・node 環境）＝ベース値の正規化＋WebGL/motion のSSRガード。
// 3Dビューア本体（R3F/Canvas）は DOM/WebGL 依存＝単体対象外（e2e/手動確認）。設計＝SC-31 §9.2/§9.3。
import { describe, expect, it } from "vitest";

import { toAvatarBase } from "./base";
import { mascotFollowEffective } from "./follow";
import { prefersReducedMotion, supportsWebGL } from "./webgl";

describe("toAvatarBase（GET /me の profile.avatar_base を安全に正規化）", () => {
  it("既知値はそのまま", () => {
    expect(toAvatarBase("male")).toBe("male");
    expect(toAvatarBase("female")).toBe("female");
  });
  it("未設定・不明値は既定 male（§5.3）", () => {
    expect(toAvatarBase(undefined)).toBe("male");
    expect(toAvatarBase(null)).toBe("male");
    expect(toAvatarBase("")).toBe("male");
    expect(toAvatarBase("animal_dog")).toBe("male"); // 将来 enum 追加前の未知値も安全に丸める
  });
});

describe("mascotFollowEffective（K-TC-023・追従アニメの実効表示＝抑制優先）", () => {
  it("抑制でなく follow=true のときだけ表示", () => {
    expect(mascotFollowEffective(false, true)).toBe(true);
  });
  it("抑制中（OS reduce OR reduce_motion）は follow=true でも非表示", () => {
    expect(mascotFollowEffective(true, true)).toBe(false);
  });
  it("follow=false は常に非表示（抑制の有無に関わらず）", () => {
    expect(mascotFollowEffective(false, false)).toBe(false);
    expect(mascotFollowEffective(true, false)).toBe(false);
  });
});

describe("WebGL/motion ガード（SSR・node 環境では false＝2D フォールバック側へ）", () => {
  it("document/window 不在（node）では supportsWebGL は false", () => {
    expect(supportsWebGL()).toBe(false);
  });
  it("matchMedia 不在では prefersReducedMotion は false（演出あり側の安全既定）", () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
