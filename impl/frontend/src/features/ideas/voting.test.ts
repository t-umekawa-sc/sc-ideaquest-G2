// 投票可否の事前判定（vitest・node）＝サーバー _guard_votable と一致（D.5・D-TC-219）。
// 設計＝doc/API設計/D_アイデア・添付・版・投票・フォロー.md D.5（締切後は 409）・SC-22。
import { describe, expect, it } from "vitest";

import { isVotingClosed, todayISODate, votePercents } from "./voting";

const TODAY = "2026-08-27";

describe("isVotingClosed（D.5 事前無効化＝サーバー _guard_votable と一致）", () => {
  it("recruiting・締切前（未来）は投票可", () => {
    expect(isVotingClosed({ status: "recruiting", deadline: "2026-09-30" }, TODAY)).toEqual({ closed: false, reason: null });
  });
  it("締切当日は投票可（サーバーは deadline < today で締切＝当日は含まない）", () => {
    expect(isVotingClosed({ status: "recruiting", deadline: TODAY }, TODAY)).toEqual({ closed: false, reason: null });
  });
  it("締切翌日以降は投票不可（reason=deadline）", () => {
    expect(isVotingClosed({ status: "recruiting", deadline: "2026-08-26" }, TODAY)).toEqual({ closed: true, reason: "deadline" });
  });
  it("completed は締切前でも投票不可（reason=completed が優先）", () => {
    expect(isVotingClosed({ status: "completed", deadline: "2026-09-30" }, TODAY)).toEqual({ closed: true, reason: "completed" });
  });
  it("deadline 未設定（null/undefined）は締切による無効化なし", () => {
    expect(isVotingClosed({ status: "recruiting", deadline: null }, TODAY)).toEqual({ closed: false, reason: null });
    expect(isVotingClosed({ status: "recruiting" }, TODAY)).toEqual({ closed: false, reason: null });
  });
});

describe("todayISODate", () => {
  it("Date を YYYY-MM-DD で返す", () => {
    expect(todayISODate(new Date("2026-08-27T09:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("votePercents（D-TC-220・#23 賛否バーの比率）", () => {
  it("合計0は両0（total 0）", () => {
    expect(votePercents(0, 0)).toEqual({ approve: 0, oppose: 0, total: 0 });
  });
  it("approve%=round(a/total*100)・oppose%=100-approve%（合計常に100）", () => {
    expect(votePercents(3, 1)).toEqual({ approve: 75, oppose: 25, total: 4 });
    expect(votePercents(1, 1)).toEqual({ approve: 50, oppose: 50, total: 2 });
    expect(votePercents(1, 2)).toEqual({ approve: 33, oppose: 67, total: 3 });
    expect(votePercents(2, 1)).toEqual({ approve: 67, oppose: 33, total: 3 });
    expect(votePercents(5, 0)).toEqual({ approve: 100, oppose: 0, total: 5 });
  });
  it("負値・NaN は 0 クランプ・小数は floor", () => {
    expect(votePercents(-3, 1)).toEqual({ approve: 0, oppose: 100, total: 1 });
    expect(votePercents(Number.NaN, 2)).toEqual({ approve: 0, oppose: 100, total: 2 });
    expect(votePercents(2.9, 1.9)).toEqual({ approve: 67, oppose: 33, total: 3 });
  });
});
