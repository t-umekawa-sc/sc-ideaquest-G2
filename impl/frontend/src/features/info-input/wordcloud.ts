// ワードクラウド/要約の派生（デモ）。実装＝janome トークン化（§12-2）＋抽出型 summarize_text（§12-3）。
// フロントのデモ用ロジック（本番はサーバー算出＝info_tokens / summary）。

const STOP = new Set(["の", "に", "は", "を", "が", "と", "で", "も", "や", "へ", "から", "まで", "する", "なる", "ある", "いる", "こと", "ため", "よう", "これ", "それ", "など"]);

export function simpleTokens(text: string, limit = 20): [string, number][] {
  const freq: Record<string, number> = {};
  (text || "").replace(/[、。・（）()「」[\]{}<>:;,.\n\r\t]/g, " ").split(/\s+/).forEach((w) => {
    w = w.trim();
    if (w.length >= 2 && !STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// デモ語彙。日本語は分かち書きが無く素朴分割だと「文」になるため、語彙一致で単語らしく見せる（実装は janome）。
const WC_VOCAB = ["生成AI", "ガイドライン", "競合", "値下げ", "ノーコード", "画像処理", "DX", "採算", "導入率", "要約", "情報漏えい", "ガバナンス", "コスト", "SaaS", "展示会", "需要", "企業", "リスク", "市場", "コンセプト", "配送", "ルート", "積載", "技術", "業務", "効率", "支援", "運用"];

export function cloudTokens(text: string, limit = 24): [string, number][] {
  let hits: [string, number][] = WC_VOCAB.map((w) => [w, (text || "").split(w).length - 1] as [string, number]).filter(([, c]) => c > 0);
  if (!hits.length) hits = simpleTokens(text, 12);
  hits.sort((a, b) => b[1] - a[1]);
  return hits.slice(0, limit);
}

export function demoSummary(text: string): string {
  const sents = (text || "").replace(/\s+/g, "").split(/。/).filter(Boolean);
  let s = sents.slice(0, 2).join("。");
  if (s) s += "。";
  if (s.length > 120) s = s.slice(0, 120) + "…";
  return s || (text || "").slice(0, 100);
}

export const plainText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
