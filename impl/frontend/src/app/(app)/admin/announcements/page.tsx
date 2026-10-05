// SC-96 お知らせ管理（作成/編集/ピン・ドメイン U・FR-49）。管理者専用（API も管理者強制で二重防御）。
import { redirect } from "next/navigation";

import { AnnouncementAdminView } from "@/features/announcements";
import { getServerSession } from "@/lib/session";

export default async function AdminAnnouncementsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.system_role !== "company_account_admin" && session.system_role !== "system_admin") redirect("/");
  return <AnnouncementAdminView />;
}
