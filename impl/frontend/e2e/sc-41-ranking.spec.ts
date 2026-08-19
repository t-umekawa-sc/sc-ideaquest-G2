import { expect, test, type Page } from "@playwright/test";

// SC-41 ランキング＝期間切替でスコア再計算の回帰 e2e（デモ fixtures・ランキング backend 未接続）。
// 根拠＝doc/画面設計/screens/SC-41_ランキング.md・mocks/SC-41_ランキング.html／フロントエンド実装フロー規約 §3・§8。
// 担保範囲＝スコア＝期間内 獲得XP＋獲得コイン（RankingView の MEMBERS fixtures）で順位付けし、
// 期間タブ（今週/先週/今月/通算）の切替で自分の順位・スコア・TOP1 が再計算される（クライアント state のみ）。
// 期間切替はクライアント計算のみ（backend 非依存）のため red-green §5.1 は接続時に適用。OPS でログインして /ranking を検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

async function gotoRanking(page: Page) {
  await login(page);
  await page.goto("/ranking");
  // 見出しは h1「ランキング」と h3「★ 社内ランキング ★」が併存＝部分一致だと strict 違反（handoff §5 末尾）。
  await expect(page.getByRole("heading", { name: "ランキング", exact: true })).toBeVisible();
}

// 初期＝今週。自分（山田 太郎）は 2位・スコア405（360XP＋45コイン）、TOP1 は鈴木 花子 530（480＋50）。
test("initial week period shows my rank and top score", async ({ page }) => {
  await gotoRanking(page);
  await expect(page.getByRole("tab", { name: "今週" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".myrank__pos")).toHaveText("2位");
  await expect(page.locator(".myrank__score .exp")).toHaveText("405");
  await expect(page.locator(".rank-list li").first().locator(".rank-score .total")).toHaveText("530");
});

// 通算へ切替＝スコア再計算。自分は 5位・8520（7800＋720）、TOP1 は鈴木 花子 15300（14000＋1300）。
test("switching to total period recomputes rank and top score", async ({ page }) => {
  await gotoRanking(page);
  await page.getByRole("tab", { name: "通算" }).click();

  await expect(page.getByRole("tab", { name: "通算" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "今週" })).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".myrank__pos")).toHaveText("5位"); // 2位 → 5位
  await expect(page.locator(".myrank__score .exp")).toHaveText("8520"); // 405 → 8520
  await expect(page.locator(".rank-list li").first().locator(".rank-score .total")).toHaveText("15300"); // 530 → 15300
});
