// SEC-TC-013（unit）全文検索スニペットの許可リストサニタイズ（J.5・§2.2④）＝純ロジックの単体検証。
// keyword ハイライトのみ hit・ユーザー文（エスケープ済み）はテキストへデコード＝dangerouslySetInnerHTML 不要で
// 原理的に安全であることを担保する（doc/テスト/セキュリティ横断.md SEC-TC-013）。
import { describe, expect, it } from "vitest";

import { decodeEntities, parseSnippet } from "./snippet";

describe("parseSnippet（許可リストサニタイズ）", () => {
  it("keyword span だけを hit セグメントに、他はテキストにする", () => {
    const segs = parseSnippet('本文a<span class="keyword">語</span>本文b');
    expect(segs).toEqual([
      { text: "本文a", hit: false },
      { text: "語", hit: true },
      { text: "本文b", hit: false },
    ]);
  });

  it("ユーザー文中の <script> はエスケープ済み（&lt;）＝デコードしてテキスト化・hit にならない", () => {
    // PGroonga はユーザー文を &lt; 等へエスケープし、keyword だけ生 span で注入する。
    const html = '&lt;script&gt;alert(1)&lt;/script&gt; <span class="keyword">検索語</span>';
    const segs = parseSnippet(html);
    // 危険断片はテキストセグメント（hit=false）＝React は文字として描画（タグとして評価しない）。
    expect(segs.some((s) => !s.hit && s.text.includes("<script>alert(1)</script>"))).toBe(true);
    // hit=true は keyword のみ（＝許可リスト）。
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["検索語"]);
  });

  it("keyword span 内のエスケープ済みタグもテキストとしてデコード（生タグは残さない）", () => {
    const segs = parseSnippet('<span class="keyword">&lt;img src=x onerror=alert(1)&gt;</span>');
    expect(segs).toEqual([{ text: "<img src=x onerror=alert(1)>", hit: true }]);
  });

  it("keyword 以外の span（不正 class）は hit にしない＝テキスト扱い", () => {
    const segs = parseSnippet('<span class="evil">x</span>');
    expect(segs.every((s) => !s.hit)).toBe(true);
  });

  it("空入力は空配列", () => {
    expect(parseSnippet("")).toEqual([]);
  });

  it("decodeEntities は既知エンティティのみ復号", () => {
    expect(decodeEntities("&lt;a&gt;&amp;&quot;&#39;")).toBe("<a>&\"'");
  });
});
