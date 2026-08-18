import { expect, test, type Page } from "@playwright/test";

// SC-11 クエスト作成＝URL 付きモーダル（Parallel Routes @modal ＋ Intercept Routes）のプロトタイプ相互作用 e2e。
// 根拠＝画面遷移図（登録/編集はモーダル・Next.js Parallel/Intercept）／コーディング規約 §4／フロントエンド実装フロー規約 §3・§8。
// backend 非依存（デモ・スタブ）。OPS でログインして /quests から開閉と直アクセス時のフルページ挙動を確認。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// 一覧からのソフト遷移＝モーダルで差し込まれ、Esc で閉じて一覧へ戻る。
test("quest-create URL modal opens from list and closes", async ({ page }) => {
  await login(page);
  await page.goto("/quests");
  await page.getByRole("link", { name: /クエストを作成/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /クエストを作成/ })).toBeVisible();
  await expect(page).toHaveURL(/\/quests\/new$/); // URL を持つモーダル

  await page.keyboard.press("Escape"); // Esc で閉じる → router.back()
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/quests$/);
});

// 直アクセス/リロードはフルページにフォールバック（モーダルではない）。
test("quest-create direct access renders full page (no modal)", async ({ page }) => {
  await login(page);
  await page.goto("/quests/new");
  await expect(page.getByRole("heading", { name: "クエスト作成" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
