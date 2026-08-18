import { expect, test, type Page } from "@playwright/test";

// SC-92 会社詳細/設定＝system_admin 専用（doc/テスト/B §9・API設計 B.1）。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };
const GENERAL = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function loginAs(page: Page, c: { company: string; loginId: string; password: string }) {
  await page.goto("/login");
  await page.locator("#company_code").fill(c.company);
  await page.locator("#login_id").fill(c.loginId);
  await page.locator("#password").fill(c.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

async function login(page: Page) {
  await loginAs(page, OPS);
}

// B-TC-113: SC-91 から会社詳細へ遷移→設定トグル（MFA）が永続する（PATCH /settings）。
test("B-TC-113 company detail settings toggle persists", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");

  const stamp = Date.now().toString().slice(-8);
  const code = `E2E-${stamp}`;
  const cname = `E2E詳細_${stamp}`; // run ごとに一意＝リンクの strict 一致を担保
  await page.getByRole("link", { name: "＋ 会社を作成" }).click(); // トリガは URL モーダルへの Link（SC-91 の URL モーダル化に追従・sc-91 spec と同型）
  await page.locator("#c_name").fill(cname);
  await page.locator("#c_code").fill(code);
  await page.locator("#c_db").fill(`ideaquest_e2e_${stamp}`);
  await page.getByRole("button", { name: /作成する/ }).click(); // 送信ボタンは modal（body 直下に portal）

  // 詳細へ遷移。会社一覧はページャ/検索 UI 未実装（per_page=50 固定）で、蓄積により新規会社が
  // 1ページ目に出ないことがあるため、作成会社の id を API で解決して詳細へ直接遷移する（SC-91 のページング/検索 UI は別スライスの負債）。
  const created = await (await page.request.get(`/api/v1/admin/companies?q=${code}&per_page=100`)).json();
  const co = (created.data ?? []).find((c: { company_code: string }) => c.company_code === code);
  expect(co, "作成した会社が一覧APIに現れる").toBeTruthy();
  await page.goto(`/admin/companies/${co.company_id}`);
  // 会社名は文脈バナー（.ctx＝region「メンテナンス中の会社」）に表示（SC-92 モック準拠＝見出しではない）。
  await expect(page.getByRole("region", { name: "メンテナンス中の会社" }).getByText(cname)).toBeVisible();

  // トグルはスイッチUI（.switch）＝input は視覚的に隠れ、可視の .switch__track がクリックを受ける。
  // 状態は checkbox で読み、操作は input を内包する label.switch（可視コントロール）をクリックする。
  const mfa = page.getByRole("checkbox", { name: /MFA/ });
  const mfaSwitch = page.locator("label.switch", { has: mfa });
  const before = await mfa.isChecked();
  await mfaSwitch.click();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /MFA/ })).toBeChecked({ checked: !before });
});

// B-TC-121: 一般ユーザーは SC-92 会社詳細に入れない（サーバーガード＝/ へリダイレクト）。
// ※ガードは system_role!=="system_admin" で一律 redirect＝company_account_admin も同じ分岐（backend SoD は B-TC-095）。
test("B-TC-121 general user cannot access SC-92 detail", async ({ page }) => {
  await loginAs(page, GENERAL);
  await page.goto("/admin/companies/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/$/);
});
