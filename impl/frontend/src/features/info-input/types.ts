// 情報インプット（FR-41）の型。将来 OpenAPI（backend `tenant/info` 実装後の codegen）に置換する想定＝
// 当面はローカル定義（データモデル §5.33-5.37／API ドメイン N に整合）。フィールド名は backend 契約に合わせる。

export type InfoStatus = "raw" | "curated" | "archived";
export type InfoLinkTarget = "ideas" | "quests" | "concepts" | "assumptions";
export type InfoLinkKind = "related" | "supporting" | "refuting";
export type InfoLinkOrigin = "auto" | "manual";

export interface InfoLink {
  id?: string;
  target_type: InfoLinkTarget;
  target_id?: string;
  target_title: string;
  kind: InfoLinkKind;
  origin: InfoLinkOrigin;
  score?: number | null;
  rejected?: boolean; // rejected_at が立っている＝棄却済み（再計算で復活しない・§N.6）
}

export interface InfoItem {
  id: string;
  parent_info_id?: string | null; // 続報元（§12-1）
  title: string;
  body_html: string; // サニタイズ済リッチ（§12-4）
  body_text?: string; // 平文派生（検索/トークン/要約）
  summary?: string; // 抽出要約（§12-3）
  source_url?: string | null;
  due_date?: string | null; // 対応/有効期限（#5）
  status: InfoStatus;
  priority?: string | null;
  source?: string | null;
  classification?: string | null;
  scope?: string | null;
  target_business?: string | null;
  categories: string[]; // #8 複数可
  impact_level?: string | null;
  impact_class?: string | null;
  impact_timing?: string | null;
  triaged_on?: string | null;
  triage?: string | null;
  triage_reason?: string | null;
  created_by: string;
  created_at: string;
  links: InfoLink[];
  follow_up_count?: number; // 続報件数（一覧の 🧵N 用・サーバー算出）
}

export type InfoStatusFilter = "all" | "raw" | "curated";
