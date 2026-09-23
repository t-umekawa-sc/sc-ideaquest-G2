import { expect, test, type Page } from "@playwright/test";

// SC-40 実績（G.4 実接続）＝実績カタログ/収集サマリーが実データ（getAchievements）で描画される。ACME-01 で確認。
// 付与はサーバー（台帳フック）が自動判定＝backend G-TC-501〜506 で担保。e2e は実データ照合に限定。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §2（G-TC-207）・API設計 G.4・SC-40。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

test("G-TC-207 SC-40 achievements render real catalog and summary", async ({ page }) => {
  await login(page);
  const ach = await page.request.get("/api/v1/achievements").then((r) => r.json());
  await page.goto("/achievements");
  await expect(page.getByRole("heading", { name: "実績 / バッジ" })).toBeVisible();
  // 収集サマリーが実データ（デモ固定でない・total=12）。
  await expect(page.locator(".col-hero__num")).toHaveText(`${ach.summary.unlocked} / ${ach.summary.total}`);
  expect(ach.summary.total).toBe(12);
  // シークレット未獲得は「？？？」で伏せられる（実データで少なくとも1件）。
  const secret = ach.data.find((d: { is_secret?: boolean; unlocked: boolean }) => d.is_secret && !d.unlocked);
  if (secret) {
    await expect(page.locator(".ach__name", { hasText: "？？？" }).first()).toBeVisible();
  }
});
