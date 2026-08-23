"use client";

// ユーザーメニュー内の「全端末からログアウト」項目（A.0-⑤＝全セッション破棄＋信頼端末失効）。
// 現端末のみの「ログアウト」の直下に置く。破壊的操作だがラベルで明示（確認ダイアログは設けない＝
// 既存「ログアウト」とパリティ）。成功/失敗いずれも /login へ戻す（現セッションは破棄済み）。
import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutAll } from "../api";

export function LogoutAllMenuItem() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function onClick() {
    setPending(true);
    try {
      await logoutAll();
    } finally {
      router.push("/login?reason=logged_out");
      router.refresh();
    }
  }
  return (
    <button type="button" onClick={onClick} disabled={pending} role="menuitem">
      全端末からログアウト
    </button>
  );
}
