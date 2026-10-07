// S-TC-213: 機能内モデルピッカーの初期選択ロジック（defaultModelKey・設計§9.2）。
import { describe, expect, it } from "vitest";

import { defaultModelKey } from "./types";
import type { AiModelItem } from "./types";

const m = (key: string, is_default = false): AiModelItem => ({
  key, provider: "openai_compat", external: false, billing: "free",
  label: key, description: "", is_default,
});

describe("defaultModelKey (S-TC-213)", () => {
  it("is_default のキーを初期選択にする", () => {
    expect(defaultModelKey([m("qwen3-light"), m("qwen3-swallow", true)])).toBe("qwen3-swallow");
  });
  it("既定フラグが無ければ先頭キー（候補1でも成立）", () => {
    expect(defaultModelKey([m("qwen3-light"), m("qwen3-swallow")])).toBe("qwen3-light");
    expect(defaultModelKey([m("only")])).toBe("only");
  });
  it("空配列は null", () => {
    expect(defaultModelKey([])).toBeNull();
  });
});
