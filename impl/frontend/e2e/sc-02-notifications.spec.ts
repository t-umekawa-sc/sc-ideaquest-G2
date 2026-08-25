import { expect, test, type Page } from "@playwright/test";

// SC-02 通知一覧（H 実接続）＝一覧/未読数が実データ（getNotifications）で描画される。ACME-01 で確認。
// 生成はサーバー（発火ドメイン）＝backend H-TC-101〜143 で担保。e2e は実データ照合＋デモ排除に限定。
// 根拠＝doc/テスト/H_通知.md §1e（H-TC-208）・API設計 H.2・SC-02。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

test("H-TC-208 SC-02 notifications render real list and unread count", async ({ page }) => {
  await login(page);
  const api = await page.request.get("/api/v1/notifications?limit=50").then((r) => r.json());
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible();
  // 未読数が実データ（デモ固定 4 件でない）。
  await expect(page.locator(".list-count")).toHaveText(`${api.unread_count} 件の未読`);
  // 行数が実 data.length（0 なら空表示）。
  const rows = page.locator(".n");
  await expect(rows).toHaveCount(api.data.length);
  if (api.data.length === 0) {
    await expect(page.locator(".list-empty")).toBeVisible();
  }
  // デモ固定文字列（モックのセキュリティ通知 IP）が出ない＝実接続の証跡。
  await expect(page.getByText("IP 203.0.113.42")).toHaveCount(0);
});
