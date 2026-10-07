// 公開（コンテスト専用）モードでは業務ルートを 404＝存在秘匿（FR-48 §8.0・決定P'）。
// backend access_gate も同じ業務EPを 404 で封鎖する二重防御。配下の全ページ・ネストに効く。
import type { ReactNode } from "react";

import { requireNotPublicMode } from "@/lib/me";

export default async function BusinessRouteLayout({ children }: { children: ReactNode }) {
  await requireNotPublicMode();
  return <>{children}</>;
}
