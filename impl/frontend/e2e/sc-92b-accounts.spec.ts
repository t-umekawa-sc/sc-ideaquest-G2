import { expect, test, type Page } from "@playwright/test";

// SC-92 アカウント & 所属（この会社）＝system_admin（doc/テスト/B §9・API設計 B.2/B.5）。
// 一覧は DataTable（client モード）＝ライブ検索（検索ボタンなし）・件数は list-count「N 件」・
// 発行/編集後は reload で DataTable が再マウントされ検索欄がクリアされ得るため fill→確認を toPass で再試行。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// B-TC-114: ACME-01 の会社詳細でアカウント発行→一覧に現れる（発行 EP＋一覧）。
test("B-TC-114 issue account appears in company account list", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  // ACME-01 の行の会社名リンクから詳細へ
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click(); // 行クリックで会社詳細へ（§4.5⑪・操作は⋯RowMenu）
  await expect(page.getByRole("heading", { name: /アカウント/ })).toBeVisible();
  // 既存 seed アカウントが見える（メール列追加で login==email の seed は login/email 2セルに出るため first）
  await expect(page.getByText("user@acme.example").first()).toBeVisible();

  const newLogin = `e2e-${Date.now().toString().slice(-8)}@acme.example`;
  await page.getByRole("link", { name: "＋ アカウント発行" }).click();
  await page.locator("#a_name").fill("E2E 発行太郎");
  await page.locator("#a_login").fill(newLogin);
  await page.locator("#a_email").fill(newLogin);
  await page.getByRole("button", { name: /発行する/ }).click();

  // DataTable のライブ検索で当該行を絞って確認（発行後の reload 再マウント競合は toPass で吸収）
  const region = page.getByRole("region", { name: "この会社のアカウント管理" });
  await expect(async () => {
    await region.getByRole("searchbox").fill(newLogin);
    await expect(region.getByRole("row", { name: new RegExp(newLogin) })).toBeVisible({ timeout: 1000 });
  }).toPass();
});

// B-TC-125: SC-92 会社アカウント一覧の検索（q）・メール列・件数（DataTable client モード・doc/テスト/B §16）。
// login と email を別値で発行し、検索絞り込み後に両セルが出る＝メール列が email を表示している証拠。
test("B-TC-125 company account list: search, email column, clear", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click(); // 行クリックで会社詳細へ（§4.5⑪・操作は⋯RowMenu）
  const region = page.getByRole("region", { name: "この会社のアカウント管理" });
  await expect(region.getByRole("columnheader", { name: /メールアドレス/ })).toBeVisible();

  const stamp = Date.now().toString().slice(-8);
  const loginId = `e2e-l-${stamp}@acme.example`;
  const emailAddr = `e2e-m-${stamp}@acme.example`;
  await region.getByRole("link", { name: "＋ アカウント発行" }).click();
  await page.locator("#a_name").fill(`検索対象_${stamp}`);
  await page.locator("#a_login").fill(loginId);
  await page.locator("#a_email").fill(emailAddr);
  await page.getByRole("button", { name: /発行する/ }).click(); // 送信ボタンは modal（body 直下に portal）＝region 外
  await expect(page.getByText("アカウントを発行")).toHaveCount(0); // フォームが閉じる＝発行成功

  // 検索＝一意スタンプで絞ると当該行のみ（1 件）。login と email が別セルに出る＝メール列が email 表示
  await expect(async () => {
    await region.getByRole("searchbox").fill(stamp);
    await expect(region.getByRole("cell", { name: loginId })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(region.getByRole("cell", { name: emailAddr })).toBeVisible();
  await expect(region.getByText("1 件", { exact: true })).toBeVisible();

  // 「すべてクリア」で全件へ戻る（ACME-01 は seed＋発行分で 2 件以上＝「1 件」表示が消える）
  await region.getByRole("button", { name: "すべてクリア" }).click();
  await expect(region.getByText("1 件", { exact: true })).toHaveCount(0);
});
