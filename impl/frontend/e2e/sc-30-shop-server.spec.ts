import { expect, test, type Page } from "@playwright/test";

// SC-30 ショップ一覧＝DataTable サーバーモード委譲（§1.8.1・G.1）。検索/ソート/絞込/ページを GET /items に委譲し、
// 状態は ?sc30-shop.* に同期して詳細往復で復元（一覧共通契約）。サーバー委譲は /items リクエストのクエリで確認。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md（G-TC-318）／デザイン標準 §4.5⑨／API設計 G.1・§1.8.1。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

test("G-TC-318 shop delegates sort to server and restores state via URL", async ({ page }) => {
  const itemReqs: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/v1/items?")) itemReqs.push(r.url()); });

  await login(page);
  await page.goto("/shop");
  await expect(page.locator(".card.buy").first()).toBeVisible({ timeout: 12000 });
  // 初回ロードもサーバーモード＝番号ページャ（page/per_page）で取得している。
  await expect.poll(() => itemReqs.some((u) => /[?&]per_page=/.test(u))).toBe(true);

  // リスト表示へ切替→「レアリティ」ヘッダでソート＝サーバーへ sort=rarity を委譲。
  await page.getByTitle("リスト表示").click();
  await page.locator('th[data-key="rarity"]').click();
  await expect.poll(() => itemReqs.some((u) => /[?&]sort=-?rarity/.test(u)), { timeout: 8000 }).toBe(true);
  await expect(page.getByRole("button", { name: "並び替えを解除" })).toBeVisible();
  await expect.poll(() => page.url()).toContain("sc30-shop.sort=");

  // 詳細（アバター）へ遷移→ブラウザ戻る（pop）でソート状態が復元（URL＋チップ）。
  await page.getByRole("link", { name: /きせかえへ/ }).click();
  await page.waitForURL(/\/avatar/);
  await page.goBack();
  await page.waitForURL(/\/shop(\?|$)/);
  await expect.poll(() => page.url()).toContain("sc30-shop.sort=");
  await expect(page.getByRole("button", { name: "並び替えを解除" })).toBeVisible();
});
