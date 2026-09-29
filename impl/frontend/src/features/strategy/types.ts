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
}

// 紐づくクエスト（R.1b・§5.56）。
export interface QuestLinkItem {
  id: string;
  title: string;
  status: string;
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
