import { expect, test, type Page } from "@playwright/test";

// SC-92 メールアドレス確認（ADR-0009）＝未確認バッジ＋⋯「確認メールを送信」（B-TC-169）。
// 根拠＝doc/テスト/B_会社・アカウント.md §20・screens/SC-92。OPS system_admin（上位互換）で検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

test("B-TC-169 unverified badge and send verification action", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click();
  await expect(page.getByRole("heading", { name: /アカウント/ })).toBeVisible();

  // 新規発行＝発行直後は未確認。
  const stamp = Date.now().toString().slice(-8);
  const loginId = `e2e-ev-${stamp}@acme.example`;
  await page.getByRole("link", { name: "＋ アカウント発行" }).click();
  await page.locator("#a_name").fill("確認太郎");
  await page.locator("#a_login").fill(loginId);
  await page.locator("#a_email").fill(loginId);
  await page.getByRole("button", { name: /発行する/ }).click();

  const region = page.getByRole("region", { name: "この会社のアカウント管理" });
  await expect(async () => {
    await region.getByRole("searchbox").fill(loginId);
    await expect(region.getByRole("row", { name: new RegExp(loginId) })).toBeVisible({ timeout: 1000 });
  }).toPass();

  // 未確認バッジ。
  const row = region.getByRole("row", { name: new RegExp(loginId) });
  await expect(row.getByText("未確認", { exact: true })).toBeVisible();

  // ⋯「確認メールを送信」→確認ダイアログ→成功トースト。
  await row.getByRole("button", { name: "操作" }).click();
  await page.getByRole("menuitem", { name: "確認メールを送信" }).click();
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByText("確認メールを送信しました。")).toBeVisible();
});
