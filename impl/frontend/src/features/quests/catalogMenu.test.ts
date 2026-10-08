// C-TC-319（unit）SC-13 行メニュー選定＝管理者おすすめトグルが my_state に関わらず出ることを検証。
// DFT 再発防止＝member/owner（参加中）クエストで⋮メニューにおすすめトグルが出ず、自作クエストを
// おすすめにできなかった不具合の回帰テスト。正＝API設計 C.9.1。
import { describe, expect, it } from "vitest";

import { catalogRowMenuKeys } from "./catalogMenu";

const STATES = ["member", "none", "following", "pending", "rejected"] as const;

describe("SC-13 行メニュー選定 catalogRowMenuKeys（C-TC-319 unit）", () => {
  it("管理者は全 my_state で recommend を含む（member/owner でも出す）", () => {
    for (const st of STATES) {
      expect(catalogRowMenuKeys({ my_state: st }, true)).toContain("recommend");
    }
  });

  it("非管理者はどの my_state でも recommend を含まない", () => {
    for (const st of STATES) {
      expect(catalogRowMenuKeys({ my_state: st }, false)).not.toContain("recommend");
    }
  });

  it("member は detail/goto（＋管理者なら recommend）", () => {
    expect(catalogRowMenuKeys({ my_state: "member" }, false)).toEqual(["detail", "goto"]);
    expect(catalogRowMenuKeys({ my_state: "member" }, true)).toEqual(["detail", "goto", "recommend"]);
  });

  it("none は follow＋request、following は unfollow＋request、pending は withdraw、rejected は follow のみ（従来どおり）", () => {
    expect(catalogRowMenuKeys({ my_state: "none" }, false)).toEqual(["detail", "follow", "request"]);
    expect(catalogRowMenuKeys({ my_state: "following" }, false)).toEqual(["detail", "unfollow", "request"]);
    expect(catalogRowMenuKeys({ my_state: "pending" }, false)).toEqual(["detail", "follow", "withdraw"]);
    expect(catalogRowMenuKeys({ my_state: "rejected" }, false)).toEqual(["detail", "follow"]);
  });
});
