"use client";

// SC-00 状態A（ログイン）。入力→login→成功で / へ。失敗は code→文言にマップ（つなぎ md 参照）。
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/lib/api/client";
import { login } from "../api";

// code→UI 文言（SC-00 §7・列挙耐性のため資格情報の詳細は出さない）
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "unauthenticated":
        return "ログインIDまたはパスワードが正しくありません。";
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
        // MFA は本スライス範囲外（状態C）。契約形のみ。
        setError("多要素認証が必要です（未対応）。");
      }
    } catch (err) {
      setError(messageFor(err));
      setPassword(""); // 失敗時はパスワードをクリア（SC-00 §5）
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div>
        <label htmlFor="company_code">会社コード</label>
        <input id="company_code" value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="login_id">ログインID</label>
        <input id="login_id" type="email" value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="password">パスワード</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "送信中…" : "ログイン"}
      </button>
    </form>
  );
}
