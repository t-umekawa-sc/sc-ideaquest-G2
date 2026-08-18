"use client";

// SC-03 セキュリティ（K.3＝パスワード変更・メールアドレス変更）。いずれも現在PWで再認証。
// PW 変更成功＝全セッション破棄（A.9-③）＝要再ログイン→/login へ。メール変更はダブルオプトイン（ADR-0008）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-03_プロフィール.html（DoD＝モック一致）。
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { changePassword, requestEmailChange } from "../api";
import "@/features/companies/companies.css";
import "../profile.css";

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
      <div className="section-head"><h2>セキュリティ</h2></div>
      <section className="card" aria-label="セキュリティ">
        <div className="sec-sub">
          <h3>パスワード変更</h3>
          <p className="setting-row__desc" style={{ marginBottom: "var(--space-3)" }}>
            変更が完了すると<strong>すべての端末からログアウト</strong>されます（要再ログイン）。
          </p>
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

        <div className="sec-sub">
          <h3>メールアドレス変更</h3>
          <p className="setting-row__desc" style={{ marginBottom: "var(--space-3)" }}>
            <strong>新しいメールアドレス宛に確認リンク</strong>を送ります。リンクを開くまで変更は確定しません（旧アドレスには変更通知が届きます）。
          </p>
          {emailError && <div className="form-error" role="alert">{emailError}</div>}
          {emailMsg && <p className="admin-muted" role="status">{emailMsg}</p>}
          <form onSubmit={onChangeEmail} noValidate>
            <Field id="new_email" label="新しいメールアドレス" required>
              <input id="new_email" className="input" type="email" placeholder="例: yamada.new@across.example" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
            </Field>
            <Field id="email_cur_pw" label="現在のパスワード（確認）" required>
              <input id="email_cur_pw" className="input" type="password" autoComplete="current-password" value={emailCurPw} onChange={(e) => setEmailCurPw(e.target.value)} required />
            </Field>
            <Button type="submit" variant="primary" disabled={emailPending}>
              {emailPending ? "送信中…" : "確認メールを送信"}
            </Button>
          </form>
        </div>
      </section>

      <p className="role-note" style={{ marginTop: "var(--space-6)" }}>
        プロフィール（表示名・言語）は本人のみ編集できます。<strong>パスワード変更</strong>は現在のパスワードで再認証し、完了時に全端末からログアウトします（セキュリティ通知＋メールが届きます）。<strong>メールアドレス変更</strong>は新アドレスの確認リンクを開くまで確定しません（ダブルオプトイン）。ログインID・システムロール・残高（レベル/XP/コイン/SP）はこの画面では変更できません。<strong>3D アバターの着せ替え</strong>は「<Link href="/avatar">きせかえ</Link>」で行います。
      </p>
    </>
  );
}
