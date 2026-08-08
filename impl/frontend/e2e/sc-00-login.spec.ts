import { expect, test } from "@playwright/test";

// A-TC-020（doc/テスト/A_認証.md）: SC-00 で正資格情報を入力→ログイン→SC-01(保護ページ)到達。
test("A-TC-020 login happy path reaches protected page", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#company_code").fill("ACME-01");
  await page.locator("#login_id").fill("user@acme.example");
  await page.locator("#password").fill("Passw0rd!");
  await page.getByRole("button", { name: "ログイン" }).click();

  await expect(page.getByText("ようこそ")).toBeVisible();
});
