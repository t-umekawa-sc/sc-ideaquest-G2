// E-TC-211（unit）renderTextHtml のメンション強調＝members の nospace（display_name の空白除去トークン）に
//   一致した @token だけを .mention 化する。空白入り「@テスト 太郎」を full name として強調しない
//   ＝受入不具合 DFT-E-001（メンションが素テキスト表示）の再発防止。描画側と composer（extractMentionIds）の
//   nospace トークン契約を固定する。HTML エスケープ（XSS 無害化）も併せて確認。
// E-TC-212（unit）resolveMagic＝魔法リアクションはゲーム層の演出＝gameEnabled=false（game_mode OFF）で null＝
//   表示しない（§4.11）。true では保持・魔法なしは null。受入不具合 DFT-E-002（OFF でも既存魔法が描画/発動）の再発防止。
// 正＝doc/テスト/E_チャット.md・doc/API設計/E_チャット・リアクション・魔法発動.md・デザイン標準 §4.11。
// E-TC-229（unit）renderTextHtml の全員メンション強調＝`@全員`/`@all`（大小無視）を .mention 化する（members に
//   居なくても all-token は特別扱い）。決定 2026-09-29・宛先が明確な一括通知の気づきを高める（FR-24／E.6）。
// E-TC-230（unit）resolveMentionIds の全員展開＝`@全員`/`@all` を全メンバーの user_id へ展開・個別と併記でも重複排除。
import { describe, expect, it } from "vitest";
import { renderTextHtml, resolveMagic, resolveMentionIds, type Member } from "./render";

const members: Member[] = [{ user_id: "u1", name: "テスト 太郎", nospace: "テスト太郎" }];
const party: Member[] = [
  { user_id: "u1", name: "テスト 太郎", nospace: "テスト太郎" },
  { user_id: "u2", name: "花子", nospace: "花子" },
];

describe("E-TC-211 renderTextHtml メンション強調", () => {
  it("nospace トークンに一致する @token を .mention 化する", () => {
    expect(renderTextHtml("@テスト太郎 おはよう", members)).toContain('<span class="mention">@テスト太郎</span>');
  });
  it("空白入り「@テスト 太郎」は full name として強調しない（素テキストのまま）", () => {
    const html = renderTextHtml("@テスト 太郎 です", members);
    expect(html).not.toContain('class="mention">@テスト太郎');
    // 「@テスト」は member（nospace=テスト太郎）に一致しないので強調ゼロ。
    expect(html).not.toContain('<span class="mention">');
  });
  it("メンバー不在の @token は強調しない", () => {
    expect(renderTextHtml("@unknown こんにちは", members)).not.toContain('class="mention"');
  });
  it("HTML をエスケープする（XSS 無害化）", () => {
    const html = renderTextHtml("<script>alert(1)</script>", members);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("E-TC-229 renderTextHtml 全員メンション強調", () => {
  it("@全員 を .mention 化する（members に居なくても）", () => {
    expect(renderTextHtml("@全員 集合", members)).toContain('<span class="mention">@全員</span>');
  });
  it("@all / @ALL（大小無視）を .mention 化しトークン原文を保持する", () => {
    expect(renderTextHtml("@all hi", members)).toContain('<span class="mention">@all</span>');
    expect(renderTextHtml("@ALL hey", members)).toContain('<span class="mention">@ALL</span>');
  });
});

describe("E-TC-230 resolveMentionIds 全員展開", () => {
  it("@全員 / @all を全メンバーの user_id へ展開する", () => {
    expect(resolveMentionIds("@全員 …", party)).toEqual(["u1", "u2"]);
    expect(resolveMentionIds("@all …", party)).toEqual(["u1", "u2"]);
  });
  it("個別メンションと @全員 併記でも重複排除する", () => {
    expect(resolveMentionIds("@テスト太郎 @全員 …", party)).toEqual(["u1", "u2"]);
  });
  it("member 不在の素 @token は無視する", () => {
    expect(resolveMentionIds("@unknown …", party)).toEqual([]);
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
