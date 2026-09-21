// B-TC-177（unit）＝複製プリフィルの memberships を入力スキーマ（group_id/role のみ）へ絞る回帰テスト。
// 背景＝一覧応答の memberships は MembershipView（group_id/role/**name**）。これをそのまま複製 dup に載せて
// 発行 API へ送ると MembershipInput（`extra="forbid"`）が `name` を弾いて 422 になる（受入で再現）。
import { describe, expect, it } from "vitest";

import { toMembershipInputs } from "./memberships";

describe("toMembershipInputs（B-TC-177）", () => {
  it("name 等の余分キーを落として {group_id, role} のみにする", () => {
    const listLike = [
      { group_id: "g1", role: "admin", name: "開発部・開発部1課" },
      { group_id: "g2", role: "member", name: "営業部" },
    ] as unknown as Parameters<typeof toMembershipInputs>[0];
    const out = toMembershipInputs(listLike);
    expect(out).toEqual([
      { group_id: "g1", role: "admin" },
      { group_id: "g2", role: "member" },
    ]);
    // 余分キー（name）が残っていない＝発行スキーマ extra=forbid で 422 にならない。
    for (const m of out) expect(Object.keys(m).sort()).toEqual(["group_id", "role"]);
  });

  it("role は member|admin に正規化（未指定/不明→member）", () => {
    const out = toMembershipInputs([
      { group_id: "g1" },
      { group_id: "g2", role: null },
      { group_id: "g3", role: "owner" }, // 想定外は member へ倒す（admin だけ昇格）
      { group_id: "g4", role: "admin" },
    ]);
    expect(out.map((m) => m.role)).toEqual(["member", "member", "member", "admin"]);
  });

  it("null/undefined/空は空配列", () => {
    expect(toMembershipInputs(null)).toEqual([]);
    expect(toMembershipInputs(undefined)).toEqual([]);
    expect(toMembershipInputs([])).toEqual([]);
  });
});
