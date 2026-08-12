import { expect, test, type Page } from "@playwright/test";

// SC-92 アカウント編集（PATCH・doc/テスト/B §10・API設計 B.2）。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// B-TC-115: 発行したアカウントを編集して氏名を変更→一覧に反映（PATCH）。
test("B-TC-115 edit account display name", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: /アカウント/ })).toBeVisible();

  const stamp = Date.now().toString().slice(-8);
  const loginId = `e2e-edit-${stamp}@acme.example`;
  await page.getByRole("button", { name: "＋ アカウント発行" }).click();
  await page.locator("#a_name").fill("編集前太郎");
  await page.locator("#a_login").fill(loginId);
  await page.locator("#a_email").fill(loginId);
  await page.getByRole("button", { name: /発行する/ }).click();
  // 発行後は先頭ページに戻る＝検索で当該行を絞る（per_page=20・ページング/検索 UI 導入）。以後の検索状態は編集後の reload でも保持。
  const region = page.getByRole("region", { name: "この会社のアカウント管理" });
  await region.getByRole("searchbox", { name: "検索（氏名・ログインID・メール）" }).fill(loginId);
  await region.getByRole("button", { name: "検索" }).click();
  await expect(region.getByRole("row", { name: new RegExp(loginId) })).toBeVisible();

  const after = `編集後_${stamp}`;
  await region.getByRole("row", { name: new RegExp(loginId) }).getByRole("button", { name: "編集" }).click();
  await page.locator("#a_name").fill(after);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(region.getByRole("row", { name: new RegExp(loginId) }).getByText(after)).toBeVisible();
});
