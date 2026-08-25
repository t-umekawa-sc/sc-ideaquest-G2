import { expect, test, type Page } from "@playwright/test";

// SC-41 ランキング（G.5 実接続）＝会社内ランキングが実データ（getRankings）で描画される。ACME-01 で確認。
// 集計は会社全体（共有 DB）で非決定的なため、in-test で GET /rankings と照合して決定的に検証する。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §2（G-TC-206）・API設計 G.5・§7・SC-41。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

test("G-TC-206 SC-41 ranking renders real data (me/total)", async ({ page }) => {
  await login(page);
  const rk = await page.request.get("/api/v1/rankings?period=this_week&scope=company").then((r) => r.json());
  await page.goto("/ranking");
  await expect(page.getByRole("heading", { name: "ランキング", exact: true })).toBeVisible();
  // 「あなたの順位」の総人数が実データ（デモ固定 全12人中 でない）。
  await expect(page.getByLabel("あなたの順位").getByText(`/ 全${rk.me.total_users}人中`)).toBeVisible();
  // 順位（圏外なら「圏外」）も実データ。
  const posText = rk.me.rank != null ? `${rk.me.rank}位` : "圏外";
  await expect(page.getByLabel("あなたの順位").locator(".myrank__pos")).toHaveText(posText);
  // ランキング行数が API の data 件数と一致（this_week・1ページ）。
  await expect(page.locator(".rank-list li")).toHaveCount(rk.data.length);
});
