// accounts 機能の型（§4.1・OpenAPI 生成 schema 参照＝手書きしない）。
import type { components } from "@/lib/api/schema";

export type Account = components["schemas"]["AccountListItem"];
export type AccountListResponse = components["schemas"]["AccountListResponse"];
export type AccountResponse = components["schemas"]["AccountResponse"];
export type AccountCreateInput = components["schemas"]["AccountCreateRequest"];
export type Membership = components["schemas"]["MembershipInput"];
export type QuestGroup = components["schemas"]["QuestGroupListItem"];
