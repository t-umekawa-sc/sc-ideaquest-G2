// 情報インプットの enum → 表示ラベル（データモデル §3 info_* enum）。プレゼンテーション層。
// バッジ用のクラス名を伴うものは [label, className] のタプル。

export const STATUS_LABEL: Record<string, [string, string]> = {
  raw: ["未判定", "st-raw"],
  curated: ["判定済", "st-curated"],
  archived: ["アーカイブ", "st-archived"],
};
export const PRIORITY_LABEL: Record<string, string> = {
  highest: "最高", high: "高い", normal: "普通", low: "低い", lowest: "最低",
};
export const SOURCE_LABEL: Record<string, string> = {
  public_data: "公的機関", market_research: "民間調査/企業データ", news: "新聞・ネットニュース",
  event: "展示会・セミナー", customer: "取引先・顧客", personal: "親族・友人", competitor: "競合",
  investor: "株主・投資家", org_decision: "組織の決定事項", employee: "従業員", legal: "弁護士・法律専門家",
  research: "研究機関・コミュニティ", other: "その他",
};
export const CLASSIFICATION_LABEL: Record<string, string> = {
  information: "情報", idea: "アイデア", request: "要望・要求", knowledge: "ナレッジ", proposal: "提案", other: "その他",
};
export const SCOPE_LABEL: Record<string, string> = { external: "外部", internal: "内部", other: "その他" };
export const BUSINESS_LABEL: Record<string, string> = {
  innovation: "イノベーション", bpo: "BPO", generative_provider: "ジェネレーティブ・プロバイダー",
  it_infra_network: "ITインフラ・NW", software_dev: "ソフトウェア開発", it_service_ops: "ITサービス運用支援", other: "その他",
};
export const CATEGORY_LABEL: Record<string, string> = {
  ext_economy: "外部｜経済", ext_politics_law: "外部｜政治法律", ext_society_culture: "外部｜社会文化",
  ext_industry: "外部｜業界", ext_competitor: "外部｜競合", ext_technology: "外部｜技術",
  ext_geography: "外部｜自然地理", ext_other: "外部｜その他", internal_tech: "内部｜技術",
  internal_capability: "内部｜能力", internal_process: "内部｜業務プロセス", internal_people: "内部｜従業員役員",
  internal_customer: "内部｜顧客", internal_partner: "内部｜取引先", internal_finance: "内部｜財務実績",
  internal_culture: "内部｜文化価値", internal_hr: "内部｜人事組織",
};
export const IMPACT_LABEL: Record<string, string> = {
  unknown: "判断できない", none: "影響なし", minor: "軽度", moderate: "中度", major: "重度", severe: "過大",
};
export const IMPACT_CLASS_LABEL: Record<string, [string, string]> = {
  opportunity: ["機会", "ic-opportunity"], threat: ["脅威", "ic-threat"], other: ["その他", "ic-other"],
};
export const TIMING_LABEL: Record<string, string> = {
  unknown: "不明", within_3y: "3年以内", within_1y: "1年以内", within_6m: "6カ月以内", within_3m: "3カ月以内", already: "すでに発生",
};
export const TRIAGE_LABEL: Record<string, string> = {
  innovation: "イノベーション活動", improve_business: "カイゼン（ビジネス）", improve_ops: "カイゼン（業務事務）",
  task: "タスク活動", share: "情報共有活動", other: "その他", no_action: "対応不要",
};
export const LINK_KIND_LABEL: Record<string, [string, string]> = {
  related: ["関連", "lk-related"], supporting: ["裏付け", "lk-supporting"], refuting: ["反証", "lk-refuting"],
};
export const LINK_TARGET_LABEL: Record<string, string> = {
  ideas: "💡アイデア", concepts: "🧩コンセプト", quests: "📜クエスト", assumptions: "📌前提",
};
