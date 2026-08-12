// SC-93 会社アカウント管理者（自社アカウント管理）ページ。company_account_admin 専用＋system_admin 上位互換。
import { redirect } from "next/navigation";

import { AccountSelfSection } from "@/features/accounts";
import { getServerSession } from "@/lib/session";

export default async function OwnAccountsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 認可はサーバー強制（API も require_company_account_admin で二重防御）。system_admin は上位互換で許可。
  if (session.system_role !== "company_account_admin" && session.system_role !== "system_admin") redirect("/");
  // 自社コンテキスト表示用に会社コードを渡す（会社表示名は session 未提供＝将来拡張。当面はコード）。
  return <AccountSelfSection companyCode={session.company_code} />;
}
