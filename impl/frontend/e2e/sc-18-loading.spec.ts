import { expect, test, type Page } from "@playwright/test";

// #18 取得中のゲーム化（ローディング表示）＝共通 Spinner（◆コイン `.iq-spinner__coin` が回転＋「読み込み中…」・デザイン標準 §13）。
// 機能（reduce＝コイン回転停止）を e2e で担保。抑制機構は共通（1コンポーネント＋グローバル CSS）ゆえ代表画面 /ranking で観測。
// スピナーは取得中のみ表示ゆえ、rankings API を遅延させて取得中を可視化してから computed animationName を確認する。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §5-S（G-TC-174）・受入 GF-AC-181・§13。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

// GF-AC-181（#18 reduce）＝reduce-motion で取得中スピナーのコイン（.iq-spinner__coin）が回転しない。
// @media(prefers-reduced-motion) で animation:none（computed animationName === "none"）。ラベルは表示・取得完了で通常表示に切替。
test.describe("reduce-motion #18", () => {
  test("G-TC-174 SC loading coin spinner does not spin under reduced motion (#18)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // OS reduce をエミュレート（prefers-reduced-motion: reduce）
    await login(page);
    // ランキング取得を遅延させ、取得中スピナー（.iq-spinner__coin）を可視のまま観測する。
    await page.route("**/api/v1/rankings**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto("/ranking");
    const coin = page.locator(".iq-spinner__coin");
    await expect(coin).toBeVisible(); // 取得中はコインスピナーが出る（素の文字ではない）
    await expect(coin).toHaveText("◆");
    // reduce ではコインの回転（iq-coinspin）が無効＝animationName は none。
    await expect.poll(() => coin.first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // ラベルは表示（情報は残す）。取得完了後は通常表示（スピナーが消える）に切替。
    await expect(page.locator(".iq-spinner__label")).toHaveText("読み込み中…");
    await expect(page.locator(".iq-spinner__coin")).toHaveCount(0, { timeout: 10000 });
  });
});
