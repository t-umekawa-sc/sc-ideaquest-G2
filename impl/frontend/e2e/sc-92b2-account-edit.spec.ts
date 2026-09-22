import { expect, test, type Page } from "@playwright/test";

// SC-92 アカウント編集（PATCH・doc/テスト/B §10・API設計 B.2）。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

// B-TC-115: 発行したアカウントを編集して氏名を変更→一覧に反映（PATCH）。
test("B-TC-115 edit account display name", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click(); // 行クリックで会社詳細へ（§4.5⑪・操作は⋯RowMenu）
  await expect(page.getByRole("heading", { name: /アカウント/ })).toBeVisible();

  const stamp = Date.now().toString().slice(-8);
  const loginId = `e2e-edit-${stamp}@acme.example`;
  await page.getByRole("link", { name: "＋ アカウント発行" }).click();
  await page.locator("#a_name").fill("編集前太郎");
  await page.locator("#a_login").fill(loginId);
  await page.locator("#a_email").fill(loginId);
  await page.getByRole("button", { name: /発行する/ }).click();
  // 一覧は DataTable（client モード・ライブ検索）。発行後 reload の再マウント競合は toPass で吸収。
  const region = page.getByRole("region", { name: "この会社のアカウント管理" });
  await expect(async () => {
    await region.getByRole("searchbox").fill(loginId);
    await expect(region.getByRole("row", { name: new RegExp(loginId) })).toBeVisible({ timeout: 1000 });
  }).toPass();

  // 行アクションは RowMenu（⋯）＝操作メニューを開いて「所属・編集」
  const after = `編集後_${stamp}`;
  await region.getByRole("row", { name: new RegExp(loginId) }).getByRole("button", { name: "操作" }).click();
  await page.getByRole("menuitem", { name: "所属・編集" }).click();
  await page.locator("#a_name").fill(after);
  await page.getByRole("button", { name: "保存する" }).click();

  // 保存後 reload で検索欄がクリアされる＝再度 loginId で絞って新氏名を確認（toPass）
  await expect(async () => {
    await region.getByRole("searchbox").fill(loginId);
    await expect(region.getByRole("row", { name: new RegExp(loginId) }).getByText(after)).toBeVisible({ timeout: 1000 });
  }).toPass();
});

// B-TC-178: 編集で無変更保存＝更新 API を呼ばず info「変更はありません」（成功通知を誤発火しない・デザイン標準 §14）。
// 既存 seed アカウント（user@acme.example）を編集で開き、何も変えず保存＝mutation なし＝共有 seed を壊さない。
test("B-TC-178 no-change edit save shows info toast (no success, no mutation)", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click();
  await expect(page.getByRole("heading", { name: /アカウント/ })).toBeVisible();

  const region = page.getByRole("region", { name: "この会社のアカウント管理" });
  const seedLogin = "user@acme.example";
  await expect(async () => {
    await region.getByRole("searchbox").fill(seedLogin);
    await expect(region.getByRole("row", { name: new RegExp(seedLogin) })).toBeVisible({ timeout: 1000 });
  }).toPass();

  await region.getByRole("row", { name: new RegExp(seedLogin) }).getByRole("button", { name: "操作" }).click();
  await page.getByRole("menuitem", { name: "所属・編集" }).click();
  await expect(page.locator("#a_name")).toHaveValue(/.+/); // プリフィル完了＝スナップショット確定

  // 何も編集せず保存＝無変更判定で PATCH を呼ばず info トースト。
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("変更はありません")).toBeVisible();
  await expect(page.getByText("アカウントを更新しました")).toHaveCount(0);
});
