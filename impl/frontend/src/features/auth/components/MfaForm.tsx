"use client";

// SC-00 状態C（認証コード入力・MFA）。login が mfa_required を返した後に表示する。
// pre-auth（iq_preauth）中に mfa/verify で OTP を検証（CSRF＋Origin 必須＝apiFetch が iq_csrf を付与）。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { resendMfa, verifyMfa } from "../api";
import type { MfaChallenge } from "../types";
import "../auth.css";

type Props = {
  challenge: MfaChallenge;
  onRestart: (message?: string) => void;  // 状態Aへ戻す（pre-auth 失効・別IDでログイン）
};

export function MfaForm({ challenge, onRestart }: Props) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resendLeft, setResendLeft] = useState(challenge.resend_available_in);

  // 再送クールダウンのカウントダウン（0 になるまで「コードを再送信」を無効化）
  useEffect(() => {
    if (resendLeft <= 0) return;
    const t = setTimeout(() => setResendLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [resendLeft]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      const res = await verifyMfa(code, trustDevice);
      if (res?.status === "authenticated") {
        router.push("/");
        router.refresh();
        return;
      }
      setError("エラーが発生しました。時間をおいて再度お試しください。");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "otp_invalid") {
          const left = (err.body as { attempts_left?: number } | null)?.attempts_left;
          if (left === 0) {
            onRestart("認証に複数回失敗しました。お手数ですが最初からやり直してください。");
            return;
          }
          setError(`認証コードが正しくありません。${left != null ? `（残り ${left} 回）` : ""}`);
        } else if (err.code === "otp_expired") {
          setError("認証コードの有効期限が切れています。再送信してください。");
        } else if (err.code === "preauth_expired") {
          onRestart("認証の有効期限が切れました。お手数ですが最初からやり直してください。");
          return;
        } else {
          setError("エラーが発生しました。時間をおいて再度お試しください。");
        }
      } else {
        setError("エラーが発生しました。時間をおいて再度お試しください。");
      }
      setCode("");
    } finally {
      setPending(false);
    }
  }

  async function onResend() {
    setError(null);
    setInfo(null);
    try {
      const res = await resendMfa();
      if (res) {
        setResendLeft(res.resend_available_in);
        setInfo("認証コードを再送信しました。メールをご確認ください。");
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_limited") {
        setError("再送信はしばらくお待ちください。");
      } else if (err instanceof ApiError && err.code === "preauth_expired") {
        onRestart("認証の有効期限が切れました。お手数ですが最初からやり直してください。");
      } else {
        setError("再送信に失敗しました。時間をおいて再度お試しください。");
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>認証コードの入力</h1>

        <p className="auth-lead">
          登録メールアドレス（{challenge.masked_to}）宛に認証コードを送信しました。メールに記載の6桁のコードを入力してください。
        </p>

        {error && <div className="form-error">{error}</div>}
        {info && !error && <div className="auth-confirm">{info}</div>}

        <form onSubmit={onSubmit} noValidate>
          <Field id="otp_code" label="認証コード" required>
            <input
              id="otp_code"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              required
            />
          </Field>
          <label className="auth-check">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
            />
            このデバイスを信頼する（次回から認証コードを省略・共有端末では選ばないでください）
          </label>
          <Button type="submit" variant="primary" block disabled={pending}>
            {pending ? "認証中…" : "認証してログイン"}
          </Button>
        </form>

        <div className="login-links">
          <button
            type="button"
            className="linklike"
            onClick={onResend}
            disabled={resendLeft > 0}
          >
            {resendLeft > 0 ? `コードを再送信（${resendLeft}秒）` : "コードを再送信"}
          </button>
        </div>
        <div className="login-links">
          <button type="button" className="linklike" onClick={() => onRestart()}>
            別のIDでログイン
          </button>
        </div>
      </div>
    </div>
  );
}
