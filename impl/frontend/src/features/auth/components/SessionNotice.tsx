"use client";

// セッション終了時の通知（デザイン標準 §14）。ログイン画面着地時に URL の enum `reason` を読み、
// 固定文言のトーストを1回出して query を除去する（ワンショット＝リロードで再表示しない）。
// セキュリティ＝**生の reason 値は描画しない**＝既知 enum→ハードコード文言の写像のみ（内容偽装/反射型 XSS 防止）。
// 未知値は無視。SnackbarProvider 配下（(auth) レイアウト）で使う。
import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useSnackbar, type SnackOptions } from "@/components/ui";

const NOTICE: Record<string, SnackOptions> = {
  session_expired: { type: "info", title: "セッションの有効期限が切れました", msg: "もう一度ログインしてください。" },
  logged_out: { type: "info", title: "ログアウトしました" },
};

export function SessionNotice() {
  const snack = useSnackbar();
  const router = useRouter();
  const params = useSearchParams();
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    const reason = params.get("reason");
    const notice = reason ? NOTICE[reason] : undefined; // 既知 enum のみ・未知は無視
    if (!notice) return;
    shown.current = true;
    snack(notice);
    // query 除去（ワンショット）。他のクエリは温存し reason だけ落とす。
    const next = new URLSearchParams(params.toString());
    next.delete("reason");
    const qs = next.toString();
    router.replace(qs ? `/login?${qs}` : "/login");
  }, [params, snack, router]);

  return null;
}
