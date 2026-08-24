// メールアドレス確認の確定（管理者 opt-in・ADR-0009）。メールリンク先 /email-verify/confirm?token=。
// ルーティングのみ＝token を取り出し features/accounts の確定コンポーネントへ渡す（実体は client 側で POST）。
import { EmailVerifyConfirm } from "@/features/accounts";

export default async function EmailVerifyConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token ?? "";
  return <EmailVerifyConfirm token={token} />;
}
