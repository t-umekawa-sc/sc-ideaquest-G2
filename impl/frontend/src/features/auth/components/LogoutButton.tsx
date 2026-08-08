"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logout } from "../api";

export function LogoutButton() {
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
    <button onClick={onClick} disabled={pending}>
      ログアウト
    </button>
  );
}
