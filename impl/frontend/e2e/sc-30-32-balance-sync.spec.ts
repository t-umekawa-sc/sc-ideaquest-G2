import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// 残高（コイン/SP）が「アクション後にヒーローとヘッダー右上の両方で同期して減る」回帰ガード（G-TC-163/164・GF-AC-111/121）。
// ヘッダーはサーバー layout の GET /me 由来＝router.refresh 忘れで更新漏れが起きやすい（魔法解放SPで実際に発生・修正済み）。
// テスト用ユーザーを会社DBで baseline（SP100/コイン1000・未所有・台帳クリア）へリセットして実行し、後始末で再リセットする（docker QA スタック前提）。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §5-M／doc/フェーズ毎ルール/ゲーム感フェーズ.md §1.1。

const U = { company: "ACME-01", loginId: "user2@acme.example", password: "Passw0rd!" };
const IMPL_DIR = path.resolve(__dirname, "..", ".."); // e2e → frontend → impl
const UID = "(SELECT id FROM users WHERE login_id='user2@acme.example')";

function psql(sql: string) {
  execSync(`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c ${JSON.stringify(sql)}`, {
    cwd: IMPL_DIR,
    stdio: "pipe",
  });
}

// user2 を baseline（SP100/コイン1000・未所有・消費台帳クリア）へ戻す。魔法/ショップの自己修復ガードに当たらないよう台帳も消す。
function resetUser() {
  psql(
    `DELETE FROM activities WHERE user_id=${UID} AND ((kind='sp_spend' AND reason='spell_unlock') OR (kind='coin_spend' AND reason='shop_purchase'));`,
  );
  psql(`DELETE FROM user_spells WHERE user_id=${UID};`);
  psql(`DELETE FROM user_items WHERE user_id=${UID};`);
  psql(`UPDATE users SET skill_point_balance=100, coin_balance=1000 WHERE id=${UID};`);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(U.company);
  await page.locator("#login_id").fill(U.loginId);
  await page.locator("#password").fill(U.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

const numOf = (s: string | null) => Number((s ?? "").replace(/[^0-9]/g, ""));

test.beforeEach(() => resetUser());
test.afterAll(() => resetUser());

// 表示の数値（カンマ・記号を除去）。CountUp はロール中なので expect.poll で最終値へ収束を待つ。
const heroSp = (page: Page) => page.locator(".sp-hero__num");
const headSp = (page: Page) => page.locator(".app-header .pixel-stat.skill").first();
const wallet = (page: Page) => page.locator(".wallet__num");
const headCoin = (page: Page) => page.locator(".app-header .pixel-stat.coin").first();
const pollNum = async (loc: ReturnType<Page["locator"]>) => numOf(await loc.textContent());

test("G-TC-163 unlock deducts SP in both hero and header", async ({ page }) => {
  await login(page);
  await page.goto("/spells");
  await expect.poll(() => pollNum(heroSp(page))).toBe(100);
  await expect.poll(() => pollNum(headSp(page))).toBe(100);

  // 炎（前提なし・コモン1SP）を解放：カードのボタン→確認ダイアログ「解放する」。
  await page.locator(".spell-card", { hasText: "炎" }).getByRole("button", { name: "解放する" }).click();
  await page.getByRole("button", { name: "解放する" }).last().click();

  // 演出（DUR≈5.2s）の開封で SP が減る。settle まで待って両表示が 99 で一致することを確認。
  await expect.poll(() => pollNum(heroSp(page)), { timeout: 12000 }).toBe(99);
  await expect.poll(() => pollNum(headSp(page)), { timeout: 12000 }).toBe(99);
});

test("G-TC-164 purchase deducts coin in both wallet and header", async ({ page }) => {
  await login(page);
  await page.goto("/shop");
  await expect.poll(() => pollNum(wallet(page))).toBe(1000);
  await expect.poll(() => pollNum(headCoin(page))).toBe(1000);

  // 未所有・購入可能なカードを1枚選び、価格を読んでから購入。
  const card = page.locator(".buy").filter({ has: page.getByRole("button", { name: "購入する" }) }).first();
  const price = numOf(await card.locator(".buy__price").textContent());
  expect(price).toBeGreaterThan(0);
  await card.getByRole("button", { name: "購入する" }).click();
  await page.getByRole("button", { name: "購入する" }).last().click(); // 確認ダイアログ（既定 game ラベル）

  const expected = 1000 - price;
  await expect.poll(() => pollNum(wallet(page)), { timeout: 8000 }).toBe(expected);
  await expect.poll(() => pollNum(headCoin(page)), { timeout: 8000 }).toBe(expected);
});
