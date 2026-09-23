// N-TC-202: 情報インプット一覧（SC-50・サーバー委譲）の回帰＝「続報を束ねる」で再クエリが発火する。
// 不具合＝roots_only トグルが QueryState 外のため DataTable server が再クエリせず件数が変わらなかった
// （InfoListView が refreshToken を渡していなかった）。seed（続報 i2 あり）で件数が減ることを検証する。
import { expect, test } from "@playwright/test";

const CREDS = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: import("@playwright/test").Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

async function tabCount(page: import("@playwright/test").Page): Promise<number> {
  const tab = page.locator(".tab", { hasText: "情報インプット" });
  const text = await tab.locator(".tab-count").innerText();
  return Number(text.trim());
}

test("N-TC-202: 続報を束ねるトグルで一覧が再クエリされ件数が減る", async ({ page }) => {
  await login(page);
  await page.goto("/info-items");
  await expect(page.locator(".tab", { hasText: "情報インプット" })).toBeVisible();
  // facets が入るまで待つ（初期は 0 のことがある）。
  await expect.poll(() => tabCount(page)).toBeGreaterThan(0);
  const before = await tabCount(page);

  // 「続報を束ねる」＝根のみ（続報 i2 が除外される）。
  await page.locator('label.checkbox:has-text("続報を束ねる") input[type="checkbox"]').check();
  await expect.poll(() => tabCount(page)).toBeLessThan(before);

  // 解除で戻る。
  await page.locator('label.checkbox:has-text("続報を束ねる") input[type="checkbox"]').uncheck();
  await expect.poll(() => tabCount(page)).toBe(before);
});

test("N-TC-203: 一覧ヘッダー（列見出し行）がページスクロールで上部に貼り付く", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 }); // 低い高さ＝少ない行でもスクロールする
  await login(page);
  await page.goto("/info-items");
  // データ描画を待つ（seed 行）＝テーブル高が確定してからスクロール。
  await expect(page.getByText("競合A社が類似SaaSを大幅値下げ")).toBeVisible();
  const th = page.locator("table.table thead th").first();
  const headerH = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0);
  // 最下部へスクロール＝ヘッダーは「戻るピルの下」に固定（app-header の下・ピル高ぶん下げる）。
  // poll の各回で再スクロール＝遅延レンダで高さが伸びても最下部を維持。
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const bb = await th.boundingBox();
    return bb ? Math.round(bb.y) : -1;
  }).toBeLessThan(headerH + 160); // 上部付近に固定（フローティング成立）
  // 戻るピルの下に固定＝見出しは app-header より下、かつピルの下端以降にある。
  const y = (await th.boundingBox())?.y ?? -1;
  const pillBottom = await page.evaluate(() => {
    const el = document.querySelector(".backlink--float");
    return el ? el.getBoundingClientRect().bottom : 0;
  });
  expect(y).toBeGreaterThan(headerH); // app-header の下
  expect(y).toBeGreaterThanOrEqual(pillBottom - 2); // 戻るピルの下（重ならない）
});
