// B-TC-136（unit）companiesQueryParams / companiesCsvUrl が DataTable の QueryState を
// §1.8.1 DataTable クエリ契約の URL パラメータへ正しく写像する（純関数・テスト規約 unit 層）。
// 正＝doc/API設計/README.md §1.8.1・backend GET /admin/companies のパラメータ名。
import { describe, expect, it } from "vitest";
import type { QueryState } from "@/components/ui";
import { companiesCsvUrl, companiesQueryParams } from "./api";

// 既定の QueryState（各テストで必要分だけ上書き）。
function state(overrides: Partial<QueryState> = {}): QueryState {
  return {
    search: "",
    sort: [],
    filters: {},
    page: 1,
    perPage: 20,
    pinIds: [],
    ...overrides,
  };
}

describe("companiesQueryParams（B-TC-136）", () => {
  it("空状態は page/per_page のみ（q/sort/filter は出さない）", () => {
    const qs = companiesQueryParams(state());
    expect(qs.get("page")).toBe("1");
    expect(qs.get("per_page")).toBe("20");
    expect(qs.get("q")).toBeNull();
    expect(qs.get("sort")).toBeNull();
    expect(qs.get("status")).toBeNull();
  });

  it("検索はトリムして q に載せる", () => {
    expect(companiesQueryParams(state({ search: "  acme  " })).get("q")).toBe("acme");
    expect(companiesQueryParams(state({ search: "   " })).get("q")).toBeNull();
  });

  it("複数ソートは左優先でカンマ連結・desc は - 前置", () => {
    const qs = companiesQueryParams(
      state({ sort: [{ key: "name", dir: "asc" }, { key: "account_count", dir: "desc" }] }),
    );
    expect(qs.get("sort")).toBe("name,-account_count");
  });

  it("ソート可能キーはホワイトリスト＝未対応キーは落とす（422回避）", () => {
    // db_identifier / status は backend 非ソート。name は許可。
    const qs = companiesQueryParams(
      state({
        sort: [
          { key: "db_identifier", dir: "asc" },
          { key: "status", dir: "desc" },
          { key: "name", dir: "desc" },
        ],
      }),
    );
    expect(qs.get("sort")).toBe("-name");
  });

  it("enum フィルタ（status）は多値をカンマ連結", () => {
    const qs = companiesQueryParams(
      state({ filters: { status: { type: "enum", key: "status", values: ["active", "suspended"] } } }),
    );
    expect(qs.get("status")).toBe("active,suspended");
  });

  it("number フィルタ（account_count）は _min/_max・null 側は省略", () => {
    const min = companiesQueryParams(
      state({ filters: { account_count: { type: "number", key: "account_count", min: 3, max: null } } }),
    );
    expect(min.get("account_count_min")).toBe("3");
    expect(min.get("account_count_max")).toBeNull();
    const both = companiesQueryParams(
      state({ filters: { account_count: { type: "number", key: "account_count", min: 1, max: 9 } } }),
    );
    expect(both.get("account_count_min")).toBe("1");
    expect(both.get("account_count_max")).toBe("9");
  });

  it("per_page は QueryState の値をそのまま転送する（例＝会社一覧の 5）", () => {
    expect(companiesQueryParams(state({ perPage: 5 })).get("per_page")).toBe("5");
  });

  it("pin_ids はカンマ連結・空は省略・上限 5 で切り詰め", () => {
    expect(companiesQueryParams(state({ pinIds: [] })).get("pin_ids")).toBeNull();
    expect(companiesQueryParams(state({ pinIds: ["a", "b"] })).get("pin_ids")).toBe("a,b");
    const six = companiesQueryParams(state({ pinIds: ["1", "2", "3", "4", "5", "6"] }));
    expect(six.get("pin_ids")).toBe("1,2,3,4,5");
  });
});

describe("companiesCsvUrl（B-TC-136）", () => {
  it("/api/v1 前置・format=csv・列はホワイトリストのみ・ページングは載せない", () => {
    const url = companiesCsvUrl(
      state({ search: "acme", perPage: 5 }),
      ["name", "status", "groups", "created", "_actions", "account_count"],
    );
    expect(url.startsWith("/api/v1/admin/companies?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("format")).toBe("csv");
    expect(qs.get("q")).toBe("acme");
    // 表示列のうち CSV 許可列のみ・並び順を保持（groups/created/_actions は除外）
    expect(qs.get("columns")).toBe("name,status,account_count");
    // CSV は全件＝ページングは送らない
    expect(qs.get("page")).toBeNull();
    expect(qs.get("per_page")).toBeNull();
  });
});
