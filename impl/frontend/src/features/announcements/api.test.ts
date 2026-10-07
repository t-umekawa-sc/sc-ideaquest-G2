// U-TC-112: 本文貼付画像の再ホスト（POST /admin/announcements/images・multipart）＝FormData 送信・url 返却。
import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadAnnouncementImageApi } from "./api";

describe("uploadAnnouncementImageApi（U-TC-112）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("画像 blob を multipart（FormData）で POST /admin/announcements/images し url を返す", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ url: "https://minio.test/announcement-images/x.png?sig=1" }) } as Response;
    }));
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "p.png", { type: "image/png" });
    const url = await uploadAnnouncementImageApi(file);
    expect(url).toBe("https://minio.test/announcement-images/x.png?sig=1");
    expect(calls[0].url).toBe("/api/v1/admin/announcements/images");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    // multipart は Content-Type をブラウザに委ねる（boundary 自動付与）＝手で application/json を付けない。
    const headers = calls[0].init.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });
});
