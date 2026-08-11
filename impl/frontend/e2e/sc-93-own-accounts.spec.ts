import { expect, test, type Page } from "@playwright/test";

// SC-93 会社アカウント管理者（自社アカウント管理・doc/テスト/B §13・API設計 B.2.1）。
// company_account_admin 専用＋system_admin 上位互換。e2e は OPS system_admin（上位互換）で /admin/accounts を検証。
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

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
  return { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
}

// B-TC-117: /admin/accounts（自社固定）で発行→一覧に現れる。
test("B-TC-117 own-company account issue appears", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "アカウント管理（自社）" })).toBeVisible();

  const loginId = `e2e-self-${Date.now().toString().slice(-8)}@ops.example`;
  await page.getByRole("button", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill("E2E 自社太郎");
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(loginId);
  await page.getByRole("button", { name: /発行する/ }).click();
  await expect(page.getByText(loginId)).toBeVisible();
});

// B-TC-118: 一般ユーザーは SC-93 に入れない（サーバーガード）。
test("B-TC-118 general user cannot access SC-93", async ({ page }) => {
  await login(page, GENERAL);
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/$/);
});

// B-TC-122: 自社グループ一覧 EP（/admin/company-quest-groups）で所属ピッカーが機能し、所属付きで発行できる。
test("B-TC-122 self issue with membership picker", async ({ page }) => {
  await login(page, OPS);
  const headers = await csrfHeaders(page);
  const stamp = Date.now().toString().slice(-8);

  // OPS 会社にグループを作成（ピッカーの候補になる）
  const companies = await (await page.request.get(`/api/v1/admin/companies?q=OPS`)).json();
  const ops = companies.data.find((c: { company_code: string }) => c.company_code === "OPS");
  const gname = `自社G_${stamp}`;
  await page.request.post(`/api/v1/admin/companies/${ops.company_id}/quest-groups`, {
    headers, data: { quest_group_code: `SELFG${stamp}`, name: gname },
  });

  // SC-93: 発行フォームの所属ピッカーに当該グループが出る→選択→発行
  await page.goto("/admin/accounts");
  const loginId = `e2e-selfm-${stamp}@ops.example`;
  await page.getByRole("button", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill("自社所属太郎");
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(loginId);
  await page.getByLabel("所属グループを追加").selectOption({ label: gname }); // EP が候補を返す＝ピッカー機能
  await page.getByRole("button", { name: /発行する/ }).click();
  await expect(page.getByText(loginId)).toBeVisible();
});
