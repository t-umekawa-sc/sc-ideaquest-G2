"use client";

// ユーザーメニュー内のログアウト項目（プレーンな button＝.usermenu__list のスタイルが当たる）。
import { useRouter } from "next/navigation";
import { useState } from "react";

import { logout } from "../api";

export function LogoutMenuItem() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function onClick() {
    setPending(true);
    try {
      await logout();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }
  return (
    <button type="button" onClick={onClick} disabled={pending} role="menuitem">
      ログアウト
    </button>
  );
}
