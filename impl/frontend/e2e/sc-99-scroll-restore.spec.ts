import { expect, test, type Page } from "@playwright/test";

// M-TC-013: 一覧のスクロール位置復元（デザイン標準 §4.12）。
// 再現する不具合＝ダッシュボードを下方向に見てから遷移し、**push 型の「戻る」リンク**（`<Link href="/">`＝
// フローティング「← ダッシュボードへ戻る」）で戻ると先頭に飛ぶ（履歴 pop=goBack は Next が復元するが push は
// 先頭へ）。fix＝restore-after-load で離脱前の scrollY 近傍へ復元する。
// 併せて「初回訪問（保存なし）は先頭のまま＝誤復元しない」を陰性対照で見る。
// 根拠＝doc/テスト/M_共通シェル・ナビ.md M-TC-013／デザイン標準 §4.12。
const OWNER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OWNER.company);
  await page.locator("#login_id").fill(OWNER.loginId);
  await page.locator("#password").fill(OWNER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

test("M-TC-013 dashboard restores scroll after a push-style back link (and no false restore on first visit)", async ({ page }) => {
  // 縦スクロールを確実に発生させる（低めビューポートで担保）。
  await page.setViewportSize({ width: 1280, height: 640 });
  await login(page);
  await page.goto("/");
  // 取得完了（コンテンツ実寸）まで待つ＝常設の「すべての通知 →」リンクを起点にする。
  await expect(page.getByRole("link", { name: /すべての通知/ })).toBeVisible();

  // 陰性対照＝初回訪問（保存なし）は先頭のまま（誤復元しない）。
  expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(2);

  // 下方向へスクロールして「離脱前の位置」を作る。
  const savedY = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, Math.floor(max * 0.8)));
    return window.scrollY;
  });
  expect(savedY).toBeGreaterThan(50); // 復元を検証できる程度にスクロールできている
  await page.waitForTimeout(150); // rAF スロットルの保存猶予（sessionStorage へ確定）

  // 通知一覧へ遷移（push）→ そこから push 型の「← ダッシュボードへ戻る」で戻る（これが不具合の起きる導線）。
  await page.getByRole("link", { name: /すべての通知/ }).click();
  await page.waitForURL(/\/notifications/);
  const back = page.getByRole("link", { name: /ダッシュボードへ戻る/ });
  await expect(back).toBeVisible();
  await back.click();
  await page.waitForURL((u) => u.pathname === "/");

  // restore-after-load＝ready 後に復元。先頭(0)ではなく savedY 近傍へ着地する。
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), { timeout: 6000 })
    .toBeGreaterThan(savedY - 80);
  const restoredY = await page.evaluate(() => window.scrollY);
  expect(Math.abs(restoredY - savedY)).toBeLessThanOrEqual(80); // 復元は近傍（クランプ差を許容）
});

// M-TC-014: pop 帰還（router.back＝ブラウザ戻る）でもスクロール位置を復元（ユーザー報告の回帰）。
// 症状＝ダッシュボードの参加中クエスト等のリンク→詳細→戻る（router.back）で「かなり上」に落ちた。
// 原因＝pop 帰還の再マウント時に Next ネイティブ復元が古い位置へ飛ばし、その scroll を onScroll が保存して
// 良い値を潰していた。修正＝保存位置を初回レンダーで確定キャプチャし、そこへ復元（§4.12）。
// 根拠＝doc/テスト/M_共通シェル・ナビ.md M-TC-014／デザイン標準 §4.12。
test("M-TC-014 dashboard restores scroll after a card link and browser Back (pop navigation)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);
  await page.goto("/");
  // データ描画で参加中クエストのカードが出るのを待つ（縦に長い位置にある詳細リンク）。
  const card = page.locator("a.quest-card").first();
  await expect(card).toBeVisible({ timeout: 12000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const savedY = await page.evaluate(() => window.scrollY);
  expect(savedY).toBeGreaterThan(50); // 復元を検証できる程度に下方向へ来ている
  // クエスト詳細へ遷移（push）→ ブラウザ戻る（pop＝アイデア/クエスト詳細の「戻る」= router.back と同じ）。
  await card.click();
  await page.waitForURL(/\/quests\//, { timeout: 10000 });
  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/");
  // pop 帰還でも保存位置の近傍へ復元（「かなり上」に落ちない）。
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), { timeout: 6000 })
    .toBeGreaterThan(savedY - 100);
  const restoredY = await page.evaluate(() => window.scrollY);
  expect(Math.abs(restoredY - savedY)).toBeLessThanOrEqual(100);
});
