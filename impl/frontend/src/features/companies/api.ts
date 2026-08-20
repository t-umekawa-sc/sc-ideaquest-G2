// companies 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/B_会社・アカウント・所属.md B.1。
import { apiFetch } from "@/lib/api/client";
import type { QueryState } from "@/components/ui";
import type {
  Company,
  CompanyCreateInput,
  CompanyDetail,
  CompanyListResponse,
  CompanyProfileInput,
  CompanySettingsInput,
} from "./types";

// §1.8.1 DataTable クエリ契約のうち会社一覧 EP がサーバー確定できる範囲（backend ホワイトリストに一致）。
// ソート可能キー（backend `_SORT_COLUMNS`）。db_identifier / status は非ソート＝ここに含めない。
const SORTABLE_KEYS = new Set(["name", "company_code", "account_count", "created_at"]);
// CSV エクスポート許可列（backend `_CSV_COLUMNS`）。groups/created/_actions（表示専用列）は対象外。
const CSV_COLUMNS = new Set(["name", "company_code", "db_identifier", "status", "account_count"]);

export function listCompanies(params?: {
  q?: string;
  status?: string;
  page?: number;
  per_page?: number;
}): Promise<CompanyListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.status) qs.set("status", params.status);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.per_page) qs.set("per_page", String(params.per_page));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<CompanyListResponse>(`/admin/companies${suffix}`);
}

// DataTable サーバーモードの委譲境界（§1.8.1）：QueryState → 会社一覧 EP のクエリパラメータ。
// 純関数（副作用なし）＝unit テスト対象（B-TC-136）。ソートキー/CSV 列はホワイトリストで濾す
// （未対応キーを送らない＝backend 422 を未然に防ぐ・列挙耐性）。表示状態（列順/幅/密度）は送らない。
export function companiesQueryParams(state: QueryState): URLSearchParams {
  const qs = new URLSearchParams();
  const q = state.search.trim();
  if (q) qs.set("q", q);

  // ① 複数ソート＝左優先でカンマ連結・desc は "-" 前置・ホワイトリスト外は落とす。
  const sort = state.sort
    .filter((s) => SORTABLE_KEYS.has(s.key))
    .map((s) => (s.dir === "desc" ? `-${s.key}` : s.key));
  if (sort.length) qs.set("sort", sort.join(","));

  // ② 項目別フィルタ＝FilterCond の型に 1:1（enum=多値カンマ／number=_min/_max／date=_from/_to）。
  //    text は backend が per-field contains を持たない＝横断 q へフォールバック（q 未設定時のみ）。
  for (const key of Object.keys(state.filters)) {
    const c = state.filters[key];
    if (c.type === "enum") {
      if (c.values.length) qs.set(key, c.values.join(","));
    } else if (c.type === "number") {
      if (c.min != null) qs.set(`${key}_min`, String(c.min));
      if (c.max != null) qs.set(`${key}_max`, String(c.max));
    } else if (c.type === "date") {
      if (c.from) qs.set(`${key}_from`, c.from);
      if (c.to) qs.set(`${key}_to`, c.to);
    } else if (c.type === "text") {
      const t = c.q.trim();
      if (t && !qs.has("q")) qs.set("q", t);
    }
  }

  // ④ ピン＝カンマ連結・空は省略・上限 5（backend 側も 5 で切り詰めるが送出側でも守る）。
  const pins = state.pinIds.filter(Boolean).slice(0, 5);
  if (pins.length) qs.set("pin_ids", pins.join(","));

  // ⑤ 番号ページャ（offset 型）。常に明示送出＝backend 既定に依存しない。
  qs.set("page", String(state.page));
  qs.set("per_page", String(state.perPage));
  return qs;
}

// サーバーモード fetch＝DataTable の query 委譲先。{rows,total,pinned} に射影して返す。
// AbortSignal は apiFetch → fetch へそのまま渡る（client.ts 改修不要）。
export async function queryCompanies(
  state: QueryState,
  signal?: AbortSignal,
): Promise<{ rows: Company[]; total: number; pinned: Company[] }> {
  const res = await apiFetch<CompanyListResponse>(
    `/admin/companies?${companiesQueryParams(state).toString()}`,
    { signal },
  );
  return {
    rows: res?.data ?? [],
    total: res?.page_info.total ?? 0,
    pinned: res?.pinned ?? [],
  };
}

// ③ CSV エクスポート URL（同一 EP の ?format=csv）。同一絞込/ソートの全件＝ページングは送らない。
//    columns は表示中データ列 key（表示順）を CSV 許可列で濾す。同一オリジン GET＝Cookie 認証・CSRF 不要。
//    apiFetch のプレフィックス /api/v1 を、アンカー/ダウンロード用に明示的に前置する。
export function companiesCsvUrl(state: QueryState, columns: string[]): string {
  const qs = companiesQueryParams(state);
  qs.delete("page");
  qs.delete("per_page");
  qs.set("format", "csv");
  const cols = columns.filter((c) => CSV_COLUMNS.has(c));
  if (cols.length) qs.set("columns", cols.join(","));
  return `/api/v1/admin/companies?${qs.toString()}`;
}

// 会社を新規作成（B.1）。`status=suspended` で作成される。CSRF は apiFetch が付与。
export function createCompany(input: CompanyCreateInput): Promise<CompanyDetail | null> {
  return apiFetch<CompanyDetail>("/admin/companies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCompany(companyId: string): Promise<CompanyDetail | null> {
  return apiFetch<CompanyDetail>(`/admin/companies/${companyId}`);
}

// 会社設定フラグ更新（B.1・記名時は hide_voters をサーバーが無効化して整合）。
export function updateCompanySettings(companyId: string, input: CompanySettingsInput): Promise<CompanyDetail | null> {
  return apiFetch<CompanyDetail>(`/admin/companies/${companyId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// 会社プロフィール更新（B.1・name/color/icon）。
export function updateCompanyProfile(companyId: string, input: CompanyProfileInput): Promise<CompanyDetail | null> {
  return apiFetch<CompanyDetail>(`/admin/companies/${companyId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// 会社アイコン画像＝管理DB companies.icon_image_path（B.1・MinIO・multipart）。応答は署名URL 込みの会社詳細。
// CSRF は apiFetch が付与、Content-Type は FormData をブラウザに任せる（client.ts）。
export function setCompanyIcon(companyId: string, file: File): Promise<CompanyDetail | null> {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch<CompanyDetail>(`/admin/companies/${companyId}/icon-image`, { method: "PUT", body: fd });
}
export function deleteCompanyIcon(companyId: string): Promise<null> {
  return apiFetch<null>(`/admin/companies/${companyId}/icon-image`, { method: "DELETE" }) as Promise<null>;
}
