// G-TC-150: 実績アンロック祝福の発火判定（純ロジック・SC-40）。視覚はブラウザ受入（GF-AC）。
import { describe, expect, it } from "vitest";

import { nextStoredCodes, parseSeenCodes, shouldCelebrateUnlock } from "./celebrate";

describe("shouldCelebrateUnlock (G-TC-150)", () => {
  it("初回観測(null)は祝福しない（記録のみ・誤発火防止）", () => {
    expect(shouldCelebrateUnlock(null, ["a", "b"])).toEqual([]);
  });
  it("新規解放分だけを current の順で返す", () => {
    expect(shouldCelebrateUnlock(["a"], ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(shouldCelebrateUnlock(["b"], ["a", "b"])).toEqual(["a"]);
  });
  it("既知のみ・現在が空は祝福しない", () => {
    expect(shouldCelebrateUnlock(["a", "b"], ["a", "b"])).toEqual([]);
    expect(shouldCelebrateUnlock(["a"], [])).toEqual([]);
  });
});

describe("nextStoredCodes (G-TC-150)", () => {
  it("初回は current をそのまま記録", () => {
    expect(nextStoredCodes(null, ["a", "b"])).toEqual(["a", "b"]);
  });
  it("prev∪current を重複除去（実績は失われない＝減らさない）", () => {
    expect(nextStoredCodes(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(nextStoredCodes(["a", "b"], ["a"])).toEqual(["a", "b"]);
  });
});

describe("parseSeenCodes (G-TC-150)", () => {
  it("未記録/非配列/壊れ JSON は null（初回扱い）", () => {
    expect(parseSeenCodes(null)).toBeNull();
    expect(parseSeenCodes("{}")).toBeNull();
    expect(parseSeenCodes("not json")).toBeNull();
  });
  it("文字列配列を読み取り・文字列以外は除外", () => {
    expect(parseSeenCodes('["a","b"]')).toEqual(["a", "b"]);
    expect(parseSeenCodes('["a",1,null,"b"]')).toEqual(["a", "b"]);
    expect(parseSeenCodes("[]")).toEqual([]);
  });
});
