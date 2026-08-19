"use client";

// SC-03 プロフィール（本人）＝アカウント情報＋残高（読取）＋プロフィール編集（表示名・言語・アイコン）。
// レイアウト/コピーの正＝doc/画面設計/mocks/SC-03_プロフィール.html（DoD＝モック一致）。API＝K.1/K.2。
// identity 源泉は accounts（PATCH /me→outbox で users ミラー）。login_id/email/system_role は読み取り専用
// （email/PW 変更は K.3＝SecuritySection）。残高（Lv/XP/コイン/SP）は表示のみ（canonical は G）。
// ・3D アバター（VRM）は読取表示＝着せ替えは SC-31（ドメイン G）。プロフィール画像（アイコン）とは別物。
// ・残高は GET /me 残高の接続まで demo 値（フロントエンド実装フロー規約＝mock 先行・接続時に api へ差替）。
// ・プロフィール画像は MinIO 基盤前提＝ローカルプレビューのみ（送信しない）。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { getMe, updateMe } from "../api";
import type { MeProfile } from "../types";
import "@/features/companies/companies.css";
import "../profile.css";

const ROLE_LABEL: Record<string, string> = {
  general: "一般",
  company_account_admin: "会社アカウント管理者",
  system_admin: "システム管理者",
};

// 3Dアバター表示グループ＋残高は上部のゲーム風パネル（ProfileHero・profile/page）へ分離。
// 本コンポーネントは identity（読取）＋プロフィール編集（表示名/言語/アイコン）を担う。
export function ProfileForm({ companyCode }: { companyCode: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [locale, setLocale] = useState<"ja" | "en">("ja");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // プロフィール画像（アイコン）のローカルプレビュー（MinIO 未接続＝送信しない仮実装）。
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const me = await getMe();
        if (me) {
          setProfile(me);
          setDisplayName(me.profile.display_name);
          setLocale(me.account.locale === "en" ? "en" : "ja");
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
        setDisplayName(updated.profile.display_name);
      }
      setSaved(true);
      router.refresh(); // 共通ヘッダーの表示名を更新（次のセッション読取で反映）
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? "入力内容をご確認ください。" : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(URL.createObjectURL(file));
  }
  function onClearIcon() {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  }

  if (loadError) return <div className="form-error" role="alert">{loadError}</div>;
  if (!profile) return <p className="admin-muted">読み込み中…</p>;

  const roleLabel = ROLE_LABEL[profile.system_role] ?? profile.system_role;
  const initial = displayName.trim().charAt(0) || "?";

  return (
    <>
      <p className="admin-sub">
        あなたの<strong>表示名・プロフィール画像・言語</strong>と<strong>セキュリティ（パスワード・メールアドレス）</strong>を管理します。
        （<strong>3D アバターの着せ替え</strong>は「きせかえ」、<strong>背景画像</strong>はヘッダーのユーザーメニューから設定できます）
      </p>

      {/* ユーザ情報（identity・読取専用・GET /me）。3Dアバター表示グループ＋残高は上部パネルへ分離。 */}
      <div className="section-head"><h2>ユーザ情報</h2></div>
      <section className="card" aria-label="ユーザ情報">
        <dl className="kv">
          <dt>会社</dt><dd className="db-id">{companyCode}</dd>
          <dt>ログインID</dt><dd className="db-id">{profile.account.login_id}</dd>
          <dt>メールアドレス</dt><dd className="db-id">{profile.account.email}</dd>
          <dt>システムロール</dt><dd>{roleLabel}</dd>
        </dl>
        <div className="provision-note">
          ログインID は変更できません。<strong>メールアドレス・パスワード</strong>の変更は下の「セキュリティ」から（現在のパスワードで再認証）。
          <strong>レベル・XP・コイン・スキルポイント</strong>は活動で増減します（表示のみ）。<strong>3D アバターの装備（着せ替え）</strong>は
          「<Link href="/avatar">きせかえ</Link>」で変更します。
        </div>
      </section>

      {/* プロフィール編集（表示名・言語・アイコン＝PATCH /me・PUT/DELETE /me/avatar-image） */}
      <div className="section-head"><h2>プロフィール編集</h2></div>
      <section className="card" aria-label="プロフィール編集">
        {error && <div className="form-error" role="alert">{error}</div>}
        {saved && <p className="admin-muted" role="status">保存しました。</p>}

        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">プロフィール画像（アイコン）</div>
            <div className="setting-row__desc">
              一覧・ランキング・コメントなどに表示される<strong>アイコン画像</strong>です（<strong>3D アバターとは別</strong>＝着せ替えは上の「きせかえ」）。未設定時は「頭文字＋カラー」で表示（画像アップロードは今後対応）。
            </div>
          </div>
          <div className="icon-field">
            <span className="quest-icon lg" style={{ ["--accent" as string]: "#2563EB" } as React.CSSProperties}>
              {iconPreview ? (
                // 送信しないローカルプレビュー（objectURL）＝素の img で描画。
                // eslint-disable-next-line @next/next/no-img-element
                <img className="quest-icon__img" src={iconPreview} alt="" />
              ) : (
                <span className="quest-icon__char">{initial}</span>
              )}
            </span>
            <div className="icon-actions">
              <Button type="button" variant="outline" onClick={() => iconInputRef.current?.click()}>画像を選ぶ</Button>
              {iconPreview && (
                <Button type="button" variant="outline" onClick={onClearIcon}>削除（既定に戻す）</Button>
              )}
              <input ref={iconInputRef} type="file" accept="image/*" hidden onChange={onPickIcon} />
            </div>
          </div>
        </div>

        <form onSubmit={onSave} noValidate style={{ marginTop: "var(--space-4)" }}>
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
      </section>
    </>
  );
}
