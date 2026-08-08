// SC-00 ログイン（ルーティングのみ・実体は features/auth）。
import { LoginForm } from "@/features/auth";

export default function LoginPage() {
  return (
    <main>
      <h1>ログイン</h1>
      <LoginForm />
    </main>
  );
}
