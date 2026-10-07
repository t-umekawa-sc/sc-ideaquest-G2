"use client";

// SC-05 アカウント作成（セルフサインアップ・FR-48②）。
// 状態1 入力 → 状態2 認証コード（SC-00 状態C と同形）→ 状態3 完了 → SC-00 ログインへプリフィル誘導。
// 検証前にアカウントは作られない（決定A・サーバー権威）。応答は列挙耐性のため一律 202（SEC B）＝
// 成否を UI で区別せず「コードを送信しました」。確定は自動ログインしない（SEC I）。
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getBootstrap, signup, signupVerify } from "../api";
import "../auth.css";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clientPwErrors(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < 8) out.push("8文字以上");
  return out;
}

type Phase = "form" | "otp" | "done";

export function SignupForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("form");

  // 既定会社コード（public デプロイ）があれば会社コード欄を隠して自動セット（§8.1）。
  const [defaultCode, setDefaultCode] = useState<string | null>(null);
  const [companyCode, setCompanyCode] = useState("");
  const [loginId, setLoginId] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [code, setCode] = useState("");
  const [maskedTo, setMaskedTo] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [resendInfo, setResendInfo] = useState<string | null>(null);

  // CAPTCHA（Turnstile）＝bootstrap で site key が返る時だけ有効（prod）。未設定（dev）は出さない。
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const captchaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getBootstrap()
      .then((b) => {
        if (b?.default_company_code) {
          setDefaultCode(b.default_company_code);
          setCompanyCode(b.default_company_code);
        }
        if (b?.turnstile_site_key) setSiteKey(b.turnstile_site_key);
      })
      .catch(() => {});
  }, []);

  // Turnstile ウィジェット描画（site key 有＋完了前）。入力/認証コード両フェーズで共有＝再送でも新トークンを得る
  // （Turnstile は単回トークンを callback で自動更新）。
  useEffect(() => {
    if (!siteKey || phase === "done") return;
    const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    const render = () => {
      const ts = (window as unknown as { turnstile?: { render: (el: HTMLElement, opts: object) => void } }).turnstile;
      if (ts && captchaRef.current && captchaRef.current.childElementCount === 0) {
        ts.render(captchaRef.current, {
          sitekey: siteKey,
          callback: (token: string) => setCaptchaToken(token),
          "error-callback": () => setCaptchaToken(""),
          "expired-callback": () => setCaptchaToken(""),
        });
      }
    };
    if (!document.querySelector(`script[src="${SRC}"]`)) {
      const sc = document.createElement("script");
      sc.src = SRC; sc.async = true; sc.defer = true; sc.onload = render;
      document.head.appendChild(sc);
    } else {
      render();
    }
  }, [siteKey, phase]);

  const effectiveCompanyCode = () => (defaultCode ?? companyCode).trim().toUpperCase();

  function validate(): boolean {
    const fe: Record<string, string> = {};
    if (!defaultCode && !companyCode.trim()) fe.company_code = "会社コードを入力してください。";
    if (!loginId.trim()) fe.login_id = "ログインIDを入力してください。";
    if (!EMAIL_RE.test(email.trim())) fe.email = "メールアドレスの形式が正しくありません。";
    if (!displayName.trim()) fe.display_name = "表示名を入力してください。";
    const pw = clientPwErrors(password);
    if (pw.length > 0) fe.password = `パスワードは${pw.join("・")}にしてください。`;
    else if (password !== confirm) fe.confirm = "パスワードが一致しません。";
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  }

  async function onSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    if (siteKey && !captchaToken) {
      setError("ボット対策の確認を完了してください。");
      return;
    }
    setPending(true);
    try {
      const res = await signup({
        company_code: defaultCode ?? companyCode,
        login_id: loginId.trim(),
        email: email.trim(),
        display_name: displayName.trim(),
        password,
        captcha_token: captchaToken || undefined,
      });
      // 列挙耐性＝一律 202。成否に関わらず認証コード入力へ進む（SEC B）。
      // PW は state に保持する（再送＝同入力で /signup を再POSTするため）。確定成功時に破棄。
      setMaskedTo(res?.masked_to ?? email.trim());
      setPhase("otp");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        // 形式不正（PW 最低文字数・email 形式）はフィールド直下へ。
        const errors = (err.body as { errors?: { field?: string; message?: string }[] } | null)?.errors ?? [];
        const fe: Record<string, string> = {};
        for (const x of errors) if (x.field) fe[x.field] = x.message ?? "入力内容をご確認ください。";
        setFieldErr(fe);
        if (errors.length === 0) setError("入力内容をご確認ください。");
      } else {
        setError("エラーが発生しました。時間をおいて再度お試しください。");
      }
    } finally {
      setPending(false);
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await signupVerify({
        company_code: defaultCode ?? companyCode,
        email: email.trim(),
        code: code.trim(),
      });
      if (res?.status === "created") {
        setPhase("done");
        // 自動ログインしない（SEC I）＝会社コード/ログインID をプリフィルして SC-00 ログインへ。
        const qs = new URLSearchParams({ company_code: res.company_code, login_id: res.login_id });
        setTimeout(() => router.push(`/login?${qs.toString()}`), 1500);
      } else {
        setError("認証コードが正しくありません。");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 410) {
          setError("認証コードの有効期限が切れたか、使用済みです。お手数ですが最初からやり直してください。");
        } else if (err.status === 400) {
          setError("認証コードが正しくありません。");
        } else {
          setError("エラーが発生しました。時間をおいて再度お試しください。");
        }
      } else {
        setError("エラーが発生しました。時間をおいて再度お試しください。");
      }
    } finally {
      setPending(false);
    }
  }

  async function onResend() {
    setResendInfo(null);
    setError(null);
    try {
      await signup({
        company_code: defaultCode ?? companyCode,
        login_id: loginId.trim(),
        email: email.trim(),
        display_name: displayName.trim(),
        // 再送は同入力で pending を置換。PW は OTP 段でも state 保持（確定成功時に破棄）。
        password: password || "",
        captcha_token: captchaToken || undefined,
      });
      setResendInfo("認証コードを再送しました。");
    } catch {
      setResendInfo("認証コードを再送しました。");
    }
  }

  return (
    <div className="login-page">
      <div>
        <div className="login-card">
          <div className="login-logo">
            <Image src="/assets/logo-ideaquest.png" alt="IDEAQUEST" width={185} height={84} priority />
          </div>
          <h1>アカウント作成</h1>

          {error && <div className="form-error" role="alert">{error}</div>}

          {/* CAPTCHA（Turnstile）＝site key 設定時のみ。入力/認証コード両フェーズで表示（再送のトークン用）。 */}
          {siteKey && phase !== "done" && (
            <div ref={captchaRef} className="cf-turnstile-box" style={{ margin: "var(--space-3) 0" }} />
          )}

          {phase === "form" && (
            <form onSubmit={onSubmitForm} noValidate>
              {!defaultCode && (
                <Field id="company_code" label="会社コード" required error={fieldErr.company_code}>
                  <input
                    id="company_code"
                    className="input"
                    autoComplete="organization"
                    placeholder="例: DEMO"
                    style={{ textTransform: "uppercase" }}
                    value={companyCode}
                    onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
                    required
                  />
                </Field>
              )}
              <Field id="login_id" label="ログインID" required error={fieldErr.login_id}>
                <input id="login_id" className="input" type="text" autoComplete="username"
                  value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
              </Field>
              <Field id="email" label="メールアドレス" required error={fieldErr.email}
                hint="認証コードをこのアドレスに送ります">
                <input id="email" className="input" type="email" autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field id="display_name" label="表示名" required error={fieldErr.display_name}>
                <input id="display_name" className="input" type="text" autoComplete="nickname"
                  value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              </Field>
              <Field id="password" label="パスワード" required hint="8文字以上" error={fieldErr.password}>
                <div className="pw-wrap">
                  <input id="password" className="input" type={showPw ? "text" : "password"}
                    autoComplete="new-password" value={password}
                    onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" className="pw-toggle"
                    aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
                    onClick={() => setShowPw((v) => !v)}>{showPw ? "🙈" : "👁"}</button>
                </div>
              </Field>
              <Field id="confirm" label="パスワード（確認）" required error={fieldErr.confirm}>
                <input id="confirm" className="input" type={showPw ? "text" : "password"}
                  autoComplete="new-password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
              <Button type="submit" variant="primary" block loading={pending}>
                {pending ? "送信中…" : "認証コードを送信"}
              </Button>
            </form>
          )}

          {phase === "otp" && (
            <>
              <p className="auth-lead">
                {maskedTo} 宛に認証コードを送信しました。コードを入力してアカウント作成を完了してください。
              </p>
              {resendInfo && <div className="auth-confirm">{resendInfo}</div>}
              <form onSubmit={onSubmitCode} noValidate>
                <Field id="code" label="認証コード（6桁）" required>
                  <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code"
                    placeholder="000000" value={code}
                    onChange={(e) => setCode(e.target.value)} required />
                </Field>
                <Button type="submit" variant="primary" block loading={pending}>
                  {pending ? "確認中…" : "アカウントを作成"}
                </Button>
              </form>
              <div className="login-links">
                <button type="button" className="linklike" onClick={() => void onResend()}>コードを再送信</button>
                <button type="button" className="linklike" onClick={() => { setPhase("form"); setCode(""); }}>
                  入力し直す
                </button>
              </div>
            </>
          )}

          {phase === "done" && (
            <p className="auth-confirm">
              アカウントを作成しました。ログイン画面へ移動します…
            </p>
          )}

          {phase === "form" && (
            <div className="login-links">
              <Link href="/login">すでにアカウントをお持ちの方はログイン</Link>
            </div>
          )}
        </div>
        <p className="login-foot">© ideaquest</p>
      </div>
    </div>
  );
}
