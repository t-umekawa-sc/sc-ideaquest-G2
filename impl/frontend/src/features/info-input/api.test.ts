// N-TC-201: 情報一覧のクエリ組立（サーバー委譲・§1.8.1）。roots_only/status/ホワイトリストの検証。
import { describe, expect, it } from "vitest";

import { infoListParams } from "./api";
import type { QueryState } from "@/components/ui";

function state(over: Partial<QueryState> = {}): QueryState {
  return { search: "", sort: [], filters: {}, page: 1, perPage: 10, pinIds: [], ...over };
}

describe("infoListParams（N-TC-201）", () => {
  it("roots_only と status（タブ）をクエリに載せる", () => {
    const qs = infoListParams(state(), { status: "raw", rootsOnly: true });
    expect(qs.get("roots_only")).toBe("true");
    expect(qs.get("status")).toBe("raw");
    expect(qs.get("page")).toBe("1");
    expect(qs.get("per_page")).toBe("10");
  });

  it("status=all は status パラメータを載せない（archived 除外＝backend 既定）", () => {
    const qs = infoListParams(state(), { status: "all" });
    expect(qs.has("status")).toBe(false);
    expect(qs.has("roots_only")).toBe(false);
  });

  it("sort はホワイトリストのみ（未知キーは落とす・desc は - 前置）", () => {
    const qs = infoListParams(state({ sort: [
      { key: "created_at", dir: "desc" }, { key: "bogus", dir: "asc" },
    ] as QueryState["sort"] }));
    expect(qs.get("sort")).toBe("-created_at");
  });

  it("enum 列フィルタは backend が受けるキーのみ（status 列は載せない＝タブが担う）", () => {
    const qs = infoListParams(state({ filters: {
      priority: { type: "enum", values: ["high"] },
      status: { type: "enum", values: ["curated"] },
    } as QueryState["filters"] }));
    expect(qs.get("priority")).toBe("high");
    expect(qs.has("status")).toBe(false); // status 列フィルタは無視（状態タブが status を担当）
  });

  it("横断検索はサーバー q（全文）へ", () => {
    const qs = infoListParams(state({ search: "  半導体 " }));
    expect(qs.get("q")).toBe("半導体");
  });
});
