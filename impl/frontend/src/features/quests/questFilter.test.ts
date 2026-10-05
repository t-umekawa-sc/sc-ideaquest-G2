// C-TC-306(unit): SC-10 絞り込みスイッチの関係判定（questRelation / matchQuestFilter）。
import { describe, expect, it } from "vitest";

import { matchQuestFilter, questRelation } from "./questFilter";

describe("C-TC-306 questRelation（my_state/is_owner → 関係）", () => {
  it("draft は常に draft（is_owner 問わず）", () => {
    expect(questRelation("draft", true)).toBe("draft");
    expect(questRelation("draft", false)).toBe("draft");
  });
  it("is_owner または my_state=owner は owner", () => {
    expect(questRelation("member", true)).toBe("owner");
    expect(questRelation("owner", false)).toBe("owner");
  });
  it("pending / following はそのまま", () => {
    expect(questRelation("pending", false)).toBe("pending");
    expect(questRelation("following", false)).toBe("following");
  });
  it("その他（member/none/未知）は member", () => {
    expect(questRelation("member", false)).toBe("member");
    expect(questRelation("none", false)).toBe("member");
    expect(questRelation(null, false)).toBe("member");
  });
});

describe("C-TC-306 matchQuestFilter（スイッチ一致）", () => {
  it("all は全関係で真", () => {
    for (const r of ["owner", "member", "draft", "pending", "following"] as const) {
      expect(matchQuestFilter(r, "all")).toBe(true);
    }
  });
  it("owner は owner と draft（自作＝下書き含む）", () => {
    expect(matchQuestFilter("owner", "owner")).toBe(true);
    expect(matchQuestFilter("draft", "owner")).toBe(true);
    expect(matchQuestFilter("member", "owner")).toBe(false);
    expect(matchQuestFilter("pending", "owner")).toBe(false);
  });
  it("member/pending/following は関係一致のみ", () => {
    expect(matchQuestFilter("member", "member")).toBe(true);
    expect(matchQuestFilter("draft", "member")).toBe(false);
    expect(matchQuestFilter("pending", "pending")).toBe(true);
    expect(matchQuestFilter("following", "following")).toBe(true);
    expect(matchQuestFilter("owner", "member")).toBe(false);
  });
});
