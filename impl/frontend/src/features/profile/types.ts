// profile（自分のプロフィール）機能の型（§4.1・OpenAPI 生成 schema 参照）。
import type { components } from "@/lib/api/schema";

export type MeProfile = components["schemas"]["MeResponse"];
export type MeUpdateInput = components["schemas"]["MeUpdateRequest"];
export type PasswordChangeInput = components["schemas"]["PasswordChangeRequest"];
export type EmailChangeInput = components["schemas"]["EmailChangeRequest"];
export type EmailChangeConfirmInput = components["schemas"]["EmailChangeConfirmRequest"];
