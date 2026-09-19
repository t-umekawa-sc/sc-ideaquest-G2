// SC-50「この情報からクエストを作成」の URL 付きモーダル（Intercept Routes）。詳細 CTA からの
// ソフト遷移で /info-items/[infoId]/new-quest をこのモーダルに差し込む。直アクセス/リロードは
// (app)/info-items/[infoId]/new-quest のフルページ。
import { redirect } from "next/navigation";

import { QuestFromInfoModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function QuestFromInfoInterceptModal({ params }: { params: Promise<{ infoId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { infoId } = await params;
  return <QuestFromInfoModal infoId={infoId} />;
}
