import { test as base, expect, type Page } from "@playwright/test";

// ワーカ別DB隔離（テスト規約 §4.1）＝Playwright の各ワーカに専用会社（ACME-W{parallelIndex}／
// 会社DB ideaquest_company_acme_w{i}）を割り当て、共有会社DB・共有 user@acme への並列競合を断つ。
// login_id は会社単位一意（uq_accounts_company_login）なので user@acme.example を全ワーカで使い回す
// （会社コード/DB名のみ別）。bootstrap が E2E_WORKER_COMPANIES=N 社を seed する（既定0＝通常スタックは不変）。
//
// 使い方＝隔離したい spec で `import { test, expect } from "./fixtures"`（@playwright/test の代わり）。
// 変換しない spec は従来どおり共有 storageState（ACME-01・playwright.config の USER_STATE）で動く＝段階移行可。
// psql で会社DBを直接叩く spec は `workerCompany.dbName` を使う（`ideaquest_company_acme` 直書きをやめる）。

export type WorkerCompany = { company: string; dbName: string; loginId: string };

export const LOGIN_ID = "user@acme.example"; // 全ワーカ会社に存在する seed アカウント（会社単位一意）
export const PASSWORD = "Passw0rd!";

// 隔離の有効/無効は E2E_WORKER_COMPANIES（bootstrap が seed した会社数）で決まる。
// N>0（iqe2e 隔離スタック）＝各ワーカが専用会社 ACME-W{parallelIndex}。
// N=0（通常スタック・main の通常 e2e）＝ワーカ会社は未 seed なので共有 ACME-01 にフォールバック（従来挙動）。
// これで fixtures を import した spec は両モードで動く（移行互換）。
const WORKER_N = Number(process.env.E2E_WORKER_COMPANIES ?? 0) || 0;

export const test = base.extend<object, { workerCompany: WorkerCompany }>({
  // ワーカ単位＝parallelIndex から専用会社を決める（0..N-1）。N=0 は ACME-01 共有へフォールバック。
  workerCompany: [
    async ({}, use, workerInfo) => {
      const i = workerInfo.parallelIndex;
      const isolated = WORKER_N > 0;
      await use({
        company: isolated ? `ACME-W${i}` : "ACME-01",
        dbName: isolated ? `ideaquest_company_acme_w${i}` : "ideaquest_company_acme",
        loginId: LOGIN_ID,
      });
    },
    { scope: "worker" },
  ],

  // storageState を上書き＝各ワーカが自社アカウントで1回だけログインし、そのセッションを全テストで再利用。
  // キャッシュしない（db.reset で会社DBが毎回作り直され旧セッションは失効するため、run ごとに取り直す）。
  storageState: async ({ workerCompany, browser, baseURL }, use) => {
    const page: Page = await browser.newPage({ storageState: undefined });
    await page.goto((baseURL ?? "http://localhost:3000") + "/login");
    await page.locator("#company_code").fill(workerCompany.company);
    await page.locator("#login_id").fill(workerCompany.loginId);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
    const state = await page.context().storageState();
    await page.close();
    await use(state);
  },
});

export { expect };
