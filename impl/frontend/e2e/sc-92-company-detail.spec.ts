import { expect, test } from "@playwright/test";
import { formLogin } from "./helpers";

// SC-92 会社詳細/設定＝system_admin 専用（doc/テスト/B §9・API設計 B.1）。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };
const GENERAL = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

// B-TC-113: SC-91 から会社詳細へ遷移→設定トグル（MFA）が永続する（PATCH /settings）。
test("B-TC-113 company detail settings toggle persists", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, OPS);
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
  // トグルは PATCH /settings を非同期発火する。完了を待たず reload すると旧値のままになり落ちる（race）。
  await Promise.all([
    page.waitForResponse((r) => /\/settings\b/.test(r.url()) && r.request().method() === "PATCH" && r.ok()),
    mfaSwitch.click(),
  ]);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /MFA/ })).toBeChecked({ checked: !before });
});

// B-TC-180（回帰・受入指摘）公開（コンテスト専用）モード行の表示崩れ/文言。
// ①受入不具合＝行方向レイアウトで状態語「非公開」(3字>min-width 2.4em) が折り返して2行高に膨らむ
//   → 共有 `.switch__state{white-space:nowrap}` で1行固定（修正前は高さ ~38px=2行／修正後 ~19px=1行）。
// ②補足文の「サーバーで 403」は誤り＝公開会社の業務EPは外周ガード(access_gate)で 404＝存在秘匿（決定P'）。
// 表示/文言ガード＝e2e（テスト規約 §5.3）。ACME-01 を一覧APIで解決し詳細へ直接遷移（新規会社を作らない）。
test("B-TC-180 public-mode row: state word single-line + desc says 404", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, OPS);
  const list = await (await page.request.get(`/api/v1/admin/companies?q=ACME-01&per_page=100`)).json();
  const co = (list.data ?? []).find((c: { company_code: string }) => c.company_code === "ACME-01");
  expect(co, "ACME-01 が一覧APIに現れる").toBeTruthy();
  await page.goto(`/admin/companies/${co.company_id}`);

  const row = page.locator(".setting-row", { hasText: "公開（コンテスト専用）モード" });
  await expect(row).toBeVisible();
  // ② 補足文は 404（存在秘匿）＝403 ではない。
  await expect(row.locator(".setting-row__desc")).toContainText("404");
  await expect(row.locator(".setting-row__desc")).not.toContainText("403");
  // ① 状態語「非公開」が単一行（折り返すと高さが約2倍＝~38px になる）。
  const stateH = await row.locator(".switch__state").evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(stateH, "状態語が折り返さず単一行").toBeLessThan(28);
});

// B-TC-121: 一般ユーザーは SC-92 会社詳細に入れない（サーバーガード＝/ へリダイレクト）。
// ※ガードは system_role!=="system_admin" で一律 redirect＝company_account_admin も同じ分岐（backend SoD は B-TC-095）。
test("B-TC-121 general user cannot access SC-92 detail", { tag: "@serial" }, async ({ page }) => {
  await formLogin(page, GENERAL);
  await page.goto("/admin/companies/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/$/);
});
