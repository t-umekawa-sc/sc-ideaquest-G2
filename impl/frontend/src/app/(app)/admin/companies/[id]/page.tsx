// SC-92 会社詳細/設定ページ。system_admin 専用（サーバー側でガード）。
import { redirect } from "next/navigation";

import { CompanyDetailView } from "@/features/companies";
import { getServerSession } from "@/lib/session";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.system_role !== "system_admin") redirect("/"); // 認可はサーバー強制（API も 403 で二重防御）
  const { id } = await params;
  // 自社（セッション会社＝表示中の会社）のときだけ情報判定権限セクションを出す（B）＝
  // info-curators API はセッション会社固定のため、自社詳細でのみ正しく効く（他社はクロステナント未対応）。
  return <CompanyDetailView companyId={id} isOwnCompany={session.company_id === id} />;
}
