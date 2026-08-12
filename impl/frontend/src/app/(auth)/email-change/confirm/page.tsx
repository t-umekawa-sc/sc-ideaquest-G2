// K.3 メール変更の確定（ダブルオプトイン・ADR-0008）。メールリンク先 /email-change/confirm?token=。
// ルーティングのみ＝token を取り出し features/profile の確定コンポーネントへ渡す（実体は client 側で POST）。
import { EmailChangeConfirm } from "@/features/profile";

export default async function EmailChangeConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token ?? "";
  return <EmailChangeConfirm token={token} />;
}
