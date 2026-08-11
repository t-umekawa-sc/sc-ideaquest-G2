import { expect, test, type Page } from "@playwright/test";

// SC-92 クエストグループ CRUD（doc/テスト/B §12・API設計 B.3.1）。system_admin 専用。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// B-TC-116: グループ作成→リネーム→削除（空グループ）の縦通し。
test("B-TC-116 quest group create/rename/delete", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "クエストグループ" })).toBeVisible();

  const stamp = Date.now().toString().slice(-8);
  const code = `QG${stamp}`;
  const name = `グループ_${stamp}`;
  const renamed = `改名_${stamp}`;

  // 作成
  await page.getByRole("button", { name: "＋ グループ作成" }).click();
  await page.locator("#g_code").fill(code);
  await page.locator("#g_name").fill(name);
  await page.getByRole("button", { name: "作成する" }).click();
  await expect(page.getByText(code)).toBeVisible();

  // リネーム（prompt）
  page.once("dialog", (d) => d.accept(renamed));
  await page.getByRole("row", { name: new RegExp(code) }).getByRole("button", { name: "リネーム" }).click();
  await expect(page.getByText(renamed)).toBeVisible();

  // 削除（confirm・空グループ→204）
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row", { name: new RegExp(code) }).getByRole("button", { name: "削除" }).click();
  await expect(page.getByText(code)).toHaveCount(0);
});
