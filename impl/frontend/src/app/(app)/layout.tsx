// 認証後グループのレイアウト。未認証は /login へ。共通ヘッダー（app-shell）を全画面に敷く。
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ConfirmProvider, SnackbarProvider } from "@/components/ui";
import { LogoutAllMenuItem, LogoutMenuItem } from "@/features/auth";
import { LiveAppHeader, RealtimeProvider } from "@/features/notifications";
import { BackgroundImageMenuItem } from "@/features/profile";
import { getServerMe, headerBalance } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode; // Parallel Route スロット（@modal）＝URL 付きモーダル（Intercept Routes）の差し込み先
}) {
  const session = await getServerSession();
  if (!session) {
    // 「無効な iq_session Cookie が存在した時のみ」＝期限切れとして通知（未ログイン直アクセスは無言）。
    // reason は非機密 enum・リダイレクト先は固定 /login（デザイン標準 §14・セキュリティ）。
    const hadSession = (await cookies()).has("iq_session");
    redirect(hadSession ? "/login?reason=session_expired" : "/login");
  }
  // 残高（Lv/コイン/SP）＝GET /me（K.1・接続済み）。通知未読数（H）は未接続のため 0（H 接続で差替）。
  const me = await getServerMe();
  const balance = me ? headerBalance(me.balance) : undefined;
  // ゲームモード実効値（レビュー#2・§4.11）＝GET /me の game_mode.effective（= override ?? company_default）。
  // false でゲーム層UI（ナビのゲーム群・ヘッダー残高/円環・ゲーム系通知/演出）を非表示。既定 true（me 取得不可時も）。
  const gameEnabled = me?.game_mode.effective ?? true;
  const backgroundUrl = me?.profile.background_image_url ?? null;  // K.4・全認証画面に反映（FR-30）
  // ヘッダーのユーザーアイコン/表示名は GET /me を源泉にする（アバター/表示名の変更が router.refresh で即反映。
  // session.user はログイン時スナップショットで陳腐化するため）。me 取得不可時のみ session へフォールバック。
  const headerUser = {
    display_name: me?.profile.display_name ?? session.user.display_name,
    avatar_url: me?.profile.avatar_image_url ?? null,
  };
  return (
    <SnackbarProvider>
     <ConfirmProvider>
      {/* リアルタイム（L）＝ヘッダーベルの未読数を WS で即時更新。初期値は provider が getUnreadCount で seed。 */}
      <RealtimeProvider>
      {/* アニメ抑制のルート（デザイン標準 §4.9）＝GET /me の account.reduce_motion で立てる。
          CSS のキルスイッチ `[data-anim-reduced="true"] *` と JS の reduceMotion() が本要素を参照。
          header/main/modal すべてを内包（サーバー描画＝フラッシュ無し）。OS reduce は別途 @media で担保。 */}
      <div data-anim-reduced={me?.account.reduce_motion ? "true" : undefined}>
      {/* コンテンツ背景（ユーザー個人設定・全認証画面に反映・K.4）。設定時は署名URL を敷き薄スクリム（.is-set）。 */}
      <div
        className={backgroundUrl ? "app-bg is-set" : "app-bg"}
        aria-hidden="true"
        style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
      />
      {/* 管理導線（ロール保持者のみ）はサイドバー（AppNav）に集約。右上メニュー・ダッシュボードからは撤去。 */}
      <LiveAppHeader
        user={headerUser}
        balance={balance}
        gameEnabled={gameEnabled}
        admin={{
          systemAdmin: session.system_role === "system_admin",
          companyAdmin: session.system_role === "company_account_admin",
          qgAdmin: session.is_qg_admin,
        }}
      >
        {/* メニュー項目は app 層が features から差し込む */}
        <li role="none">
          <Link role="menuitem" href="/profile">プロフィール</Link>
        </li>
        {/* アバター/着せ替えはゲーム層＝ゲームモード OFF では非表示（§4.11・ナビのゲーム群と整合）。 */}
        {gameEnabled && (
          <li role="none">
            <Link role="menuitem" href="/avatar">アバター / 着せ替え</Link>
          </li>
        )}
        {/* 背景画像の変更／リセット（K.4・FR-30・全認証画面に反映） */}
        <BackgroundImageMenuItem hasBackground={backgroundUrl !== null} />
        <li role="none"><div className="usermenu__sep" /></li>
        <li role="none">
          <LogoutMenuItem />
        </li>
        <li role="none">
          <LogoutAllMenuItem />
        </li>
      </LiveAppHeader>
      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        {children}
      </main>
      {modal}
      </div>
      </RealtimeProvider>
     </ConfirmProvider>
    </SnackbarProvider>
  );
}
