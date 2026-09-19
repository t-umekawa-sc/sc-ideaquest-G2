// SC-50 情報インプット 一覧。会社内の active ユーザーなら閲覧可（テナント内・他社不可）。認可はサーバー強制。
import { redirect } from "next/navigation";

import { InfoListView } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function InfoItemsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <InfoListView />;
}
