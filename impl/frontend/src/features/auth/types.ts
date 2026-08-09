// 型はバックエンド OpenAPI から生成（src/lib/api/schema.d.ts）。手書きしない＝drift 防止。
import type { components } from "@/lib/api/schema";

export type LoginRequest = components["schemas"]["LoginRequest"];
export type LoginResponse = components["schemas"]["LoginResponse"];

// 初回・再設定パスワード（A.7・状態B/D）
export type PasswordSetupVerifyResponse = components["schemas"]["PasswordSetupVerifyResponse"];

// problem+json の errors[] 項目（422 validation_error・API設計 README §1.7）。
// OpenAPI の 200 応答には現れないため、フィールド単位表示のために最小形をここに置く。
export type FieldError = { field: string; code: string; message: string };
