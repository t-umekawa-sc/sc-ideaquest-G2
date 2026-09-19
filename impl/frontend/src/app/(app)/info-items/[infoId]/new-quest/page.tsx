// SC-50「この情報からクエストを作成」（フルページ＝直アクセス/リロード）。詳細の CTA からの
// ソフト遷移は @modal intercept。軽量デモ（実装は SC-11 本フォーム＋API C from_info_id）。
import { redirect } from "next/navigation";

import { QuestFromInfoModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function QuestFromInfoPage({ params }: { params: Promise<{ infoId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { infoId } = await params;
  return <QuestFromInfoModal infoId={infoId} standalone />;
}
