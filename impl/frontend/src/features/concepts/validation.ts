// コンセプト実績（検証）入力のクライアント検証（SC-61 §4.4・デザイン標準 §4.7）。
// フィールド単位で欠落を返す＝該当項目だけを赤くし「どこが足りないか」を示す（まとめて「必須」の非標準表示を避ける）。
// サーバーが最終権威（P-TC-203 の 422）＝本関数は UX 補助（§4.7）。
import type { FieldErrors } from "@/lib/forms/validation";

export type ValidationInput = { method: string; validatedOn: string; scale: string };

// 手法・実施日・規模は必須（エビデンスの強さ／古び防止・SC-61 §4.4）。入力済み項目はエラーにしない。
export function validateValidationInput(input: ValidationInput): FieldErrors {
  const e: FieldErrors = {};
  if (!input.method.trim()) e.method = "検証方法を入力してください。";
  if (!input.validatedOn) e.validatedOn = "検証実施日を入力してください。";
  if (!input.scale.trim()) e.scale = "規模（サンプル数/対象）を入力してください。";
  return e;
}
