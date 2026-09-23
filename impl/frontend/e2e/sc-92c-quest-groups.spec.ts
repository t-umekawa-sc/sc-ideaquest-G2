import { expect, test, type Page } from "@playwright/test";

// SC-92 クエストグループ CRUD（doc/テスト/B §12・API設計 B.3.1）。system_admin 専用。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

// B-TC-117: 作成ダイアログのフォーカス保持（Modal の初期フォーカス effect が入力のたびに再実行され
// 先頭フィールドへ飛ぶバグの回帰）。コード入力後、グループ名に文字入力してもフォーカスが名前に残る。
test("B-TC-117 create dialog keeps focus while typing name", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click(); // 行クリックで会社詳細へ（§4.5⑪・操作は⋯RowMenu）
  await expect(page.getByRole("heading", { name: "クエストグループ" })).toBeVisible();

  await page.getByRole("button", { name: "＋ グループ作成" }).click();
  await page.locator("#g_code").fill("SCDEV-01");
  // 名前欄へフォーカス→1文字ずつ入力（各キーで再レンダ＝バグ時は先頭のコード欄へフォーカスが飛ぶ）。
  await page.locator("#g_name").focus();
  await page.locator("#g_name").pressSequentially("計画", { delay: 30 });

  // フォーカスは名前欄に残り、入力値も保持される（コード欄の値も維持）。
  await expect(page.locator("#g_name")).toBeFocused();
  await expect(page.locator("#g_name")).toHaveValue("計画");
  await expect(page.locator("#g_code")).toHaveValue("SCDEV-01");
});

// B-TC-116: グループ作成→リネーム→削除（空グループ）の縦通し。
test("B-TC-116 quest group create/rename/delete", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click(); // 行クリックで会社詳細へ（§4.5⑪・操作は⋯RowMenu）
  await expect(page.getByRole("heading", { name: "クエストグループ" })).toBeVisible();

  const stamp = Date.now().toString().slice(-8);
  const code = `QG${stamp}`;
  const name = `グループ_${stamp}`;
  const renamed = `改名_${stamp}`;

  // 作成
  await page.getByRole("button", { name: "＋ グループ作成" }).click();
  await page.locator("#g_code").fill(code);
  await page.locator("#g_name").fill(name);
  await page.getByRole("button", { name: "作成する" }).click();
  // 多数グループでもページングに左右されないよう、コードで絞り込んでから検証（client 検索＝全行対象）。
  // 検証は行セル（role=cell）で行う＝検索チップ「🔍 "code"✕」が getByText(code) に二重一致するのを避ける。
  await page.getByRole("searchbox", { name: "グループ名・コード を検索" }).fill(code);
  await expect(page.getByRole("cell", { name: code })).toBeVisible();

  // 一覧は DataTable＝操作は RowMenu（⋯）。リネームは「編集」→編集モーダルに変更（旧 native prompt から）。
  const renameRow = page.getByRole("row", { name: new RegExp(code) });
  await renameRow.scrollIntoViewIfNeeded();
  await renameRow.getByRole("button", { name: "操作" }).click();
  await page.getByRole("menuitem", { name: "編集" }).click();
  await page.locator("#g_edit_name").fill(renamed);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByRole("cell", { name: renamed })).toBeVisible();

  // 削除＝カスタム確認ダイアログ（§15・native confirm ではない）＝「削除する」で確定（空グループ→204）。
  const deleteRow = page.getByRole("row", { name: new RegExp(code) });
  await deleteRow.scrollIntoViewIfNeeded();
  await deleteRow.getByRole("button", { name: "操作" }).click();
  await page.getByRole("menuitem", { name: "削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("cell", { name: code })).toHaveCount(0); // 行セルで判定（検索チップに影響されない）
});

// B-TC-179: グループ名の無変更保存＝rename API を呼ばず info「変更はありません」（無音にしない・デザイン標準 §14）。
test("B-TC-179 no-change rename shows info toast (no success)", async ({ page }) => {
  await login(page);
  await page.goto("/admin/companies");
  await page.getByRole("row", { name: /ACME-01/ }).getByRole("cell").first().click();
  await expect(page.getByRole("heading", { name: "クエストグループ" })).toBeVisible();

  const stamp = Date.now().toString().slice(-8);
  const code = `QGN${stamp}`;
  const name = `無変更_${stamp}`;
  await page.getByRole("button", { name: "＋ グループ作成" }).click();
  await page.locator("#g_code").fill(code);
  await page.locator("#g_name").fill(name);
  await page.getByRole("button", { name: "作成する" }).click();
  await page.getByRole("searchbox", { name: "グループ名・コード を検索" }).fill(code);
  await expect(page.getByText(code)).toBeVisible();

  try {
    const row = page.getByRole("row", { name: new RegExp(code) });
    await row.scrollIntoViewIfNeeded();
    await row.getByRole("button", { name: "操作" }).click();
    await page.getByRole("menuitem", { name: "編集" }).click();
    await expect(page.locator("#g_edit_name")).toHaveValue(name); // プリフィル完了

    // 何も変えずに保存＝無変更判定で rename を呼ばず info トースト（旧＝無音）。
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("変更はありません")).toBeVisible();
    await expect(page.getByText("グループ名を更新しました")).toHaveCount(0);
  } finally {
    // 後始末＝作成した空グループを削除。
    const row = page.getByRole("row", { name: new RegExp(code) });
    await row.getByRole("button", { name: "操作" }).click();
    await page.getByRole("menuitem", { name: "削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
  }
});
