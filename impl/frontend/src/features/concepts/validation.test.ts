// 実績（検証）入力のクライアント検証（デザイン標準 §4.7・SC-61 §4.4）。
// 受入不具合（2026-09-27）＝手法/実施日が入力済みでも「手法・実施日・規模は必須」とまとめて表示され、
// どこが足りないか分からなかった。回帰＝欠落項目だけを FieldErrors に返すことを固定（P-TC-259）。
import { describe, expect, it } from "vitest";

import { validateValidationInput } from "./validation";

describe("validateValidationInput（P-TC-259・§4.7 フィールド単位検証）", () => {
  it("規模だけ空なら scale だけがエラー（手法・実施日はエラーにしない）", () => {
    const e = validateValidationInput({ method: "問合せ内容解析", validatedOn: "2026-09-27", scale: "" });
    expect(Object.keys(e)).toEqual(["scale"]);
    expect(e.method).toBeUndefined();
    expect(e.validatedOn).toBeUndefined();
  });

  it("全項目入力済みならエラー無し", () => {
    const e = validateValidationInput({ method: "問合せ内容解析", validatedOn: "2026-09-27", scale: "n=20" });
    expect(Object.keys(e)).toHaveLength(0);
  });

  it("全欠落なら3項目ともエラー（前後空白のみも欠落扱い）", () => {
    const e = validateValidationInput({ method: "  ", validatedOn: "", scale: "  " });
    expect(Object.keys(e).sort()).toEqual(["method", "scale", "validatedOn"]);
  });
});
