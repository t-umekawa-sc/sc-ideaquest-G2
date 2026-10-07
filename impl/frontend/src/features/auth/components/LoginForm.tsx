"use client";

// SC-00 状態A（ログイン）。見た目はデザイン標準/モック準拠、業務層クリーン。
// 入力→login→成功で / へ。失敗は code→文言にマップ（画面API連携 SC-00 参照）。
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getBootstrap, login } from "../api";
import type { MfaChallenge } from "../types";
import { MfaForm } from "./MfaForm";
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
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  // 既定会社コード（public デプロイ）があれば会社コード欄を隠す（§8.1）。セルフサインアップ導線の出し分けにも使う。
  const [defaultCode, setDefaultCode] = useState<string | null>(null);
  const [signupAvailable, setSignupAvailable] = useState(false);

  // 会社コードは端末記憶（前回値）でプリフィル。SSR ハイドレーション不整合を避けるためマウント後に復元。
  // セルフサインアップ確定後の誘導（?company_code=&login_id=）があれば優先してプリフィル（FR-48②）。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qCompany = params.get("company_code");
    const qLogin = params.get("login_id");
    if (qCompany) setCompanyCode(qCompany.toUpperCase());
    else {
      const remembered = localStorage.getItem("ideaquest_company_code");
      if (remembered) setCompanyCode(remembered);
    }
    if (qLogin) setLoginId(qLogin);
  }, []);

  // 公開ブートストラップ＝既定会社コードの有無で会社コード欄とサインアップ導線を出し分け（FR-48②・§8.1）。
  useEffect(() => {
    getBootstrap()
      .then((b) => {
        if (b?.default_company_code) {
          setDefaultCode(b.default_company_code);
          setCompanyCode((cur) => cur || b.default_company_code!);
        }
        setSignupAvailable(Boolean(b?.self_signup_available));
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = companyCode.trim();
    if (code) localStorage.setItem("ideaquest_company_code", code); // 次回プリフィル用に端末記憶
    try {
      const res = await login(companyCode, loginId, password);
      if (res?.status === "authenticated") {
        router.push("/");
        router.refresh();
      } else if (res?.status === "mfa_required" && res.mfa) {
        setPassword("");        // pre-auth へ移行＝PW は保持しない
        setMfa(res.mfa);        // 状態C（認証コード入力）へ
      } else {
        setError("エラーが発生しました。時間をおいて再度お試しください。");
      }
    } catch (err) {
      setError(messageFor(err));
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  // 状態C: login が mfa_required を返したら認証コード入力へ切替（onRestart で状態Aへ戻る）
  if (mfa) {
    return (
      <MfaForm
        challenge={mfa}
        onRestart={(message) => {
          setMfa(null);
          setError(message ?? null);
        }}
      />
    );
  }

  return (
    <div className="login-page">
      <div>
      <div className="login-card">
        <div className="login-logo">
          <Image src="/assets/logo-ideaquest.png" alt="IDEAQUEST" width={185} height={84} priority />
        </div>
        <h1>ログイン</h1>

        {error && <div className="form-error" role="alert">{error}</div>}

        <form onSubmit={onSubmit} noValidate>
          {/* public デプロイで既定会社コードがある場合は会社コード欄を隠して自動セット（§8.1）。 */}
          {!defaultCode && (
            <Field id="company_code" label="会社コード" required>
              <input
                id="company_code"
                className="input"
                autoComplete="organization"
                placeholder="例: systemcon"
                style={{ textTransform: "uppercase" }}
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
                required
              />
            </Field>
          )}
          <Field id="login_id" label="ログインID" required>
            <input
              id="login_id"
              className="input"
              type="text"
              autoComplete="username"
              placeholder="例: system.concierge"
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
                placeholder="パスワードを入力"
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
          <Button type="submit" variant="primary" block loading={pending}>
            {pending ? "送信中…" : "ログイン"}
          </Button>
        </form>

        <div className="login-links">
          <Link href="/password-reset">パスワードをお忘れですか？</Link>
          {/* セルフサインアップ有効（公開デプロイ）の時だけ「アカウント作成」導線を出す（FR-48②・§8.1）。 */}
          {signupAvailable && <Link href="/signup">アカウントを作成</Link>}
        </div>

        <p className="login-note">
          {signupAvailable ? (
            <>
              <strong>はじめての方</strong>は「アカウントを作成」から登録できます（メール認証）。
              <br />
            </>
          ) : (
            <>
              アカウントは管理者が発行します。
              <br />
              <strong>初回ログインの方</strong>は、管理者発行後にメールで届く
              <strong>初回パスワード設定リンク</strong>（72時間有効）からパスワードを設定してからログインしてください。
              <br />
            </>
          )}
          ログインできない場合は、所属組織の管理者にお問い合わせください。
        </p>
      </div>
        <p className="login-foot">© ideaquest</p>
      </div>
    </div>
  );
}
