// K プロフィール編集ページ。認証済みユーザー本人のプロフィール（表示名・ロケール）。
import { redirect } from "next/navigation";

import { ProfileForm, SecuritySection } from "@/features/profile";
import { getServerSession } from "@/lib/session";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <>
      <ProfileForm />
      <SecuritySection />
    </>
  );
}
