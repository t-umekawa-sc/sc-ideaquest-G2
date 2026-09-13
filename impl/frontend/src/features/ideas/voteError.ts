// 投票/フォローの失敗理由をユーザーに分かる文言へ（サーバーの detail を優先・SC-12/SC-22/SC-01 共通）。
// backend は 409 invalid_state（締切後/完了/公開前）や 403（権限なし）に人間可読な detail を載せる（D.5/C.5）。
import { ApiError } from "@/lib/api/client";

export function voteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail?: unknown }).detail ?? "") : "";
    if (detail) return detail;  // 例: 「締切後は投票できません」「完了後は変更できません」「公開前のアイデアには投票できません」
    if (err.status === 403) return "投票する権限がありません。";
    if (err.status === 409) return "このアイデアには現在投票できません（クエストの状態をご確認ください）。";
  }
  return "時間をおいて再度お試しください。";
}
