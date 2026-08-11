import { expect, test, type Page } from "@playwright/test";

// SC-93 会社アカウント管理者（自社アカウント管理・doc/テスト/B §13・API設計 B.2.1）。
// company_account_admin 専用＋system_admin 上位互換。e2e は OPS system_admin（上位互換）で /admin/accounts を検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };
const GENERAL = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page, c: { company: string; loginId: string; password: string }) {
  await page.goto("/login");
  await page.locator("#company_code").fill(c.company);
  await page.locator("#login_id").fill(c.loginId);
  await page.locator("#password").fill(c.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// B-TC-117: /admin/accounts（自社固定）で発行→一覧に現れる。
test("B-TC-117 own-company account issue appears", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "アカウント管理（自社）" })).toBeVisible();

  const loginId = `e2e-self-${Date.now().toString().slice(-8)}@ops.example`;
  await page.getByRole("button", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill("E2E 自社太郎");
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(loginId);
  await page.getByRole("button", { name: /発行する/ }).click();
  await expect(page.getByText(loginId)).toBeVisible();
});

// B-TC-118: 一般ユーザーは SC-93 に入れない（サーバーガード）。
test("B-TC-118 general user cannot access SC-93", async ({ page }) => {
  await login(page, GENERAL);
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/$/);
});
