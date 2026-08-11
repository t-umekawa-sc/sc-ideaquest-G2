import { expect, test, type Page } from "@playwright/test";

// SC-92 アカウント & 所属（この会社）＝system_admin（doc/テスト/B §9・API設計 B.2/B.5）。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// B-TC-114: ACME-01 の会社詳細でアカウント発行→一覧に現れる（発行 EP＋一覧）。
test("B-TC-114 issue account appears in company account list", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  // ACME-01 の行の会社名リンクから詳細へ
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: /アカウント/ })).toBeVisible();
  // 既存 seed アカウントが見える
  await expect(page.getByText("user@acme.example")).toBeVisible();

  const newLogin = `e2e-${Date.now().toString().slice(-8)}@acme.example`;
  await page.getByRole("button", { name: "＋ アカウント発行" }).click();
  await page.locator("#a_name").fill("E2E 発行太郎");
  await page.locator("#a_login").fill(newLogin);
  await page.locator("#a_email").fill(newLogin);
  await page.getByRole("button", { name: /発行する/ }).click();

  await expect(page.getByText(newLogin)).toBeVisible();
});
