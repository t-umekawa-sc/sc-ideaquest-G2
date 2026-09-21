// 所属（memberships）の入力用整形。一覧応答は MembershipView（group_id/role/name）だが、
// 発行/編集の送信スキーマ MembershipInput は group_id/role のみ（backend `extra="forbid"`）。
// name 等の余分なキーを載せたまま送ると 422 になるため、複製プリフィルや編集時はここで必ず絞る（DRY §2.3）。
import type { Membership } from "./types";

type MembershipLike = { group_id: string; role?: string | null };

export function toMembershipInputs(memberships: readonly MembershipLike[] | null | undefined): Membership[] {
  return (memberships ?? []).map((m) => ({
    group_id: m.group_id,
    role: m.role === "admin" ? "admin" : "member",
  }));
}
