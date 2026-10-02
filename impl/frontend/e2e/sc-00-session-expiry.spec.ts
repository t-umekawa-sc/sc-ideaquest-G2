import { expect, test } from "@playwright/test";
import { formLogin } from "./helpers";

// 認証フロー spec＝未認証で開始する（既定 storageState を使わない・e2e/auth.setup.ts）。
test.use({ storageState: { cookies: [], origins: [] } });

// セッション終了時の通知（デザイン標準 §14・A-TC-023〜025）。ログイン画面に戻された理由を info スナックバーで伝える。
// セキュリティ＝reason は固定文言 enum（生値は描画しない）・リダイレクト先は固定 /login。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

// A-TC-023 ログイン着地時に reason=session_expired でスナックバー＋query 除去。
test("A-TC-023 login?reason=session_expired shows snackbar and strips param", { tag: "@serial" }, async ({ page }) => {
  await page.goto("/login?reason=session_expired");
  await expect(page.getByText("セッションの有効期限が切れました")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/); // reason は表示後に除去

  // 未知の reason は通知を出さない（enum 以外は無視）。
  await page.goto("/login?reason=__bogus__");
  await page.waitForTimeout(400);
  await expect(page.getByText("セッションの有効期限が切れました")).toHaveCount(0);
});

// A-TC-024 セッション失効（無効な iq_session Cookie）→ 保護ページで自動リダイレクト＋通知。
test("A-TC-024 invalid session redirects to login with notice", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, USER);
  // iq_session を無効値へ差し替え（＝Cookie は存在するが失効）＝サーバ layout が理由付きでリダイレクト。
  await page.context().addCookies([{ name: "iq_session", value: "expired-bogus", domain: "localhost", path: "/" }]);
  await page.goto("/quests");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("セッションの有効期限が切れました")).toBeVisible();
});

// A-TC-025 ログアウトで通知。
test("A-TC-025 logout shows notice", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, USER);
  await page.getByRole("button", { name: /テスト 太郎/ }).click(); // ユーザーメニュー
  await page.getByRole("menuitem").filter({ hasText: /^ログアウト$/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("ログアウトしました")).toBeVisible();
});
