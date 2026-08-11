// companies 機能の型（§4.1・バックエンド OpenAPI 生成 schema を参照＝手書きしない）。
import type { components } from "@/lib/api/schema";

export type Company = components["schemas"]["CompanyListItem"];
export type CompanyListResponse = components["schemas"]["CompanyListResponse"];
export type CompanyDetail = components["schemas"]["CompanyDetail"];
export type CompanyCreateInput = components["schemas"]["CompanyCreateRequest"];
export type CompanySettingsInput = components["schemas"]["CompanySettingsUpdateRequest"];
export type CompanyProfileInput = components["schemas"]["CompanyProfileUpdateRequest"];
