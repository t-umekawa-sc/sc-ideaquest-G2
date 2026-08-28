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

import { Button, Field, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { deleteAvatarImage, getMe, setAvatarImage, updateMe } from "../api";
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
  const snack = useSnackbar(); // 更新成功は他の更新系と同じ共通トースト（SnackbarProvider・(app) レイアウト）
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [locale, setLocale] = useState<"ja" | "en">("ja");
  const [animOff, setAnimOff] = useState(false); // アニメ演出を抑制（accounts.reduce_motion・§4.9）
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // プロフィール画像（アイコン）＝会社DB users.avatar_image_path（K.4・MinIO 署名URL）。
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const me = await getMe();
        if (me) {
          setProfile(me);
          setDisplayName(me.profile.display_name);
          setLocale(me.account.locale === "en" ? "en" : "ja");
          setAnimOff(!!me.account.reduce_motion);
          setAvatarUrl(me.profile.avatar_image_url ?? null);
        }
      } catch {
        setLoadError("プロフィールの取得に失敗しました。");
      }
    })();
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await updateMe({ display_name: displayName, locale, reduce_motion: animOff });
      if (updated) {
        setProfile(updated);
        setDisplayName(updated.profile.display_name);
      }
      snack({ type: "success", title: "プロフィールを更新しました" }); // 他の更新系と同じ通知
      router.refresh(); // 共通ヘッダーの表示名を更新（次のセッション読取で反映）
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? "入力内容をご確認ください。" : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (iconInputRef.current) iconInputRef.current.value = "";  // 同一ファイル再選択でも change を発火
    if (!file) return;
    setIconError(null);
    setIconBusy(true);
    try {
      const res = await setAvatarImage(file);  // PUT /me/avatar-image（K.4）
      if (res) setAvatarUrl(res.avatar_image_url);
      router.refresh();  // 共通ヘッダー等のアバターを更新
    } catch (err) {
      setIconError(err instanceof ApiError && err.status === 422
        ? "画像の形式またはサイズをご確認ください（PNG/JPEG/WebP/GIF・5MB まで）。"
        : "画像のアップロードに失敗しました。");
    } finally {
      setIconBusy(false);
    }
  }
  async function onClearIcon() {
    setIconError(null);
    setIconBusy(true);
    try {
      await deleteAvatarImage();  // DELETE /me/avatar-image
      setAvatarUrl(null);
      router.refresh();
    } catch {
      setIconError("画像の削除に失敗しました。");
    } finally {
      setIconBusy(false);
    }
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

        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">プロフィール画像（アイコン）</div>
            <div className="setting-row__desc">
              一覧・ランキング・コメントなどに表示される<strong>アイコン画像</strong>です（<strong>3D アバターとは別</strong>＝着せ替えは上の「きせかえ」）。未設定時は「頭文字＋カラー」で表示（画像アップロードは今後対応）。
            </div>
          </div>
          <div className="icon-field">
            <span className="quest-icon lg" style={{ ["--accent" as string]: "#2563EB" } as React.CSSProperties}>
              {avatarUrl ? (
                // 会社DB users のアイコン（K.4・短TTL 署名URL）＝素の img で描画。
                // eslint-disable-next-line @next/next/no-img-element
                <img className="quest-icon__img" src={avatarUrl} alt="" />
              ) : (
                <span className="quest-icon__char">{initial}</span>
              )}
            </span>
            <div className="icon-actions">
              <Button type="button" variant="outline" onClick={() => iconInputRef.current?.click()} disabled={iconBusy}>
                {iconBusy ? "処理中…" : "画像を選ぶ"}
              </Button>
              {avatarUrl && (
                <Button type="button" variant="outline" onClick={onClearIcon} disabled={iconBusy}>削除（既定に戻す）</Button>
              )}
              <input ref={iconInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickIcon} />
              {iconError && <div className="form-error" role="alert" style={{ marginTop: "var(--space-2)" }}>{iconError}</div>}
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
          {/* アニメーション演出の抑制（accounts.reduce_motion・デザイン標準 §4.9）。checked=動きを減らす。 */}
          <Field id="p_anim" label="アニメーション演出">
            <label className="checkbox">
              <input id="p_anim" type="checkbox" checked={animOff} onChange={(e) => setAnimOff(e.target.checked)} />
              <span>動きを減らす（カウントアップ・祝福・バースト等の演出を抑制する）</span>
            </label>
            <p className="hint">OS の「視差効果を減らす」が ON のときは、この設定に関わらず常に抑制されます。</p>
          </Field>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "保存中…" : "保存する"}
          </Button>
        </form>
      </section>
    </>
  );
}
