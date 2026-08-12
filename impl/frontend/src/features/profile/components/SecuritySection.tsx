"use client";

// K.3 セキュリティ操作（パスワード変更・メール変更）。いずれも現在PWで再認証。
// PW 変更成功＝全セッション破棄（A.9-③）＝要再ログイン→/login へ。メール変更はセッション維持。
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { changePassword, requestEmailChange } from "../api";
import "@/features/companies/companies.css";

function reauthMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "reauth_failed") return "現在のパスワードが正しくありません。";
    if (err.code === "validation_error") return "入力内容をご確認ください（現在のメールアドレスと同じ等）。";
    if (err.code === "conflict") return "このメールアドレスは既に使われています。";
  }
  return fallback;
}

export function SecuritySection() {
  const router = useRouter();
  // パスワード変更
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwPending, setPwPending] = useState(false);
  // メール変更
  const [newEmail, setNewEmail] = useState("");
  const [emailCurPw, setEmailCurPw] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (newPw !== confirmPw) {
      setPwError("新しいパスワードと確認用が一致しません。");
      return;
    }
    setPwPending(true);
    try {
      await changePassword({ current_password: curPw, new_password: newPw });
      // 全セッション破棄＝再ログインへ
      router.push("/login");
    } catch (err) {
      setPwError(reauthMessage(err, "パスワードの変更に失敗しました。"));
    } finally {
      setPwPending(false);
    }
  }

  async function onChangeEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailMsg(null);
    setEmailPending(true);
    try {
      await requestEmailChange({ new_email: newEmail, current_password: emailCurPw });
      // ダブルオプトイン（ADR-0008）＝この時点では未反映。新メールの確認リンクで確定。
      setEmailMsg(`確認メールを ${newEmail} に送信しました。メール内のリンクを開くと変更が確定します（未着の場合は迷惑メールもご確認ください）。`);
      setNewEmail("");
      setEmailCurPw("");
    } catch (err) {
      setEmailError(reauthMessage(err, "メールアドレスの変更に失敗しました。"));
    } finally {
      setEmailPending(false);
    }
  }

  return (
    <>
      <div className="card admin-create">
        <h2>パスワード変更</h2>
        {pwError && <div className="form-error" role="alert">{pwError}</div>}
        <form onSubmit={onChangePassword} noValidate>
          <Field id="cur_pw" label="現在のパスワード" required>
            <input id="cur_pw" className="input" type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
          </Field>
          <Field id="new_pw" label="新しいパスワード" required>
            <input id="new_pw" className="input" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </Field>
          <Field id="confirm_pw" label="新しいパスワード（確認）" required>
            <input id="confirm_pw" className="input" type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" disabled={pwPending}>
            {pwPending ? "変更中…" : "パスワードを変更（要再ログイン）"}
          </Button>
        </form>
      </div>

      <div className="card admin-create">
        <h2>メールアドレス変更</h2>
        <p className="admin-muted">新しいメールアドレス宛に確認リンクを送ります。リンクを開くまで変更は確定しません。</p>
        {emailError && <div className="form-error" role="alert">{emailError}</div>}
        {emailMsg && <p className="admin-muted" role="status">{emailMsg}</p>}
        <form onSubmit={onChangeEmail} noValidate>
          <Field id="new_email" label="新しいメールアドレス" required>
            <input id="new_email" className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
          </Field>
          <Field id="email_cur_pw" label="現在のパスワード（確認）" required>
            <input id="email_cur_pw" className="input" type="password" autoComplete="current-password" value={emailCurPw} onChange={(e) => setEmailCurPw(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" disabled={emailPending}>
            {emailPending ? "送信中…" : "確認メールを送信"}
          </Button>
        </form>
      </div>
    </>
  );
}
