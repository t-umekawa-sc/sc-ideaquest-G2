// 認証系（ログイン/MFA/PW設定・再設定/メール変更）レイアウト。
// セッション終了時の通知（デザイン標準 §14）のため SnackbarProvider を設置し、SessionNotice が
// URL の reason を読んでトーストを出す（useSearchParams は Suspense 境界が必要）。
import { Suspense } from "react";

import { SnackbarProvider } from "@/components/ui";
import { SessionNotice } from "@/features/auth";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SnackbarProvider>
      <Suspense fallback={null}>
        <SessionNotice />
      </Suspense>
      {children}
    </SnackbarProvider>
  );
}
