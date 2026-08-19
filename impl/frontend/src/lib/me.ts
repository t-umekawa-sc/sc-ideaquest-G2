// サーバー側での自己プロフィール＋残高取得（Server Components 用・§4.1 lib）。
// GET /me（K.1 正準）を受信 Cookie 転送で呼ぶ。1リクエスト内は React cache で重複排除（ヘッダー・各ページが共用）。
import { cache } from "react";

import { cookies } from "next/headers";

import type { components } from "@/lib/api/schema";

const backend = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

// 型はバックエンド OpenAPI から生成（手書きしない＝drift 防止）。
export type Me = components["schemas"]["MeResponse"];
type Balance = Me["balance"];

export const getServerMe = cache(async (): Promise<Me | null> => {
  const cookie = (await cookies()).toString();
  const res = await fetch(`${backend}/api/v1/me`, { headers: { cookie }, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as Me;
});

// ヒーロー/プロフィール残高（XPバー付き）。現レベル内の進捗率＝(level_span - xp_to_next)/level_span。
export function heroBalance(b: Balance) {
  const pct = b.level_span > 0 ? Math.round(((b.level_span - b.xp_to_next) / b.level_span) * 100) : 0;
  return { level: b.level, xpPct: pct, xpToNext: b.xp_to_next, coin: b.coin_balance, sp: b.skill_point_balance };
}

// 共通ヘッダー通貨（Lv/コイン/SP）。
export function headerBalance(b: Balance) {
  return { level: b.level, coin: b.coin_balance, sp: b.skill_point_balance };
}
