// SC-51 情報の編集（フルページ＝直アクセス/リロード）。一覧アクションメニュー「編集」からの
// ソフト遷移は @modal intercept。中身は InfoFormModal（編集モード）共通。
import { redirect } from "next/navigation";

import { InfoFormModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function InfoEditPage({ params }: { params: Promise<{ infoId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { infoId } = await params;
  return <InfoFormModal mode="edit" infoId={infoId} standalone />;
}
