// SC-91 システム管理（会社一覧）ページ。system_admin 専用（サーバー側でガード）。
import { redirect } from "next/navigation";

import { CompanyList } from "@/features/companies";
import { getServerSession } from "@/lib/session";

export default async function CompaniesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.system_role !== "system_admin") redirect("/"); // 認可はサーバー強制（API も 403 で二重防御）
  return <CompanyList />;
}
