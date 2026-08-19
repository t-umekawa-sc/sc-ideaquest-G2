import { expect, test, type Page } from "@playwright/test";

// SC-03 獲得履歴＝GET /me/activities（G.6）の backend 接続 e2e。
// 根拠＝doc/API設計/G_ゲーミフィケーション.md G.6・§1.8／フロントエンド実装フロー規約 §1.1。
// 担保＝(1) 履歴セクションが /me/activities の件数と一致（値ハードコードせず API と突合＝接続の証明）、
// (2) has_next のとき「もっと見る」でカーソル追加読込され行が増える。ref 解決（D/E）は範囲外。
const U = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(U.company);
  await page.locator("#login_id").fill(U.loginId);
  await page.locator("#password").fill(U.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

test("SC-03 activity history reflects GET /me/activities and paginates", async ({ page }) => {
  await login(page);
  // 認証済み Cookie で初回ページを取得（UI と突合）。ログイン XP で最低1件は存在する。
  const first = await page.request.get("/api/v1/me/activities?limit=8").then((r) => r.json());
  expect(first.data.length).toBeGreaterThan(0);

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "獲得履歴" })).toBeVisible();
  // 初回表示件数＝API の初回ページ件数と一致（接続の証明）。
  await expect(page.locator(".activity-item")).toHaveCount(first.data.length);

  if (first.page_info.has_next) {
    await page.getByRole("button", { name: "もっと見る" }).click();
    // カーソル追加読込で行が増える（新しい順・重複なしは backend 側テストで担保）。
    await expect(page.locator(".activity-item")).not.toHaveCount(first.data.length);
  }
});
