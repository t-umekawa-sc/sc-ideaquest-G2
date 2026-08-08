// サーバー側でのセッション取得（Server Components 用・§4.1 lib）。
// 受信リクエストの Cookie を backend の GET /auth/session へ転送して本人確認する。
import { cookies } from "next/headers";

import type { components } from "@/lib/api/schema";

const backend = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

// 型はバックエンド OpenAPI から生成（手書きしない＝drift 防止）。
export type Session = components["schemas"]["Session"];

export async function getServerSession(): Promise<Session | null> {
  const cookie = (await cookies()).toString();
  const res = await fetch(`${backend}/api/v1/auth/session`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as Session;
}
