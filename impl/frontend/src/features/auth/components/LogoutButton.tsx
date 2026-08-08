"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
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
    <Button variant="outline" onClick={onClick} disabled={pending}>
      ログアウト
    </Button>
  );
}
