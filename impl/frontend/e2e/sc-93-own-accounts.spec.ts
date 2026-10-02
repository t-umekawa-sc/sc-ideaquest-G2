import { expect, test, type Page } from "@playwright/test";
import { formLogin } from "./helpers";

// SC-93 会社アカウント管理者（自社アカウント管理・doc/テスト/B §13・API設計 B.2.1）。
// company_account_admin 専用＋system_admin 上位互換。e2e は OPS system_admin（上位互換）で /admin/accounts を検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };
const GENERAL = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
  return { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
}

// B-TC-117: /admin/accounts（自社固定）で発行→一覧に現れる。
test("B-TC-117 own-company account issue appears", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, OPS);
  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "会社アカウント管理" })).toBeVisible();

  const loginId = `e2e-self-${Date.now().toString().slice(-8)}@ops.example`;
  await page.getByRole("link", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill("E2E 自社太郎");
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(loginId);
  await page.getByRole("button", { name: /発行する/ }).click();
  // 一覧は DataTable（client モード・ライブ検索）。発行後 reload の再マウント競合は toPass で吸収。
  const region = page.getByRole("region", { name: "自社アカウント管理" });
  await expect(async () => {
    await region.getByRole("searchbox", { name: "氏名・ログインID・メール を検索" }).fill(loginId);
    await expect(region.getByRole("row", { name: new RegExp(loginId) })).toBeVisible({ timeout: 1000 });
  }).toPass();
});

// B-TC-118: 一般ユーザーは SC-93 に入れない（サーバーガード）。
test("B-TC-118 general user cannot access SC-93", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, GENERAL);
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/$/);
});

// B-TC-124: SC-93 一覧の検索（q）・メール列・件数（DataTable client モード・doc/テスト/B §16）。
// login と email を別値で発行し、検索絞り込み後に両セルが出る＝メール列が email を表示している証拠。
test("B-TC-124 own-account list: search, email column, clear", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, OPS);
  await page.goto("/admin/accounts");
  const region = page.getByRole("region", { name: "自社アカウント管理" });
  await expect(region.getByRole("columnheader", { name: /メールアドレス/ })).toBeVisible();

  const stamp = Date.now().toString().slice(-8);
  const loginId = `e2e-l-${stamp}@ops.example`;
  const emailAddr = `e2e-m-${stamp}@ops.example`;
  await page.getByRole("link", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill(`検索対象_${stamp}`);
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(emailAddr);
  await page.getByRole("button", { name: /発行する/ }).click();
  // フォームが閉じる＝発行成功。見出し（role=heading）で判定する＝成功トースト「アカウントを発行しました」を
  // getByText の部分一致で拾ってしまうと、トーストが残る間 count>0 になり並列負荷で不安定になる（本フレークの実体）。
  await expect(page.getByRole("heading", { name: "アカウントを発行", exact: true })).toHaveCount(0);

  // DataTable ライブ検索＝一意スタンプで絞ると当該行のみ（1 件）・seed 管理者は消える
  await expect(async () => {
    await region.getByRole("searchbox", { name: "氏名・ログインID・メール を検索" }).fill(stamp);
    await expect(region.getByRole("cell", { name: loginId })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(region.getByRole("cell", { name: emailAddr })).toBeVisible();
  await expect(region.getByRole("cell", { name: "admin@ops.example" })).toHaveCount(0);
  // ↑ 検索で当該行のみに絞れた証跡（seed 管理者が消える）＝行の有無で判定（堅牢）。
  // 件数ラベルは region 内に複数 .list-count（件/名）があり曖昧なため使わない。

  // 「すべてクリア」で検索が解除される（検索欄が空に戻る）＝データ非依存で堅牢に判定。
  await region.getByRole("button", { name: "すべてクリア" }).click();
  await expect(region.getByRole("searchbox", { name: "氏名・ログインID・メール を検索" })).toHaveValue("");
});

// B-TC-122: 自社グループ一覧 EP（/admin/company-quest-groups）で所属ピッカーが機能し、所属付きで発行できる。
test("B-TC-122 self issue with membership picker", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, OPS);
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
  await page.getByRole("link", { name: "＋ アカウント発行" }).click();
  await page.locator("#s_name").fill("自社所属太郎");
  await page.locator("#s_login").fill(loginId);
  await page.locator("#s_email").fill(loginId);
  // メンバーシップピッカーは native select→カスタム Multiselect（combobox）へ変更＝click→検索→option 選択（EP が候補を返す＝ピッカー機能）。
  const groupCombo = page.getByRole("combobox", { name: "所属グループを追加" });
  await groupCombo.click();
  await groupCombo.fill(gname);
  await page.getByRole("option", { name: gname }).click();
  await page.getByRole("button", { name: /発行する/ }).click();
  // 一覧は DataTable（client モード・ライブ検索）。発行後 reload の再マウント競合は toPass で吸収。
  const region = page.getByRole("region", { name: "自社アカウント管理" });
  await expect(async () => {
    await region.getByRole("searchbox", { name: "氏名・ログインID・メール を検索" }).fill(loginId);
    await expect(region.getByRole("row", { name: new RegExp(loginId) })).toBeVisible({ timeout: 1000 });
  }).toPass();
});
