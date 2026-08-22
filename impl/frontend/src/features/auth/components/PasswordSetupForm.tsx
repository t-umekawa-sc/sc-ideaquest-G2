"use client";

// SC-00 状態B（初回/再設定パスワード設定・メールリンク起点）。
// 表示前に verify（410 は期限切れ表示）→ 有効なら新PW＋確認 → complete。
// PWポリシー（8文字＋英字＋数字・ADR-0002 §2.2）はクライアント補助検証。最終判断はサーバ（422 errors[]）。
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { completePasswordSetup, verifyPasswordSetup } from "../api";
import type { FieldError } from "../types";
import "../auth.css";

// クライアント補助検証（サーバの password_policy_errors と同ポリシー）。空配列＝適合。
function clientPolicyErrors(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < 8) out.push("8文字以上");
  if (!/[A-Za-z]/.test(pw)) out.push("英字を1文字以上");
  if (!/[0-9]/.test(pw)) out.push("数字を1文字以上");
  return out;
}

type Phase = "verifying" | "invalid" | "ready" | "done";

export function PasswordSetupForm({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setPhase("invalid");
      return;
    }
    let alive = true;
    verifyPasswordSetup(token)
      .then((res) => {
        if (!alive) return;
        setPhase(res?.valid ? "ready" : "invalid");
      })
      .catch(() => {
        // 410 token_expired も含め、無効はすべて再要求案内へ倒す。
        if (alive) setPhase("invalid");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPwError(null);
    setConfirmError(null);

    const policy = clientPolicyErrors(password);
    if (policy.length > 0) {
      setPwError(`パスワードは${policy.join("・")}にしてください。`);
      return;
    }
    if (password !== confirm) {
      setConfirmError("パスワードが一致しません。");
      return;
    }

    setPending(true);
    try {
      await completePasswordSetup(token, password);
      setPhase("done");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 410) {
          setPhase("invalid");
          return;
        }
        if (err.status === 422) {
          // サーバ最終判断（errors[]）をフィールド直下に反映。
          const errors = (err.body as { errors?: FieldError[] } | null)?.errors ?? [];
          const msg = errors.map((x) => x.message).join(" ");
          setPwError(msg || "パスワードがポリシーを満たしません。");
          return;
        }
      }
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
        <h1>パスワード設定</h1>

        {phase === "verifying" && <p className="auth-lead">リンクを確認しています…</p>}

        {phase === "invalid" && (
          <>
            <div className="form-error">
              パスワード設定リンクの有効期限が切れているか、すでに使用されています。お手数ですが、再度お手続きいただくか、管理者にお問い合わせください。
            </div>
            <div className="login-links">
              <Link href="/password-reset">再設定をリクエストする</Link>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <p className="auth-confirm">パスワードを設定しました。ログイン画面からログインしてください。</p>
            <Link href="/login" className="btn btn-primary btn-block">
              ログインへ
            </Link>
          </>
        )}

        {phase === "ready" && (
          <>
            <p className="auth-lead">新しいパスワードを設定してください。設定後はログイン画面からログインできます。</p>

            {error && <div className="form-error">{error}</div>}

            <form onSubmit={onSubmit} noValidate>
              <Field
                id="new_password"
                label="新しいパスワード"
                required
                hint="8文字以上・英字と数字を含む"
                error={pwError}
              >
                <div className="pw-wrap">
                  <input
                    id="new_password"
                    className="input"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="新しいパスワード"
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
              <Field id="confirm_password" label="新しいパスワード（確認）" required error={confirmError}>
                <input
                  id="confirm_password"
                  className="input"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="もう一度入力"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="primary" block loading={pending}>
                {pending ? "送信中…" : "パスワードを設定してはじめる"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
