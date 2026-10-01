import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures"; // ワーカ別DB隔離(§4.1)=各ワーカ専用会社でログイン
// Q-TC-140: 登録系ダイアログの閉じ標準（デザイン標準 §4.1・決定 2026-09-28）。
// 受入不具合＝プロジェクト作成ダイアログで作成すると `/projects/{id}` 詳細へ遷移していた。
// 期待＝作成後は詳細へ遷移せず、ダイアログを閉じて呼び元（一覧 `/projects`）へ戻る。作成自体は成功。
// 根拠＝doc/テスト/Q_ソリューション開発 §5（Q-TC-140）／SC-70／Q.1／デザイン標準 §4.1。

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で user@acme 認証済み＝再ログイン不要。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

// 実 DB に作ったプロジェクトを API で後片付け（title 前方一致・同一 Cookie の CSRF を載せる）。
async function cleanupByTitlePrefix(page: Page, prefix: string) {
  const res = await page.request.get("/api/v1/projects");
  if (!res.ok()) return;
  const body = await res.json();
  const csrf = (await page.context().cookies()).find((c) => c.name === "iq_csrf")?.value ?? "";
  for (const p of body.data ?? []) {
    if (typeof p.title === "string" && p.title.startsWith(prefix)) {
      await page.request.delete(`/api/v1/projects/${p.id}`, { headers: { "X-CSRF-Token": csrf } });
    }
  }
}

test("Q-TC-140 create project → closes back to list (no navigate to detail)", async ({ page }) => {
  await login(page);
  const prefix = "Q-TC-140_";
  const title = `${prefix}${Date.now().toString().slice(-8)}`;
  try {
    // プロジェクト一覧→「＋ プロジェクトを作成」（intercept モーダル）
    await page.goto("/projects");
    await page.getByRole("link", { name: /プロジェクトを作成/ }).first().click();
    await expect(page.locator("#p_title")).toBeVisible();

    // 名称入力→「プロジェクトを作成」
    await page.locator("#p_title").fill(title);
    await page.getByRole("button", { name: "プロジェクトを作成" }).click();

    // Q-TC-140: 作成後は詳細（`/projects/{id}`）へ遷移せず、ダイアログを閉じて一覧へ戻る。
    await expect(page).toHaveURL(/\/projects$/, { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/projects\/[0-9a-f-]{8,}/); // 詳細へ遷移しない
    await expect(page.locator("#p_title")).toHaveCount(0);         // 作成ダイアログは閉じている

    // 作成自体は成功（一覧に作成した名称が出る）。
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });
  } finally {
    await cleanupByTitlePrefix(page, prefix);
  }
});
