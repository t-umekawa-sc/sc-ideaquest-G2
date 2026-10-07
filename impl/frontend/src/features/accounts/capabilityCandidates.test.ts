import { describe, expect, it } from "vitest";

import { filterCapabilityCandidates, type CandidateAccount } from "./capabilityCandidates";

const A = (over: Partial<CandidateAccount>): CandidateAccount => ({
  account_id: "a1", display_name: "山田 太郎", login_id: "yamada@acme", status: "active",
  memberships: [], ...over,
});

// T-TC-209: 能力付与候補の絞り込み（有効/未付与/氏名ログインID検索/クエストグループ所属）。
describe("filterCapabilityCandidates (T-TC-209)", () => {
  const base = [
    A({ account_id: "a1", display_name: "山田 太郎", login_id: "yamada@acme", memberships: [{ group_id: "g1" }] }),
    A({ account_id: "a2", display_name: "鈴木 花子", login_id: "suzuki@acme", memberships: [{ group_id: "g2" }] }),
    A({ account_id: "a3", display_name: "無効 次郎", login_id: "jiro@acme", status: "disabled", memberships: [{ group_id: "g1" }] }),
    A({ account_id: "a4", display_name: "所属なし 子", login_id: "none@acme", memberships: [] }),
  ];
  const empty = { holderIds: new Set<string>(), q: "", groupId: "" };

  it("既定＝active のみ（無効は除外）", () => {
    const r = filterCapabilityCandidates(base, empty);
    expect(r.map((a) => a.account_id)).toEqual(["a1", "a2", "a4"]);
  });
  it("付与済み(holderIds)は候補から外れる", () => {
    const r = filterCapabilityCandidates(base, { ...empty, holderIds: new Set(["a1"]) });
    expect(r.map((a) => a.account_id)).toEqual(["a2", "a4"]);
  });
  it("氏名/ログインID の部分一致（大小無視）", () => {
    expect(filterCapabilityCandidates(base, { ...empty, q: "鈴木" }).map((a) => a.account_id)).toEqual(["a2"]);
    expect(filterCapabilityCandidates(base, { ...empty, q: "YAMADA" }).map((a) => a.account_id)).toEqual(["a1"]);
  });
  it("クエストグループで絞り込む（所属なしは除外）", () => {
    expect(filterCapabilityCandidates(base, { ...empty, groupId: "g1" }).map((a) => a.account_id)).toEqual(["a1"]);
    expect(filterCapabilityCandidates(base, { ...empty, groupId: "g2" }).map((a) => a.account_id)).toEqual(["a2"]);
  });
  it("検索とグループは AND で効く", () => {
    expect(filterCapabilityCandidates(base, { ...empty, q: "山田", groupId: "g2" })).toEqual([]);
    expect(filterCapabilityCandidates(base, { ...empty, q: "山田", groupId: "g1" }).map((a) => a.account_id)).toEqual(["a1"]);
  });
});
