// アバターのベース体（男女2体・SC-31 §9.2・データモデル §5.3 avatar_base）。
// 値はバックエンド enum（male/female）と一致。将来 animal_* を追加（SC-31 §9.6）。
export const AVATAR_BASES = ["male", "female"] as const;
export type AvatarBase = (typeof AVATAR_BASES)[number];

export const AVATAR_BASE_LABEL: Record<AvatarBase, string> = { male: "男", female: "女" };

// 未知値（将来の enum 追加前・不正入力）を安全に既定へ丸める。GET /me の profile.avatar_base は string 型。
export function toAvatarBase(v: string | null | undefined): AvatarBase {
  return v === "female" ? "female" : "male"; // 既定 male（§5.3）
}
