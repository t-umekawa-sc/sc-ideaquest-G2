// N-TC-201: 情報一覧のクエリ組立（サーバー委譲・§1.8.1）。roots_only/status/ホワイトリストの検証。
// N-TC-204: 貼付画像の再ホスト（POST /info-items/images・multipart）＝FormData 送信・url 返却。
import { afterEach, describe, expect, it, vi } from "vitest";

import { addAttachmentsApi, infoListParams, uploadInfoImageApi } from "./api";
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

describe("uploadInfoImageApi（N-TC-204）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("画像 blob を multipart（FormData）で POST /info-items/images し url を返す", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ url: "https://minio.test/info-images/x.png?sig=1" }) } as Response;
    }));
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "p.png", { type: "image/png" });
    const url = await uploadInfoImageApi(file);
    expect(url).toBe("https://minio.test/info-images/x.png?sig=1");
    expect(calls[0].url).toBe("/api/v1/info-items/images");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    // multipart は Content-Type をブラウザに委ねる（boundary 自動付与）＝手で application/json を付けない。
    const headers = calls[0].init.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });
});

describe("addAttachmentsApi（N-TC-205）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("参考資料を multipart（複数 files）で POST /info-items/{id}/attachments し一覧を返す", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ attachments: [{ id: "a1", original_name: "r.pdf" }] }) } as Response;
    }));
    const files = [
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "r.pdf", { type: "application/pdf" }),
      new File([new Uint8Array([0x89, 0x50])], "p.png", { type: "image/png" }),
    ];
    const atts = await addAttachmentsApi("info-1", files);
    expect(atts).toHaveLength(1);
    expect(calls[0].url).toBe("/api/v1/info-items/info-1/attachments");
    expect(calls[0].init.method).toBe("POST");
    const body = calls[0].init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.getAll("files")).toHaveLength(2); // 複数ファイルを同一キー files で送る
  });
});
