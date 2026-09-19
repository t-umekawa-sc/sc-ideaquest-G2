// SC-52 情報詳細の URL 付きモーダル（Intercept）。一覧からのソフト遷移で /info-items/[infoId] を差し込む。
// 直アクセス/リロードは (app)/info-items/[infoId] のフルページ。
import { redirect } from "next/navigation";

import { InfoDetailModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function InfoDetailInterceptModal({ params }: { params: Promise<{ infoId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { infoId } = await params;
  return <InfoDetailModal infoId={infoId} />;
}
