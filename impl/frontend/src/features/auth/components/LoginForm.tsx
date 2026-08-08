"use client";

// SC-00 状態A（ログイン）。見た目はデザイン標準/モック準拠、業務層クリーン。
// 入力→login→成功で / へ。失敗は code→文言にマップ（画面API連携 SC-00 参照）。
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { login } from "../api";
import "../auth.css";

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "unauthenticated":
        return "会社コード・ログインID・パスワードのいずれかが正しくありません。";
      case "company_suspended":
        return "このアカウントは現在ご利用いただけません。管理者にお問い合わせください。";
      case "rate_limited":
        return "試行回数が多すぎます。しばらくして再度お試しください。";
      case "validation_error":
        return "入力内容をご確認ください。";
    }
  }
  return "エラーが発生しました。時間をおいて再度お試しください。";
}

export function LoginForm() {
  const router = useRouter();
  const [companyCode, setCompanyCode] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await login(companyCode, loginId, password);
      if (res?.status === "authenticated") {
        router.push("/");
        router.refresh();
      } else {
        setError("多要素認証が必要です（未対応）。");
      }
    } catch (err) {
      setError(messageFor(err));
      setPassword("");
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
        <h1>ログイン</h1>

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
              type="email"
              autoComplete="username"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
            />
          </Field>
          <Field id="password" label="パスワード" required>
            <div className="pw-wrap">
              <input
                id="password"
                className="input"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="pw-toggle"
                aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
                onClick={() => setShowPw((v) => !v)}
              >
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
          </Field>
          <Button type="submit" variant="primary" block disabled={pending}>
            {pending ? "送信中…" : "ログイン"}
          </Button>
        </form>

        <p className="login-note">
          アカウントは管理者が発行します（自己新規登録はできません）。
          <br />
          <strong>初回ログインの方</strong>は、管理者発行後にメールで届く
          <strong>初回パスワード設定リンク</strong>からパスワードを設定してからログインしてください。
        </p>
      </div>
    </div>
  );
}
