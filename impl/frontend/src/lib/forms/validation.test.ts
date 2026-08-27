// mapServerErrors の写像（vitest・node）＝ApiError.code → サマリ文言。edit_conflict の実行可能文言を固定（D.2）。
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";

import { mapServerErrors } from "./validation";

describe("mapServerErrors（RFC7807 code → サマリ）", () => {
  it("edit_conflict＝最新再取得を促す実行可能メッセージ（並行編集の後着・D.2）", () => {
    const { fieldErrors, summary } = mapServerErrors(new ApiError(409, "edit_conflict", null), "ja");
    expect(Object.keys(fieldErrors)).toHaveLength(0);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain("再読み込み"); // 「他の編集と競合…ページを再読み込み…」
  });

  it("conflict（汎用）と edit_conflict は別文言", () => {
    const editMsg = mapServerErrors(new ApiError(409, "edit_conflict", null), "ja").summary[0];
    const genericMsg = mapServerErrors(new ApiError(409, "conflict", null), "ja").summary[0];
    expect(editMsg).not.toBe(genericMsg);
  });

  it("validation_error＝errors[].field をフィールド別に写像", () => {
    const err = new ApiError(422, "validation_error", { errors: [{ field: "title" }] });
    const { fieldErrors } = mapServerErrors(err, "ja", { title: "件名は必須です。" });
    expect(fieldErrors.title).toBe("件名は必須です。");
  });
});
