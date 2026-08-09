// SC-00 状態D パスワード再設定リクエスト（ルーティングのみ・実体は features/auth）。
import { PasswordResetRequestForm } from "@/features/auth";

export default function PasswordResetPage() {
  return <PasswordResetRequestForm />;
}
