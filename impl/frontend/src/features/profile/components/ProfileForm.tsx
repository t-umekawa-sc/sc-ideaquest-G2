"use client";

// K プロフィール編集（表示名・ロケール）。identity 源泉は accounts（PATCH /me→outbox で users ミラー）。
// login_id/email/system_role は読み取り専用（email/PW 変更は K.3・別画面）。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getMe, updateMe } from "../api";
import type { MeProfile } from "../types";
import "@/features/companies/companies.css";

const ROLE_LABEL: Record<string, string> = {
  general: "一般",
  company_account_admin: "会社アカウント管理者",
  system_admin: "システム管理者",
};

export function ProfileForm() {
  const router = useRouter();
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [locale, setLocale] = useState<"ja" | "en">("ja");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const me = await getMe();
        if (me) {
          setProfile(me);
          setDisplayName(me.display_name);
          setLocale(me.locale === "en" ? "en" : "ja");
        }
      } catch {
        setLoadError("プロフィールの取得に失敗しました。");
      }
    })();
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateMe({ display_name: displayName, locale });
      if (updated) {
        setProfile(updated);
        setDisplayName(updated.display_name);
      }
      setSaved(true);
      router.refresh(); // 共通ヘッダーの表示名を更新（次のセッション読取で反映）
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? "入力内容をご確認ください。" : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <div className="form-error" role="alert">{loadError}</div>;
  if (!profile) return <p className="admin-muted">読み込み中…</p>;

  return (
    <section aria-label="プロフィール">
      <h1>プロフィール</h1>
      <p className="admin-muted">
        ログインID <span className="admin-code">{profile.login_id}</span>
        {" ・ "}メール <span className="admin-code">{profile.email}</span>
        {" ・ "}{ROLE_LABEL[profile.system_role] ?? profile.system_role}
      </p>

      {error && <div className="form-error" role="alert">{error}</div>}
      {saved && <p className="admin-muted" role="status">保存しました。</p>}

      <form className="admin-create card" onSubmit={onSave} noValidate>
        <Field id="p_name" label="表示名" required>
          <input id="p_name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </Field>
        <Field id="p_locale" label="言語">
          <select id="p_locale" className="input" value={locale} onChange={(e) => setLocale(e.target.value as "ja" | "en")}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "保存中…" : "保存する"}
        </Button>
      </form>

      <p className="admin-muted">※ メールアドレス・パスワードの変更は下の「セキュリティ」で行えます（現在のパスワードで再認証）。</p>
    </section>
  );
}
