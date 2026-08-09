"use client";

// SC-00 状態D（パスワード再設定リクエスト・自己サービス）。
// 会社コード＋ログインID→ POST /password-setup/request → 応答は常に 202（列挙耐性）。
// 成否・実在を出さず、送信後は常に同一の確認メッセージへ切り替える（SC-00 §7）。
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Button, Field } from "@/components/ui";
import { requestPasswordSetup } from "../api";
import "../auth.css";

export function PasswordResetRequestForm() {
  const [companyCode, setCompanyCode] = useState("");
  const [loginId, setLoginId] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await requestPasswordSetup(companyCode, loginId);
      // 成否に依らず（実在を漏らさない）確認メッセージへ。
      setSent(true);
    } catch {
      // 通信/サーバエラーのみ一般文言。列挙に繋がる情報は出さない。
      setError("エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Image src="/assets/logo-ideaquest.png" alt="IDEAQUEST" width={185} height={84} priority />
        </div>
        <h1>パスワードの再設定</h1>

        {sent ? (
          <>
            <p className="auth-confirm">
              該当するアカウントがあれば、登録メールアドレスへ再設定用リンクを送信しました。数分お待ちください。
            </p>
            <div className="login-links">
              <Link href="/login">ログインへ戻る</Link>
            </div>
          </>
        ) : (
          <>
            <p className="auth-lead">
              会社コードとログインIDを入力すると、登録メールアドレスへ再設定用リンクを送信します。
            </p>

            {error && <div className="form-error">{error}</div>}

            <form onSubmit={onSubmit} noValidate>
              <Field id="company_code" label="会社コード" required>
                <input
                  id="company_code"
                  className="input"
                  autoComplete="organization"
                  value={companyCode}
                  onChange={(e) => setCompanyCode(e.target.value)}
                  required
                />
              </Field>
              <Field id="login_id" label="ログインID" required>
                <input
                  id="login_id"
                  className="input"
                  autoComplete="username"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="primary" block disabled={pending}>
                {pending ? "送信中…" : "再設定リンクを送信"}
              </Button>
            </form>

            <div className="login-links">
              <Link href="/login">ログインへ戻る</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
