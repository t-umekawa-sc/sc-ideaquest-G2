// 情報インプットのデモデータ（モック先行フェーズの seam・フロント実装フロー規約 §4）。
// backend `tenant/info` 実装後は api.ts のデータ源を実 API に差し替える（本ファイルは廃止 or テスト用に残す）。
import type { InfoItem } from "./types";

export const INFO_FIXTURES: InfoItem[] = [
  {
    id: "i1", parent_info_id: null, title: "生成AIの業務利用が急拡大（○○総研レポート）",
    summary: "国内企業の生成AI導入率が前年比2.4倍。特に文書作成・要約・コード支援での定着が進む。",
    body_html: "<p>国内企業の<strong>生成AI導入率</strong>が前年比 <strong>2.4倍</strong>。文書作成・要約・コード支援での定着が進む。現場主導の PoC から全社展開フェーズへ。</p><ul><li>導入部門トップ＝情報システム・企画</li><li>課題＝ガバナンス・情報漏えい対策</li></ul>",
    source_url: "https://example.com/genai-report", due_date: "2026-12-31", status: "curated",
    priority: "high", source: "market_research", classification: "information", scope: "external", target_business: "software_dev",
    categories: ["ext_technology", "ext_industry"], impact_level: "major", impact_class: "opportunity", impact_timing: "within_1y",
    triaged_on: "2026-09-17", triage: "innovation", triage_reason: "新規事業の機会。社内AI活用支援サービスに接続可能。",
    created_by: "情報 花子", created_at: "2026-09-16",
    links: [
      { target_type: "ideas", target_title: "社内向けAIアシスタント", kind: "supporting", origin: "auto", score: 0.82 },
      { target_type: "quests", target_title: "DX推進クエスト", kind: "related", origin: "auto", score: 0.61 },
    ],
  },
  {
    id: "i2", parent_info_id: "i1", title: "生成AI 社内ガイドライン整備の動き（続報）",
    summary: "大手数社が生成AI利用ガイドラインを公開。情報分類と入力禁止データの線引きが論点。",
    body_html: "<p>大手数社が<strong>生成AI利用ガイドライン</strong>を相次いで公開。<em>入力禁止データ</em>の線引きと監査が論点。</p>",
    source_url: "https://example.com/genai-guideline", due_date: null, status: "raw",
    priority: null, source: "news", classification: null, scope: "external", target_business: null,
    categories: [], impact_level: null, impact_class: null, impact_timing: null,
    triaged_on: null, triage: null, triage_reason: null, created_by: "開発 太郎", created_at: "2026-09-18",
    links: [{ target_type: "ideas", target_title: "社内向けAIアシスタント", kind: "related", origin: "auto", score: 0.74 }],
  },
  {
    id: "i3", parent_info_id: null, title: "競合A社が類似SaaSを大幅値下げ",
    summary: "競合A社が同カテゴリSaaSを30%値下げ。既存商談の失注リスクと採算見直しが必要。",
    body_html: "<p><strong>競合A社</strong>が同カテゴリSaaSを <strong>30%</strong> 値下げ。価格競争が加速する見込み。</p>",
    source_url: "https://example.com/competitor-price", due_date: "2026-10-15", status: "curated",
    priority: "highest", source: "competitor", classification: "information", scope: "external", target_business: "software_dev",
    categories: ["ext_competitor", "ext_economy"], impact_level: "severe", impact_class: "threat", impact_timing: "within_3m",
    triaged_on: "2026-09-15", triage: "improve_business", triage_reason: "採算前提を揺さぶる。価格戦略コンセプトの再評価が必要。",
    created_by: "情報 花子", created_at: "2026-09-14",
    links: [{ target_type: "concepts", target_title: "新料金プランのコンセプト", kind: "refuting", origin: "manual", score: 0.68 }],
  },
  {
    id: "i4", parent_info_id: null, title: "展示会メモ：ノーコード需要の高まり",
    summary: "", body_html: "<p>展示会での聞き取り。中小の情シス人材不足でノーコード需要が強い。</p>",
    source_url: "", due_date: null, status: "raw",
    priority: null, source: "event", classification: null, scope: "external", target_business: null,
    categories: [], impact_level: null, impact_class: null, impact_timing: null,
    triaged_on: null, triage: null, triage_reason: null, created_by: "営業 次郎", created_at: "2026-09-13", links: [],
  },
  {
    id: "i5", parent_info_id: null, title: "自社の画像処理基盤は横展開の余地あり",
    summary: "既存の画像処理基盤（社内資産）は他事業へ転用可能。実現可能性ヒントとして有望。",
    body_html: "<p>既存の<strong>画像処理基盤</strong>は他事業へ転用可能。実現可能性のヒント。</p>",
    source_url: "", due_date: null, status: "curated",
    priority: "normal", source: "employee", classification: "knowledge", scope: "internal", target_business: "software_dev",
    categories: ["internal_tech", "internal_capability"], impact_level: "moderate", impact_class: "opportunity", impact_timing: "within_1y",
    triaged_on: "2026-09-12", triage: "innovation", triage_reason: "自社技術知見（内部｜技術・能力）。アイデアの実現可能性根拠。",
    created_by: "開発 太郎", created_at: "2026-09-11",
    links: [{ target_type: "ideas", target_title: "画像自動タグ付けサービス", kind: "supporting", origin: "auto", score: 0.79 }],
  },
];

// 関連リンクの追加候補（デモ）。実装＝GET /info-link-candidates 等でサーバー検索に置換。
export const LINK_CANDIDATES: Record<string, string[]> = {
  ideas: ["社内向けAIアシスタント", "画像自動タグ付けサービス", "配送ルート最適化", "請求書処理の電子化"],
  quests: ["DX推進クエスト", "コスト削減チャレンジ"],
  concepts: ["新料金プランのコンセプト", "AI活用支援サービス構想"],
};
