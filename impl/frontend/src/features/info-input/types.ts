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

// --- 一覧カード DTO（GET /info-items・サーバー委譲）＝backend InfoItemCardDTO と一致。 ---
// 本文（body_html/links 明細）は含めない＝一覧は軽量カード（詳細は Phase B の GET /info-items/{id}）。
export interface InfoCreator {
  user_id: string;
  display_name: string;
  avatar_image_url?: string | null;
}
export interface InfoCard {
  id: string;
  parent_info_id?: string | null;
  title: string;
  summary?: string | null;
  status: InfoStatus;
  priority?: string | null;
  source?: string | null;
  classification?: string | null;
  scope?: string | null;
  impact_class?: string | null;
  categories: string[];
  source_url?: string | null;
  due_date?: string | null;
  created_by: InfoCreator;
  created_at: string;
  link_count: number;
  follow_up_count: number;
}
export interface InfoStatusFacets {
  all: number;
  raw: number;
  curated: number;
}
export interface InfoListResult {
  data: InfoCard[];
  page_info: { total: number; page: number; per_page: number };
  facets: InfoStatusFacets;
}
export interface WordCloudToken {
  token: string;
  count: number;
  weight?: number | null;
}

// --- 詳細 DTO（GET /info-items/{id}）＝backend InfoDetailDTO と一致。 ---
export interface InfoLinkResolved {
  id: string;
  target_type: InfoLinkTarget;
  target_id: string;
  target_title?: string | null; // ideas/quests から解決（未実装ドメイン/不在は null）
  kind: InfoLinkKind;
  origin: InfoLinkOrigin;
  score?: number | null;
  rejected: boolean;
}
export interface InfoThreadItem {
  id: string;
  title: string;
  created_by?: string | null;
  created_at: string;
}
export interface InfoThread {
  parent?: InfoThreadItem | null;
  follow_ups: InfoThreadItem[];
}
export interface InfoLinkCandidate {
  target_type: InfoLinkTarget;
  target_id: string;
  title: string;
}
export interface InfoCan {
  edit_content: boolean; // 内容＝作成者のみ
  curate: boolean; // 属性/triage/status/archive＝curator
  add_link: boolean; // 関連リンク＝全員
}
export interface InfoDetail {
  id: string;
  parent_info_id?: string | null;
  title: string;
  body_html?: string | null;
  summary?: string | null;
  source_url?: string | null;
  due_date?: string | null;
  status: InfoStatus;
  priority?: string | null;
  source?: string | null;
  classification?: string | null;
  scope?: string | null;
  target_business?: string | null;
  impact_level?: string | null;
  impact_class?: string | null;
  impact_timing?: string | null;
  triaged_on?: string | null;
  triage?: string | null;
  triage_reason?: string | null;
  categories: string[];
  created_by: InfoCreator;
  created_at: string;
  updated_at: string;
  links: InfoLinkResolved[];
  thread: InfoThread;
  tokens_top: WordCloudToken[];
  can: InfoCan;
}
