// E-TC-230（unit）resolveMentionIds＝PM-JSON の mention ノードを走査して宛先 user_id 群へ展開（送信用）。
//   番兵 `__all__`（全員）は全メンバーへ展開、個別ノードは attrs.id をそのまま、個別と全員の併記でも重複排除。
//   TT5（2026-10-09）＝plain `@token` 正規表現抽出から PM-JSON ノード走査へ移行（旧 E-TC-211/229 の
//   クライアント強調 renderTextHtml は廃止＝表示はサーバ body_html／W_リッチテキスト W-TC-006）。
// W-TC（pmText）＝PM-JSON の平文化（空判定/引用チップ用）。mention は `@label` としてテキスト化。
// E-TC-212（unit）resolveMagic＝魔法リアクションはゲーム層の演出＝gameEnabled=false（game_mode OFF）で null＝
//   表示しない（§4.11）。true では保持・魔法なしは null。受入不具合 DFT-E-002 の再発防止。
// 正＝doc/テスト/E_チャット.md・doc/API設計/E_チャット・リアクション・魔法発動.md・デザイン標準 §4.11。
import { describe, expect, it } from "vitest";
import { ALL_MENTION_ID, pmText, resolveMagic, resolveMentionIds, type Member } from "./render";

const party: Member[] = [
  { user_id: "u1", name: "テスト 太郎" },
  { user_id: "u2", name: "花子" },
];

// PM-JSON doc を組み立てる小ヘルパ（段落にテキスト/メンションノードを並べる）。
function doc(...nodes: Array<Record<string, unknown>>) {
  return { type: "doc", content: [{ type: "paragraph", content: nodes }] };
}
const text = (t: string) => ({ type: "text", text: t });
const mention = (id: string, label = "") => ({ type: "mention", attrs: { id, label } });

describe("E-TC-230 resolveMentionIds（PM-JSON ノード走査・全員展開）", () => {
  it("番兵 __all__（全員）を全メンバーの user_id へ展開する", () => {
    expect(resolveMentionIds(doc(mention(ALL_MENTION_ID, "全員"), text(" 集合")), party)).toEqual(["u1", "u2"]);
  });
  it("個別メンションと __all__ 併記でも重複排除する", () => {
    expect(resolveMentionIds(doc(mention("u1", "太郎"), text(" "), mention(ALL_MENTION_ID, "全員")), party)).toEqual(["u1", "u2"]);
  });
  it("個別メンションのみは attrs.id をそのまま返す", () => {
    expect(resolveMentionIds(doc(mention("u1", "太郎"), text(" やあ")), party)).toEqual(["u1"]);
  });
  it("mention ノードが無ければ空（プレーン本文）", () => {
    expect(resolveMentionIds(doc(text("メンション無し")), party)).toEqual([]);
  });
});

describe("pmText（PM-JSON 平文化）", () => {
  it("テキストと mention（@label）を連結し空白正規化する", () => {
    expect(pmText(doc(text("やあ "), mention("u1", "太郎")))).toBe("やあ @太郎");
  });
  it("空 doc は空文字（空判定に使える）", () => {
    expect(pmText({ type: "doc", content: [{ type: "paragraph", content: [] }] })).toBe("");
    expect(pmText(null)).toBe("");
  });
});

describe("E-TC-212 resolveMagic ゲーム層ガード", () => {
  const reactions = { magic: { spell_id: "s1", effect: "fire", icon: "🔥", mine: true } };
  it("gameEnabled=false は魔法を null 化する（OFF で表示しない）", () => {
    expect(resolveMagic(reactions, false)).toBeNull();
  });
  it("gameEnabled=true は魔法を保持する", () => {
    expect(resolveMagic(reactions, true)).toEqual(reactions.magic);
  });
  it("魔法が無ければ null（reactions が空/未定義でも安全）", () => {
    expect(resolveMagic({}, true)).toBeNull();
    expect(resolveMagic(null, true)).toBeNull();
    expect(resolveMagic(undefined, true)).toBeNull();
  });
});
