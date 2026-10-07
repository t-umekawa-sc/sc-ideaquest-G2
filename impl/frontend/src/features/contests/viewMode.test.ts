import { describe, expect, it } from "vitest";

import { contestViewFlags, contestViewMode } from "./viewMode";

// T-TC-206: 閲覧モード判定（参加者/非参加運営/非参加一般・承認制のみガード）。
describe("contestViewMode (T-TC-206)", () => {
  it("参加者（approved）は participant", () => {
    expect(contestViewMode({ can_manage: false, my_status: "approved", auto_approve: false })).toBe("participant");
    expect(contestViewMode({ can_manage: true, my_status: "approved", auto_approve: false })).toBe("participant"); // 運営でも参加なら全表示
  });
  it("承認制(auto_approve=false)×非参加の運営は manager-guard", () => {
    expect(contestViewMode({ can_manage: true, my_status: "none", auto_approve: false })).toBe("manager-guard");
    expect(contestViewMode({ can_manage: true, my_status: "requested", auto_approve: false })).toBe("manager-guard");
    expect(contestViewMode({ can_manage: true, my_status: "left", auto_approve: false })).toBe("manager-guard");
  });
  it("auto_approve=true（会社全体に公開）×非参加の運営は participant＝従来どおり全表示", () => {
    // 公開コンテストは誰でも閲覧可＝運営を隠す privacy 理由が無い（一般 invite が表彰台を見えるのと逆転させない）。
    expect(contestViewMode({ can_manage: true, my_status: "none", auto_approve: true })).toBe("participant");
  });
  it("非参加の一般（非can_manage×非approved）は invite", () => {
    expect(contestViewMode({ can_manage: false, my_status: "none", auto_approve: true })).toBe("invite");
    expect(contestViewMode({ can_manage: false, my_status: "requested", auto_approve: false })).toBe("invite");
  });
  it("my_status 未設定は none 扱い", () => {
    expect(contestViewMode({ can_manage: true, auto_approve: false })).toBe("manager-guard");
    expect(contestViewMode({ can_manage: false, auto_approve: false })).toBe("invite");
  });
});

// T-TC-207: モード別表示フラグ（DRY の単一ソース）。
describe("contestViewFlags (T-TC-207)", () => {
  it("participant＝全表示（現状不変）", () => {
    expect(contestViewFlags({ can_manage: false, my_status: "approved", auto_approve: false })).toEqual({
      showTabs: true, showIdentifying: true, guardContent: false, fetchContent: true,
    });
  });
  it("manager-guard（承認制×非参加運営）＝パネル秘匿+タブ中身ガード+識別データ非取得", () => {
    expect(contestViewFlags({ can_manage: true, my_status: "none", auto_approve: false })).toEqual({
      showTabs: true, showIdentifying: false, guardContent: true, fetchContent: false,
    });
  });
  it("invite＝一般は現状不変（タブ非表示だがパネル/取得は従来どおり）", () => {
    expect(contestViewFlags({ can_manage: false, my_status: "none", auto_approve: true })).toEqual({
      showTabs: false, showIdentifying: true, guardContent: false, fetchContent: true,
    });
  });
});
