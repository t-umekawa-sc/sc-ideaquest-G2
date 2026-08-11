// SC-92 会社詳細/設定ページ。system_admin 専用（サーバー側でガード）。
import { redirect } from "next/navigation";

import { CompanyDetailView } from "@/features/companies";
import { getServerSession } from "@/lib/session";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.system_role !== "system_admin") redirect("/"); // 認可はサーバー強制（API も 403 で二重防御）
  const { id } = await params;
  return <CompanyDetailView companyId={id} />;
}
