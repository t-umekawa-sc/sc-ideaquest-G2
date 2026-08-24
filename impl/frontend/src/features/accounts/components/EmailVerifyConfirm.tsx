"use client";

// メールアドレス確認の確定（ADR-0009・管理者 opt-in）。メール内リンク先 /email-verify/confirm?token=。
// 未認証で動く（トークンが認可）。誤クリック/メールスキャナの先読みで確定しないよう、明示ボタン押下で
// POST /auth/email-verify/confirm する（自動確定はしない）。410＝無効/期限切れ/使用済み・409＝送信後に
// メールが変更（stale）。
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { confirmEmailVerify } from "../api";
import "@/features/auth/auth.css";

type Phase = "ready" | "confirming" | "done" | "invalid" | "stale" | "error";

export function EmailVerifyConfirm({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>(token ? "ready" : "invalid");

  async function onConfirm() {
    setPhase("confirming");
    try {
      await confirmEmailVerify(token);
      setPhase("done");
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) return setPhase("invalid");
      if (err instanceof ApiError && err.status === 409) return setPhase("stale");
      setPhase("error");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Image src="/assets/logo-ideaquest.png" alt="IDEAQUEST" width={185} height={84} priority />
        </div>
        <h1>メールアドレスの確認</h1>

        {phase === "invalid" && (
          <>
            <div className="form-error">
              確認リンクの有効期限が切れているか、すでに使用されています。お手数ですが、管理者に確認メールの再送をご依頼ください。
            </div>
            <div className="login-links"><Link href="/login">ログインへ</Link></div>
          </>
        )}

        {phase === "stale" && (
          <>
            <div className="form-error">
              このリンクの送信後にメールアドレスが変更されています。最新のアドレス宛の確認メールから再度お手続きください。
            </div>
            <div className="login-links"><Link href="/login">ログインへ</Link></div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="form-error">エラーが発生しました。時間をおいて再度お試しください。</div>
            <div className="login-links"><Link href="/login">ログインへ</Link></div>
          </>
        )}

        {phase === "done" && (
          <>
            <p className="auth-confirm">メールアドレスを確認しました。</p>
            <Link href="/login" className="btn btn-primary btn-block">ログインへ</Link>
          </>
        )}

        {(phase === "ready" || phase === "confirming") && (
          <>
            <p className="auth-lead">下のボタンを押すと、このメールアドレスが確認済みになります。</p>
            <Button type="button" variant="primary" block disabled={phase === "confirming"} onClick={onConfirm}>
              {phase === "confirming" ? "確認中…" : "メールアドレスを確認する"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
