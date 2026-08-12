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
  await expect(page.getByRole("heading", { name: "会社アカウント管理" })).toBeVisible();

  const loginId = `e2e-self-${Date.now().toString().slice(-8)}@ops.example`;
  await page.getByRole("button", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill("E2E 自社太郎");
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(loginId);
  await page.getByRole("button", { name: /発行する/ }).click();
  // 発行後は先頭ページに戻る＝検索で当該行を絞って確認（per_page=20・ページング/検索 UI 導入）
  const region = page.getByRole("region", { name: "自社アカウント管理" });
  await region.getByRole("searchbox", { name: "検索（氏名・ログインID・メール）" }).fill(loginId);
  await region.getByRole("button", { name: "検索" }).click();
  await expect(region.getByRole("row", { name: new RegExp(loginId) })).toBeVisible();
});

// B-TC-118: 一般ユーザーは SC-93 に入れない（サーバーガード）。
test("B-TC-118 general user cannot access SC-93", async ({ page }) => {
  await login(page, GENERAL);
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/$/);
});

// B-TC-124: SC-93 一覧の検索（q）・メール列・ページャ（本スライス＝ページング/検索 UI・doc/テスト/B §16）。
// login と email を別値で発行し、検索絞り込み後に両セルが出る＝メール列が email を表示している証拠。
test("B-TC-124 own-account list: search, email column, pager", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/accounts");
  const region = page.getByRole("region", { name: "自社アカウント管理" });
  await expect(region.getByRole("columnheader", { name: "メールアドレス" })).toBeVisible();
  await expect(region.getByRole("button", { name: "前へ" })).toBeDisabled(); // 1ページ目

  const stamp = Date.now().toString().slice(-8);
  const loginId = `e2e-l-${stamp}@ops.example`;
  const emailAddr = `e2e-m-${stamp}@ops.example`;
  await page.getByRole("button", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill(`検索対象_${stamp}`);
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(emailAddr);
  await page.getByRole("button", { name: /発行する/ }).click();
  await expect(page.getByText("アカウントを発行")).toHaveCount(0); // フォームが閉じる＝発行成功

  // 検索＝一意スタンプで絞ると当該行のみ（total=1）・seed 管理者は消える
  await region.getByRole("searchbox", { name: "検索（氏名・ログインID・メール）" }).fill(stamp);
  await region.getByRole("button", { name: "検索" }).click();
  await expect(region.getByRole("cell", { name: loginId })).toBeVisible();
  await expect(region.getByRole("cell", { name: emailAddr })).toBeVisible();
  await expect(region.getByRole("cell", { name: "admin@ops.example" })).toHaveCount(0);
  await expect(region.getByText("（1 件）")).toBeVisible();
  await expect(region.getByRole("button", { name: "次へ" })).toBeDisabled(); // 1ページに収まる

  // クリアで全件へ戻る（自社は seed 管理者＋発行分で 2 件以上＝「1 件」表示が消える）
  await region.getByRole("button", { name: "クリア" }).click();
  await expect(region.getByText("（1 件）")).toHaveCount(0);
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
  // 発行後は先頭ページに戻る＝検索で当該行を絞って確認（per_page=20・ページング/検索 UI 導入）
  const region = page.getByRole("region", { name: "自社アカウント管理" });
  await region.getByRole("searchbox", { name: "検索（氏名・ログインID・メール）" }).fill(loginId);
  await region.getByRole("button", { name: "検索" }).click();
  await expect(region.getByRole("row", { name: new RegExp(loginId) })).toBeVisible();
});
