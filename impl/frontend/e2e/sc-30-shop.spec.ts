import { expect, test, type Page } from "@playwright/test";

// SC-30 ショップ / SC-31 アバター（G 実接続）＝カタログ/コイン残高/所有・装備が実データ（getItems）で描画される。
// 購入/着せ替えの happy-path は backend G-TC-302/306 で担保（コイン/所有の前提が要るため e2e は実データ照合に限定）。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §2（G-TC-202/203）・API設計 G.1/G.2・SC-30/SC-31。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

test("G-TC-202 SC-30 shop renders real catalog and coin balance", async ({ page }) => {
  await login(page);
  const cat = await page.request.get("/api/v1/items").then((r) => r.json());
  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: "ショップ" })).toBeVisible();
  // コイン残高が実データ（デモ固定 ◆320 でない）。
  await expect(page.locator(".wallet__num")).toHaveText(`◆ ${cat.coin_balance}`);
  // 装備カードが 19 点（DataTable の perPage=24 で全件表示）。
  await expect(page.locator(".card.buy")).toHaveCount(19);
});

test("G-TC-203 SC-31 avatar renders real ownership", async ({ page }) => {
  await login(page);
  const cat = await page.request.get("/api/v1/items").then((r) => r.json());
  const unownedCount = cat.data.filter((i: { owned: boolean }) => !i.owned).length;
  await page.goto("/avatar");
  await expect(page.getByRole("heading", { name: "アバター / 着せ替え" })).toBeVisible();
  // 未所有アイテムは「🔒 ショップで購入」（実データ・件数一致）。
  await expect(page.locator(".item.is-locked")).toHaveCount(unownedCount);
});
