// 全文検索スニペットの許可リストサニタイズ（J.5・§2.2④）。純ロジック（node で単体テスト可）。
//
// PGroonga は `pgroonga_snippet_html` でユーザー文を HTML エスケープし、ハイライトだけ
// `<span class="keyword">…</span>`（生タグ）で注入する。フロントは **dangerouslySetInnerHTML を使わず**、
// keyword span だけを hit セグメントに、それ以外はエンティティをデコードした**テキスト**として分解する。
// React が children として描画すれば、エスケープ済みユーザー文は文字として表示され、生きたタグは残らない
// （＝許可リスト＝keyword ハイライトのみ）。設計 J.5 の「構造化セグメント（[{text, hit}]）を返す」オプション。

const _ENT: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(?:lt|gt|amp|quot|#39);/g, (m) => _ENT[m] ?? m);
}

export type SnippetSegment = { text: string; hit: boolean };

const _KEYWORD_SPLIT = /(<span class="keyword">[\s\S]*?<\/span>)/g;
const _KEYWORD_ONE = /^<span class="keyword">([\s\S]*?)<\/span>$/;

/** スニペット HTML を {text, hit} セグメント列へ分解（keyword span のみ hit・他はテキスト化）。 */
export function parseSnippet(html: string): SnippetSegment[] {
  return (html || "")
    .split(_KEYWORD_SPLIT)
    .filter((part) => part !== "")
    .map((part) => {
      const m = part.match(_KEYWORD_ONE);
      return m ? { text: decodeEntities(m[1]), hit: true } : { text: decodeEntities(part), hit: false };
    });
}
