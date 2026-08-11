import { expect, test, type Page } from "@playwright/test";

// SC-91 システム管理（会社一覧）＝system_admin 専用（doc/テスト/B §8・API設計 B.1）。
// OPS 運営テナントの system_admin（bootstrap seed）でログインして操作する。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };
const GENERAL = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page, c: { company: string; loginId: string; password: string }) {
  await page.goto("/login");
  await page.locator("#company_code").fill(c.company);
  await page.locator("#login_id").fill(c.loginId);
  await page.locator("#password").fill(c.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// B-TC-110: system_admin が会社一覧を表示＝seed 会社（ACME-01）が見える。
test("B-TC-110 system admin sees company list", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/companies");
  await expect(page.getByRole("heading", { name: /会社一覧/ })).toBeVisible();
  await expect(page.getByText("ACME-01")).toBeVisible();
});

// B-TC-111: 会社作成＝一覧に現れる（status=準備中）。
test("B-TC-111 create company appears in list", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/companies");
  const code = `E2E-${Date.now().toString().slice(-8)}`;
  await page.getByRole("button", { name: "＋ 会社作成" }).click();
  await page.locator("#c_name").fill("E2E テスト社");
  await page.locator("#c_code").fill(code);
  await page.locator("#c_db").fill(`ideaquest_e2e_${Date.now().toString().slice(-8)}`);
  await page.getByRole("button", { name: /作成する/ }).click();
  await expect(page.getByText(code)).toBeVisible();
});

// B-TC-112: 非 system_admin（general）は SC-91 に入れない（サーバーガード＝/ へリダイレクト）。
test("B-TC-112 general user cannot access SC-91", async ({ page }) => {
  await login(page, GENERAL);
  await page.goto("/admin/companies");
  await expect(page).toHaveURL(/\/$/); // ダッシュボードへ差し戻し
});
