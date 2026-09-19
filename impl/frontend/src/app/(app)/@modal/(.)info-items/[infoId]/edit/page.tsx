// SC-51 情報の編集の URL 付きモーダル（Intercept Routes）。一覧アクションメニュー「編集」からの
// ソフト遷移で /info-items/[infoId]/edit をこのモーダルに差し込む。直アクセス/リロードは
// (app)/info-items/[infoId]/edit のフルページ。
import { redirect } from "next/navigation";

import { InfoFormModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function InfoEditInterceptModal({ params }: { params: Promise<{ infoId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { infoId } = await params;
  return <InfoFormModal mode="edit" infoId={infoId} />;
}
