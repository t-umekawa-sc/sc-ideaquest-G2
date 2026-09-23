import { expect, test, type Page } from "@playwright/test";

const CREDS = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
// 全端末ログアウト（A-TC-022）は logout_all で当該アカウントの全セッションを破棄するため、
// 共有 user@acme を使うと並列ワーカ（同アカウントでログイン中の他 spec）を巻き込み
// session_expired が多発する。破棄系専用の隔離シード垢を使い衝突を断つ（bootstrap.py の
// SEED_E2E_SESSION_ACCOUNT・display_name「E2E セッション」）。
const LOGOUT_ALL_CREDS = { company: "ACME-01", loginId: "e2e-session@acme.example", password: "Passw0rd!", displayName: "E2E セッション" };

async function login(page: Page, creds: { company: string; loginId: string; password: string } = CREDS) {
  await page.goto("/login");
  await page.locator("#company_code").fill(creds.company);
  await page.locator("#login_id").fill(creds.loginId);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

// A-TC-020（doc/テスト/A_認証.md）: SC-00 で正資格情報→ログイン→SC-01(保護ページ)到達。
test("A-TC-020 login happy path reaches protected page", async ({ page }) => {
  await login(page);
});

// A-TC-021: 共通ヘッダーのユーザーメニュー→ログアウト→/login へ戻る。
test("A-TC-021 logout from header returns to login", async ({ page }) => {
  await login(page);
  // ユーザーメニューを開く（トリガーは display_name を含むボタン）
  await page.getByRole("button", { name: /テスト 太郎/ }).click();
  // 「全端末からログアウト」も「ログアウト」を含むため、可視テキスト完全一致で現端末のみを選ぶ。
  // （項目の accessible name には装飾カーソル ▶（design-system.css の ::before）が混入するため、
  //  accessible name の exact 一致ではなく innerText ベースの hasText を使う。）
  await page.getByRole("menuitem").filter({ hasText: /^ログアウト$/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#company_code")).toBeVisible();
});

// A-TC-022: ユーザーメニュー→「全端末からログアウト」→/login へ戻る（A.0-⑤ の導線）。
// 破棄系専用の隔離垢でログイン＝共有 user@acme の並列セッションを巻き込まない（e2e フレーク対策）。
test("A-TC-022 logout-all from header returns to login", async ({ page }) => {
  await login(page, LOGOUT_ALL_CREDS);
  await page.getByRole("button", { name: new RegExp(LOGOUT_ALL_CREDS.displayName) }).click();
  await page.getByRole("menuitem", { name: "全端末からログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#company_code")).toBeVisible();
});
