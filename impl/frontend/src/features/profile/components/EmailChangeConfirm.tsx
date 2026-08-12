"use client";

// K.3 メール変更の確定（ダブルオプトイン・ADR-0008）。メール内リンク先 /email-change/confirm?token=。
// 未認証で動く（トークンが認可）。誤クリック/メールスキャナの先読みで確定しないよう、
// 明示ボタン押下で POST /me/email/confirm する（自動確定はしない）。410＝無効/期限切れ/使用済み。
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { confirmEmailChange } from "../api";
import "@/features/auth/auth.css";

type Phase = "ready" | "confirming" | "done" | "invalid" | "error";

export function EmailChangeConfirm({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>(token ? "ready" : "invalid");

  async function onConfirm() {
    setPhase("confirming");
    try {
      await confirmEmailChange(token);
      setPhase("done");
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setPhase("invalid");
        return;
      }
      setPhase("error");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Image src="/assets/logo-ideaquest.png" alt="IDEAQUEST" width={185} height={84} priority />
        </div>
        <h1>メールアドレス変更の確認</h1>

        {phase === "invalid" && (
          <>
            <div className="form-error">
              確認リンクの有効期限が切れているか、すでに使用されています。お手数ですが、プロフィール画面から再度お手続きください。
            </div>
            <div className="login-links">
              <Link href="/profile">プロフィールへ</Link>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="form-error">エラーが発生しました。時間をおいて再度お試しください。</div>
            <div className="login-links">
              <Link href="/profile">プロフィールへ</Link>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <p className="auth-confirm">メールアドレスの変更を確定しました。</p>
            <Link href="/profile" className="btn btn-primary btn-block">
              プロフィールへ
            </Link>
          </>
        )}

        {(phase === "ready" || phase === "confirming") && (
          <>
            <p className="auth-lead">下のボタンを押すと、このメールアドレスへの変更が確定します。</p>
            <Button type="button" variant="primary" block disabled={phase === "confirming"} onClick={onConfirm}>
              {phase === "confirming" ? "確定中…" : "メールアドレスの変更を確定する"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
