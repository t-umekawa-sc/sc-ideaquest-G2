// avatar 機能の API 呼び出し（§4.1・lib/api 経由）。正＝API設計 K.4.1（ベース体選択）。
// backend＝PUT /me/avatar-base（base=male/female・会社DB users.avatar_base 直接更新）。
// 装備着せ替え/カタログは shop/api（ドメイン G）＝別物（K.0/K.6 のドメイン境界）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

import type { AvatarBase } from "./base";

export type MeResponse = components["schemas"]["MeResponse"];

// ベース体（男女2体）を更新。所有検証は不要（在庫でなく本人 profile 属性）。応答は K.1 正準形（/me）。
export function updateAvatarBase(base: AvatarBase): Promise<MeResponse | null> {
  return apiFetch<MeResponse>(`/me/avatar-base`, { method: "PUT", body: JSON.stringify({ base }) });
}
