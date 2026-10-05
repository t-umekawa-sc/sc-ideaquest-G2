// SC-95 お知らせ一覧（全社閲覧・ドメイン U・FR-49）。閲覧は全ユーザー（認可はサーバー強制）。
import { redirect } from "next/navigation";

import { AnnouncementsListView } from "@/features/announcements";
import { getServerSession } from "@/lib/session";

export default async function AnnouncementsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <AnnouncementsListView />;
}
