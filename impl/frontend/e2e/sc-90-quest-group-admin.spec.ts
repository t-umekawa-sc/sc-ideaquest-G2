import { expect, test, type Page } from "@playwright/test";

// SC-90 QG管理者（doc/テスト/B §14・API設計 B.4）。認可は per-group（当該グループの admin 所属）。
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

// B-TC-119: admin 所属を持たない一般ユーザーは SC-90 で「管理グループなし」（403 graceful）。
test("B-TC-119 non-admin sees no managed groups", async ({ page }) => {
  await login(page, GENERAL);
  await page.goto("/admin/quest-groups");
  await expect(page.getByText(/管理するクエストグループはありません/)).toBeVisible();
});

// B-TC-123: QG管理者でない一般ユーザーには「クエストグループ管理」ナビが出ない（session.is_qg_admin=false）。
test("B-TC-123 non-qg-admin does not see quest-group nav", async ({ page }) => {
  await login(page, GENERAL);
  await page.getByRole("button", { name: /テスト 太郎/ }).click(); // ユーザーメニューを開く
  await expect(page.getByRole("menuitem", { name: "クエストグループ管理" })).toHaveCount(0);
});

// B-TC-120: OPS を編集（直接適用）で当該グループの admin にし、SC-90 で参加追加→メンバーに現れる。
test("B-TC-120 qg admin adds member from directory", async ({ page }) => {
  await login(page, OPS);
  const headers = await csrfHeaders(page);
  const stamp = Date.now().toString().slice(-8);

  // OPS 会社と OPS 管理者アカウントを特定
  const companies = await (await page.request.get(`/api/v1/admin/companies?q=OPS`)).json();
  const ops = companies.data.find((c: { company_code: string }) => c.company_code === "OPS");
  const accts = await (await page.request.get(`/api/v1/admin/companies/${ops.company_id}/accounts`)).json();
  const opsAdmin = accts.data.find((a: { login_id: string }) => a.login_id === "admin@ops.example");

  // グループ作成 → OPS 管理者を当該グループの admin に（編集＝会社DB 直接適用・ワーカ非依存）
  const grp = await (await page.request.post(`/api/v1/admin/companies/${ops.company_id}/quest-groups`, {
    headers, data: { quest_group_code: `QGA${stamp}`, name: `QGA_${stamp}` },
  })).json();
  await page.request.patch(`/api/v1/admin/companies/${ops.company_id}/accounts/${opsAdmin.account_id}`, {
    headers, data: { memberships: [{ group_id: grp.group_id, role: "admin" }] },
  });
  // 参加追加の候補（ディレクトリに出る active アカウント）を発行
  const cand = `qgcand-${stamp}@ops.example`;
  const candName = `参加候補_${stamp}`;
  await page.request.post(`/api/v1/admin/companies/${ops.company_id}/accounts`, {
    headers, data: { display_name: candName, login_id: cand, email: cand, system_role: "general", memberships: [] },
  });

  // 候補は会社DB users ミラー（＝ディレクトリの取得元）に worker が非同期反映する＝出るまで待つ
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/v1/admin/company-directory?q=${encodeURIComponent(candName)}`);
      const body = await res.json();
      return (body.data ?? []).length;
    }, { timeout: 20000, intervals: [500, 1000, 1000, 2000] })
    .toBeGreaterThan(0);

  // SC-90: グループが見え、ディレクトリから候補を参加追加→メンバーに現れる
  await page.goto("/admin/quest-groups");
  await expect(page.getByRole("heading", { name: "クエストグループ管理" })).toBeVisible();
  await expect(page.locator("select").filter({ hasText: `QGA_${stamp}` })).toBeVisible();
  await page.getByRole("button", { name: "＋ メンバー追加" }).click();
  await page.getByPlaceholder("氏名・ログインIDで検索").fill(candName);
  await page.getByRole("button", { name: "検索" }).click();
  await page.getByRole("row", { name: new RegExp(candName) }).getByRole("button", { name: "追加" }).click();
  await expect(page.getByRole("row", { name: new RegExp(candName) }).getByText("メンバー")).toBeVisible();
});
