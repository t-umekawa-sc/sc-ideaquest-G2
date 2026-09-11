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
import { deleteAvatarImage, deleteIdeaIconImage, getMe, setAvatarImage, setIdeaIconImage, updateMe } from "../api";
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
  const [mascotFollow, setMascotFollow] = useState(true); // アバター追従アニメ表示（accounts.mascot_follow・#20・既定 true）
  // ゲームモード個人上書き（accounts.game_mode_override・§4.11・レビュー#2）。三値＝null(会社設定に従う)/true/false。
  const [gameOverride, setGameOverride] = useState<boolean | null>(null);
  const [gameCompanyDefault, setGameCompanyDefault] = useState(true); // 会社既定（補足表示用）
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null); // §4b 表示名のインラインエラー（赤枠＋メッセージ）
  // プロフィール画像（アイコン）＝会社DB users.avatar_image_path（K.4・MinIO 署名URL）。
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  // アイデア用アイコン（既定・アバターとは別・Phase 2）＝会社DB users.idea_icon_image_path（K.4 署名URL）。
  const [ideaIconUrl, setIdeaIconUrl] = useState<string | null>(null);
  const [ideaIconBusy, setIdeaIconBusy] = useState(false);
  const [ideaIconError, setIdeaIconError] = useState<string | null>(null);
  const ideaIconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const me = await getMe();
        if (me) {
          setProfile(me);
          setDisplayName(me.profile.display_name);
          setLocale(me.account.locale === "en" ? "en" : "ja");
          setAnimOff(!!me.account.reduce_motion);
          setMascotFollow(me.account.mascot_follow ?? true);
          setGameOverride(me.game_mode.override ?? null);
          setGameCompanyDefault(me.game_mode.company_default);
          setAvatarUrl(me.profile.avatar_image_url ?? null);
          setIdeaIconUrl(me.profile.idea_icon_image_url ?? null);
        }
      } catch {
        setLoadError("プロフィールの取得に失敗しました。");
      }
    })();
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // §4b クライアント検証＝表示名は必須（空送信で無反応にせず該当フィールドを赤く）。
    if (!displayName.trim()) {
      setNameErr("表示名を入力してください。");
      setError("入力内容をご確認ください。");
      return;
    }
    setNameErr(null);
    setSaving(true);
    try {
      // mascot_follow は「動きを減らす」ON でも**保存値としては保持**（抑制解除で元の設定に戻る）。実効表示は
      // MascotFollower 側で「follow かつ 非抑制」で判定するため、ここでは disabled 表示に関わらず本人の設定値を送る。
      // game_mode_override は三値（null＝会社設定に従う）を明示送信＝backend が上書きクリアとして受理（§4.11）。
      const updated = await updateMe({
        display_name: displayName, locale, reduce_motion: animOff, mascot_follow: mascotFollow,
        game_mode_override: gameOverride,
      });
      if (updated) {
        setProfile(updated);
        setDisplayName(updated.profile.display_name);
        setGameOverride(updated.game_mode.override ?? null);
        setGameCompanyDefault(updated.game_mode.company_default);
      }
      snack({ type: "success", title: "プロフィールを更新しました" }); // 他の更新系と同じ通知
      router.refresh(); // 共通ヘッダーの表示名を更新（次のセッション読取で反映）
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_error") {
        setError("入力内容をご確認ください。");
        setNameErr("表示名をご確認ください。");
      } else {
        setError("保存に失敗しました。");
      }
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
      snack({ type: "success", title: "プロフィール画像を更新しました" }); // 他の更新系と同じ通知
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
      snack({ type: "success", title: "プロフィール画像を削除しました", msg: "既定（頭文字）に戻しました。" }); // 他の更新系と同じ通知
      router.refresh();
    } catch {
      setIconError("画像の削除に失敗しました。");
    } finally {
      setIconBusy(false);
    }
  }

  async function onPickIdeaIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (ideaIconInputRef.current) ideaIconInputRef.current.value = "";
    if (!file) return;
    setIdeaIconError(null);
    setIdeaIconBusy(true);
    try {
      const res = await setIdeaIconImage(file);  // PUT /me/idea-icon-image（K.4・Phase 2）
      if (res) setIdeaIconUrl(res.idea_icon_image_url);
      snack({ type: "success", title: "アイデア用アイコンを更新しました" });
      router.refresh();  // 一覧/カード/チャットのアイデアアイコンを更新
    } catch (err) {
      setIdeaIconError(err instanceof ApiError && err.status === 422
        ? "画像の形式またはサイズをご確認ください（PNG/JPEG/WebP/GIF・5MB まで）。"
        : "画像のアップロードに失敗しました。");
    } finally {
      setIdeaIconBusy(false);
    }
  }
  async function onClearIdeaIcon() {
    setIdeaIconError(null);
    setIdeaIconBusy(true);
    try {
      await deleteIdeaIconImage();  // DELETE /me/idea-icon-image
      setIdeaIconUrl(null);
      snack({ type: "success", title: "アイデア用アイコンを削除しました", msg: "既定（件名の先頭1文字）に戻しました。" });
      router.refresh();
    } catch {
      setIdeaIconError("画像の削除に失敗しました。");
    } finally {
      setIdeaIconBusy(false);
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

        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">アイデア用アイコン（既定）</div>
            <div className="setting-row__desc">
              あなたが作る<strong>アイデアの共通マーク</strong>です（<strong>プロフィール画像とは別</strong>）。チャット上部・ダッシュボード/クエストのカード・一覧に表示されます。未設定時は<strong>件名の先頭1文字＋クエストカラー</strong>で表示。個別のアイデアに別アイコンを付けたい場合はアイデア編集で設定します（今後対応）。
            </div>
          </div>
          <div className="icon-field">
            <span className="quest-icon lg" style={{ ["--accent" as string]: "#2563EB" } as React.CSSProperties}>
              {ideaIconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="quest-icon__img" src={ideaIconUrl} alt="" />
              ) : (
                <span className="quest-icon__char">💡</span>
              )}
            </span>
            <div className="icon-actions">
              <Button type="button" variant="outline" onClick={() => ideaIconInputRef.current?.click()} disabled={ideaIconBusy}>
                {ideaIconBusy ? "処理中…" : "画像を選ぶ"}
              </Button>
              {ideaIconUrl && (
                <Button type="button" variant="outline" onClick={onClearIdeaIcon} disabled={ideaIconBusy}>削除（既定に戻す）</Button>
              )}
              <input ref={ideaIconInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickIdeaIcon} />
              {ideaIconError && <div className="form-error" role="alert" style={{ marginTop: "var(--space-2)" }}>{ideaIconError}</div>}
            </div>
          </div>
        </div>

        <form onSubmit={onSave} noValidate style={{ marginTop: "var(--space-4)" }}>
          <Field id="p_name" label="表示名" required error={nameErr}>
            <input id="p_name" className="input" value={displayName} onChange={(e) => { setDisplayName(e.target.value); if (nameErr) setNameErr(null); }} required />
          </Field>
          <Field id="p_locale" label="言語">
            <select id="p_locale" className="select" value={locale} onChange={(e) => setLocale(e.target.value as "ja" | "en")}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </Field>
          {/* アニメーション演出の抑制（accounts.reduce_motion・デザイン標準 §4.9）。checked=動きを減らす。 */}
          <Field id="p_anim" label="アニメーション演出">
            {/* style-guide.html / DataTable と同じ素テキスト構造（<input>{" "}ラベル）。span で包むと先頭スペース分の
                間隔が消えて文字が近づくため使わない（.checkbox は gap:10px＋先頭スペースで間隔を作る）。 */}
            <label className="checkbox">
              <input id="p_anim" type="checkbox" checked={animOff} onChange={(e) => setAnimOff(e.target.checked)} />{" "}
              動きを減らす（カウントアップ・祝福・バースト等の演出を抑制する）
            </label>
            <p className="hint">OS の「視差効果を減らす」が ON のときは、この設定に関わらず常に抑制されます。</p>
            {/* 追従アニメの ON/OFF（#20・かなり目立つのでこれだけ個別に切れる）。「動きを減らす」ON のときは
                自動 OFF＝操作不可（disabled）。表示は off だが保存値 mascotFollow は保持（抑制解除で元に戻る）。 */}
            <label className="checkbox" style={{ marginTop: "var(--space-3)" }}>
              <input
                id="p_mascot"
                type="checkbox"
                checked={!animOff && mascotFollow}
                disabled={animOff}
                onChange={(e) => setMascotFollow(e.target.checked)}
              />{" "}
              ダッシュボードでアバターが追従するアニメーションを表示する
            </label>
            <p className="hint">
              ダッシュボードでアバターがカードに追従します。かなり目立つ演出です。
              {animOff && "「動きを減らす」が ON のため、自動的にオフになっています。"}
            </p>
          </Field>
          {/* ゲームモード（accounts.game_mode_override・§4.11・レビュー#2）。3選セグメント＝会社設定に従う/ON/OFF。
              null＝会社設定に従う（会社既定を継承）／true＝ON／false＝OFF。実効値の補足を下に出す。 */}
          <Field id="p_gamemode" label="ゲームモード">
            <div className="segmented" role="radiogroup" aria-label="ゲームモード">
              <label>
                <input type="radio" name="game-mode" checked={gameOverride === null}
                       onChange={() => setGameOverride(null)} />会社設定に従う
              </label>
              <label>
                <input type="radio" name="game-mode" checked={gameOverride === true}
                       onChange={() => setGameOverride(true)} />ON
              </label>
              <label>
                <input type="radio" name="game-mode" checked={gameOverride === false}
                       onChange={() => setGameOverride(false)} />OFF
              </label>
            </div>
            <p className="segmented-note">
              {gameOverride === null
                ? `会社設定に従う（現在：${gameCompanyDefault ? "ON" : "OFF"}）`
                : gameOverride
                  ? "ゲーム層（ショップ・きせかえ・魔法・実績・ランキング・演出）を表示します。"
                  : "ゲーム層を非表示にします（アバター画像は本人識別のため残ります）。"}
            </p>
            <p className="hint">OFF にするとゲーム要素（ショップ/きせかえ/魔法・実績・ランキング・演出・ゲーム系通知）が隠れます。獲得したXP/コインは保持され、ON に戻すと再び表示されます。</p>
          </Field>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "保存中…" : "保存する"}
          </Button>
        </form>
      </section>
    </>
  );
}
