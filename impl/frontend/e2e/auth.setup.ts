import path from "node:path";

import { expect, test as setup } from "@playwright/test";

// 認証セットアップ（Playwright storageState 方式）。共有アカウント user@acme@ACME-01 を「1回だけ」
// ログインし、Cookie セッションを storageState に保存する。各 spec はこの state を既定で再利用し、
// テストごとの再ログインを廃止する＝(IP+login_id) 単位のログインレート制限（既定 dev 50/300s）を
// 並列フル実行で超過しない。root 原因＝全ワーカが同一 frontend IP＋同一 user@acme で毎テスト
// ログインし 5 分窓で 50 回を超過→429→ログイン画面から進めず大量 fail（並列62 failed の主因）。
// 破棄系（sc-00-* の全端末ログアウト/セッション失効）は storageState を使わず自前ログインする。

const AUTH_DIR = path.join(__dirname, "..", "playwright", ".auth");
export const USER_STATE = path.join(AUTH_DIR, "user.json");

// 共有 user@acme（ACME-01・作成者/owner）を1回ログインして既定 storageState を作る。多くの spec が
// これを再利用しテストごとの再ログインを廃止＝user@acme バケットのレート制限超過を防ぐ。
// admin@ops 等の他アカウントは各 spec が実ログインするが、別バケット＋低頻度（<50/窓）で問題ない。
setup("authenticate as user@acme (shared owner)", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#company_code").fill("ACME-01");
  await page.locator("#login_id").fill("user@acme.example");
  await page.locator("#password").fill("Passw0rd!");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
  await page.context().storageState({ path: USER_STATE });
});
