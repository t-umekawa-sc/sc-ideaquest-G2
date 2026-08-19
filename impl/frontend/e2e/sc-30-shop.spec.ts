import { expect, test, type Page } from "@playwright/test";

// SC-30 ショップ＝購入フローの回帰 e2e（デモ fixtures・装備/コイン backend 未接続）。
// 根拠＝doc/画面設計/screens/SC-30_ショップ.md・mocks/SC-30_ショップ.html／フロントエンド実装フロー規約 §3・§8。
// 担保範囲＝購入＝ゲーム確認ダイアログ（useConfirm）→ 残高減＋報酬スナックバー（useSnackbar・§14）／
// キャンセル（処理なし）ではスナックバーを出さない（デザイン標準 §14 の決定）。
// backend 非依存（購入はクライアント状態のみ）。OPS でログインして /shop を検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

async function gotoShop(page: Page) {
  await login(page);
  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: "ショップ", exact: true })).toBeVisible();
  await expect(page.locator(".wallet__num")).toHaveText("◆ 320"); // 初期残高
}

// 購入＝確認ダイアログ → 残高が減り、報酬スナックバーが出る（購入品は所有済みへ）。
test("purchase deducts balance and shows reward snackbar", async ({ page }) => {
  await gotoShop(page);
  const straw = page.locator('article[data-id="straw"]'); // 麦わら帽（◆20・未所有）

  await straw.getByRole("button", { name: "購入する" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /購入の確認/ })).toBeVisible();
  await dialog.getByRole("button", { name: "購入する" }).click(); // 確定

  await expect(page.getByText("装備を購入しました")).toBeVisible(); // 報酬スナックバー
  await expect(page.locator(".wallet__num")).toHaveText("◆ 300"); // 320 - 20
  await expect(straw.getByText("✓ 所有済み")).toBeVisible(); // 所有済みへ
});

// キャンセル（やめる）＝残高不変・スナックバーを出さない（処理が走っていない）。
test("cancel purchase keeps balance and shows no snackbar", async ({ page }) => {
  await gotoShop(page);
  const straw = page.locator('article[data-id="straw"]');

  await straw.getByRole("button", { name: "購入する" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "やめる" }).click(); // 取消

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".wallet__num")).toHaveText("◆ 320"); // 不変
  await expect(page.getByText("装備を購入しました")).toHaveCount(0); // スナックバーなし
});
