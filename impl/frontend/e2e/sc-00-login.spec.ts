import { expect, test, type Page } from "@playwright/test";

const CREDS = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(CREDS.company);
  await page.locator("#login_id").fill(CREDS.loginId);
  await page.locator("#password").fill(CREDS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
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
  // 「全端末からログアウト」も「ログアウト」を部分一致で含むため exact で現端末のみを選ぶ。
  await page.getByRole("menuitem", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#company_code")).toBeVisible();
});

// A-TC-022: ユーザーメニュー→「全端末からログアウト」→/login へ戻る（A.0-⑤ の導線）。
test("A-TC-022 logout-all from header returns to login", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /テスト 太郎/ }).click();
  await page.getByRole("menuitem", { name: "全端末からログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#company_code")).toBeVisible();
});
