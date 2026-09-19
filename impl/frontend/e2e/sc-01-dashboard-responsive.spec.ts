import { expect, test, type Page } from "@playwright/test";

// I-TC-162（e2e・レスポンシブ回帰／受入不具合）＝ダッシュボードの議論2カラム（💬新着／🕒最近）が
// 狭幅（375px＝iPhone SE 相当）で**横スクロールを生まない**ことの担保。
// 根拠＝doc/テスト/I_ダッシュボード.md I-TC-162／SC-01 §4.8c／dashboard.css .dash-discuss。
// 不具合＝グリッド `1fr`（＝minmax(auto,1fr)）の暗黙 min-width:auto が nowrap 子
// （.unread-item__title 等）で1fr トラックを content 幅まで膨張させ、狭幅でカードがビューポートから
// はみ出して切れていた。修正＝`minmax(0,1fr)`（トラックを content min-content 未満へ縮められる）。
// 再現には「最近の議論」に長いタイトルのチャットが要る＝seed 会社 ACME-01（seed_demo で投入済み）を使う。
const ACME = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(ACME.company);
  await page.locator("#login_id").fill(ACME.loginId);
  await page.locator("#password").fill(ACME.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

test.describe("SC-01 ダッシュボード レスポンシブ（I-TC-162）", () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE 相当（狭幅）

  test("狭幅で横スクロール（オーバーフロー）を生まない・議論は1カラム・ヘッダーは残る", async ({ page }) => {
    await login(page);
    await page.waitForSelector(".dash-discuss");

    // ① ページ全体が横に溢れない（本丸の回帰＝doc scrollWidth ≤ clientWidth）。
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(overflow.scrollWidth, "横スクロール（オーバーフロー）が発生している").toBeLessThanOrEqual(
      overflow.clientWidth + 1, // サブピクセル丸め許容
    );

    // ② 議論2カラムは狭幅で1カラム＝2枚のカードが縦積み（同じ左端 x）でビューポート内に収まる。
    const cards = await page.evaluate(() => {
      const g = document.querySelector(".dash-discuss");
      if (!g) return [];
      return [...g.children].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x), right: Math.round(r.right) };
      });
    });
    expect(cards.length).toBeGreaterThanOrEqual(2);
    const vw = overflow.clientWidth;
    for (const c of cards) {
      expect(c.right, "カードがビューポート右端をはみ出している").toBeLessThanOrEqual(vw + 1);
    }
    // 縦積み＝左端 x が揃う（1カラム）。
    expect(cards[0].x).toBe(cards[1].x);

    // ③ ヘッダーは position:sticky;top:0 でスクロールしても残る（ユーザーの疑問への担保＝消えない）。
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    const headerTop = await page.evaluate(() => Math.round(document.querySelector(".app-header")!.getBoundingClientRect().top));
    expect(headerTop, "ヘッダーがスクロールで流れて消えている（sticky が効いていない）").toBeLessThanOrEqual(1);
  });
});
