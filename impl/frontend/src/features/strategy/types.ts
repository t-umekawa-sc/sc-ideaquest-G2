// 経営資料（ドメイン R・FR-44）のフロント型。backend DTO（API設計 R.1）に対応。

export type DocKind = "midterm_plan" | "policy" | "strategy" | "other";

export const DOC_KIND_LABEL: Record<string, string> = {
  midterm_plan: "中期経営計画",
  policy: "方針",
  strategy: "戦略",
  other: "その他",
};

export interface StrategyDocListItem {
  id: string;
  title: string;
  doc_kind: string;
  status: string;
  focus_areas: string[];
  period_from: string | null;
  period_to: string | null;
  updated_at: string;
}

// 情報の影響サマリ（R.4・詳細 read 同梱・決定的）。母集団＝当該資料と関連度≥閾値の curated 情報。
export interface ImpactRates {
  info_total: number;        // 全 curated 情報数（影響率の分母）
  related_count: number;     // 母集団＝関連度≥threshold の curated 情報数
  impact_rate: number;       // related_count / info_total（0..1）
  opportunity_count: number;
  threat_count: number;
  opportunity_rate: number;  // 母集団のうち機会の割合（0..1）
  threat_rate: number;       // 母集団のうち脅威の割合（0..1）
  threshold: number;         // 使った関連度しきい値
}

// この方針まわりの語像（R.4b・集約＝関連情報＋アイデア＋コンセプトの語・設計§7）。
export interface StrategyWordCloud {
  tokens: { token: string; count: number; weight: number }[];
  related_count: number;
}

export interface StrategyDocDetail {
  id: string;
  title: string;
  doc_kind: string;
  intent: string | null;
  policy_commitment: string | null;
  strategy: string | null;
  focus_areas: string[];
  objectives: string | null;
  body_md: string | null;
  period_from: string | null;
  period_to: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  impact?: ImpactRates | null; // 詳細 read のみ同梱（R.4）。create/update では null。
}

// クエスト状態の日本語ラベル（英語 enum → 日本語表示・全画面共通）。
export const QUEST_STATUS_LABEL: Record<string, string> = {
  draft: "下書き", recruiting: "募集中", in_progress: "進行中", evaluating: "評価中", completed: "完了",
};
export const questStatusLabel = (s: string): string => QUEST_STATUS_LABEL[s] ?? s;

// 紐づくクエスト（R.1b・§5.56）。
export interface QuestLinkItem {
  id: string;
  title: string;
  status: string;
  deadline?: string | null;
  owner_name?: string | null;
  created_at?: string | null;
  icon_image_url?: string | null; // クエストアイコン（署名URL・ピッカー行頭表示／未設定は頭文字タイル）
}

export interface StrategyDocSelectionItem {
  id: string;
  title: string;
  doc_kind: string;
  period_from: string | null;
  period_to: string | null;
}

export interface StrategyListResult {
  data: StrategyDocListItem[];
  page_info: { page: number; per_page: number; total: number; has_next: boolean };
}

// 登録/編集の入力（未指定は送らない＝PATCH 差分）。
export interface StrategyDocInput {
  title?: string;
  doc_kind?: string;
  intent?: string | null;
  policy_commitment?: string | null;
  strategy?: string | null;
  focus_areas?: string[];
  objectives?: string | null;
  body_md?: string | null;
  period_from?: string | null;
  period_to?: string | null;
  status?: string;
}
