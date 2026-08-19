import { expect, test, type Page } from "@playwright/test";

// SC-01 ダッシュボード＝ヒーロー残高の backend 接続 e2e（GET /me 残高スライス・K.1）。
// 根拠＝doc/画面設計/screens/SC-01_ダッシュボード.md・doc/API設計/K_プロフィール・背景画像.md K.1／
// フロントエンド実装フロー規約 §1.1（画面単位接続）。担保範囲＝ヒーロー(Lv/XPバー NEXT/コイン/SP)と
// 共通ヘッダー通貨(Lv/コイン)が GET /me の balance と一致すること（値はハードコードせず /me 実値と突合＝接続の証明）。
// レベル進捗（xp_to_next/level_span）はサーバの §7 純粋関数で算出。週間ランキング等（G/C/D）は範囲外＝demo。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// ヒーロー残高＝GET /me の balance と一致（接続の証明）。ヘッダー通貨も同値。
test("hero and header balance reflect GET /me", async ({ page }) => {
  await login(page); // ダッシュボード（/）表示
  // 認証済みページと同一 Cookie で /me を取得し、UI 表示と突合する。
  const me = await page.request.get("/api/v1/me").then((r) => r.json());
  const b = me.balance;

  // ヒーロー（ゲーム層・SC-01 §4.2）
  await expect(page.locator(".hero__lv")).toHaveText(`Lv.${b.level}`);
  await expect(page.locator(".hero__next")).toHaveText(`NEXT ${b.xp_to_next} XP`);
  await expect(page.locator(".hero__coin .coin")).toContainText(`◆ ${b.coin_balance}`);
  await expect(page.locator(".hero__coin .skill")).toContainText(`✦ SP ${b.skill_point_balance}`);

  // 共通ヘッダー通貨（バー・§4.1）＝同じ /me balance
  await expect(page.locator(".app-header .pixel-stat.level").first()).toHaveText(`Lv.${b.level}`);
  await expect(page.locator(".app-header .pixel-stat.coin").first()).toContainText(`◆ ${b.coin_balance}`);
});
