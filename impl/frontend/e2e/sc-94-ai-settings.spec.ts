import { test, expect, PASSWORD } from "./fixtures"; // ワーカ別DB隔離(§4.1)＝kanri は各ワーカ会社に存在（会社スコープ）
import { formLogin, gotoAuthed } from "./helpers";

// SC-94 会社のLLM設定（FR-45・S.5・doc/テスト/S_AIジョブ.md §4）。
// アクセス制御＝一般は差し戻し（既定 storageState=general）／表示＝company_account_admin(kanri) で自前ログイン。

test("S-TC-210 一般ユーザーは SC-94 に入れない（/ へ差し戻し）", async ({ page }) => {
  await gotoAuthed(page); // 既定 storageState＝user@acme（general）
  await page.goto("/admin/ai-settings");
  await expect(page).toHaveURL(/\/$/); // サーバーガードでダッシュボードへ
});

test.describe("S-TC-211 会社アカウント管理者の SC-94 表示", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // 未認証で開始＝kanri で自前ログイン

  test("モデル一覧（トグル・無料バッジ）＋SC-93 からの導線", async ({ page, workerCompany }) => {
    await formLogin(page, { company: workerCompany.company, loginId: "kanri@acme.example", password: PASSWORD });

    // SC-93（会社アカウント管理）に AI・LLM設定 への導線がある。
    await page.goto("/admin/accounts");
    await expect(page.locator('a[href="/admin/ai-settings"]')).toBeVisible();

    // SC-94 本体＝モデル2件（qwen3-light/swallow・ON トグル・無料バッジ）。
    await page.goto("/admin/ai-settings");
    await expect(page.getByRole("heading", { name: "会社のLLM設定" })).toBeVisible();
    await expect(page.locator(".settings-card .switch input[type=checkbox]")).toHaveCount(2);
    await expect(page.locator(".settings-card .badge-muted").first()).toBeVisible(); // 無料（自社ホスト）
  });
});
