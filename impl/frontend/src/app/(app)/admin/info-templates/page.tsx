// SC-55 情報テンプレート管理（内部情報テンプレートのマスタ・N.5b・FR-41⑩）。会社管理者専用（API も管理者強制で二重防御）。
import { redirect } from "next/navigation";

import { InfoTemplateAdminView } from "@/features/info-templates";
import { getServerSession } from "@/lib/session";

export default async function AdminInfoTemplatesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.system_role !== "company_account_admin" && session.system_role !== "system_admin") redirect("/");
  return <InfoTemplateAdminView />;
}
