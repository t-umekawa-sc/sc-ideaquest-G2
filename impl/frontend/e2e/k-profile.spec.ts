import { expect, test, type Page } from "@playwright/test";

// K プロフィール編集（doc/テスト/K_プロフィール.md §2・API設計 K.1/K.2）。
// ヘッダーメニュー名に依存するテスト（sc-00 の ACME-01 ユーザー）を壊さないよう、本人編集は OPS 管理者で検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// K-TC-006: 自分のプロフィール（表示名）を編集→保存→GET /me で永続。
test("K-TC-006 edit own profile persists", async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
  await expect(page.locator("#p_name")).toBeVisible(); // GET /me が読み込めている

  const newName = `プロフ_${Date.now().toString().slice(-8)}`;
  await page.locator("#p_name").fill(newName);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("保存しました。")).toBeVisible();

  await page.reload();
  await expect(page.locator("#p_name")).toHaveValue(newName); // GET /me が更新値を返す
});
