// SC-52 情報の詳細（フルページ＝直アクセス/リロード）。一覧からのソフト遷移は @modal intercept。
import { redirect } from "next/navigation";

import { InfoDetailModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function InfoDetailPage({ params }: { params: Promise<{ infoId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { infoId } = await params;
  return <InfoDetailModal infoId={infoId} standalone />;
}
