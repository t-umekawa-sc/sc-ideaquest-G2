// SC-94 会社のLLM設定（FR-45・S.5）。company_account_admin 専用＋system_admin 上位互換。
// 認可はサーバー強制（API も require_company_account_admin で二重防御）。
import { redirect } from "next/navigation";

import { AiSettingsView } from "@/features/ai-settings";
import { getServerSession } from "@/lib/session";

export default async function AiSettingsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.system_role !== "company_account_admin" && session.system_role !== "system_admin") redirect("/");
  return <AiSettingsView />;
}
