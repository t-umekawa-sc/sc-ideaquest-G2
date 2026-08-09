// SC-00 状態B 初回/再設定パスワード設定（メールリンク先 /password-setup?token=）。
// ルーティングのみ＝token を取り出し features/auth のフォームへ渡す（実体は client 側で verify→complete）。
import { PasswordSetupForm } from "@/features/auth";

export default async function PasswordSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token ?? "";
  return <PasswordSetupForm token={token} />;
}
