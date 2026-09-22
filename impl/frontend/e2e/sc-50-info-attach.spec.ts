// SC-50/SC-51 参考資料ファイル添付の回帰（DFT-N-001）。台帳＝N §3.2（N-TC-208/209）。
// 不具合＝file input の onChange で `e.target.value = ""` を同期リセットする一方、Array.from を
// 遅延 setState 内で評価していたため、更新時に live FileList が空になり選んだファイルが載らなかった。
// 修正＝ハンドラ内で Array.from を同期 materialize。setInputFiles は同じ onChange+value リセット経路を
// 通るため本不具合を忠実に再現する（修正前は attach 行=0＝red）。
import { expect, test } from "@playwright/test";

const CREDS = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(CREDS.company);
  await page.locator("#login_id").fill(CREDS.loginId);
  await page.locator("#password").fill(CREDS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.locator(".app-header")).toBeVisible();
}

async function createInfoItem(page: import("@playwright/test").Page, title: string): Promise<string> {
  await page.goto("/info-items/new");
  await page.locator("#im-title").fill(title);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => /\/info-items$/.test(new URL(r.url()).pathname) && r.request().method() === "POST"),
    page.getByRole("button", { name: "登録する" }).click(),
  ]);
  const created = (await resp.json()) as { id: string };
  expect(created.id).toBeTruthy();
  return created.id;
}

async function deleteInfoItem(page: import("@playwright/test").Page, id: string) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
  await page.request.delete(`/api/v1/info-items/${id}`, { headers: { "X-CSRF-Token": csrf } });
}

// N-TC-208: 登録ダイアログで参考資料をファイル選択すると一覧に載る（クリック選択経路）。
test("N-TC-208: 登録ダイアログの参考資料ファイル選択が一覧に載る（DFT-N-001）", async ({ page }) => {
  await login(page);
  await page.goto("/info-items/new");
  await page.locator("#im-title").fill(`添付回帰 ${Date.now()}`);

  const attachInput = page.locator('.info-dlg input[type="file"]:not([accept])').first();
  await attachInput.setInputFiles({ name: "shiryo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 dummy") });

  const rows = page.locator(".attach-list .attach");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator(".attach__name")).toHaveText("shiryo.pdf");
});

// N-TC-209: 詳細インライン編集で参考資料をファイル選択すると追加候補に載る（クリック選択経路）。
test("N-TC-209: 詳細編集の参考資料ファイル選択が一覧に載る（DFT-N-001）", async ({ page }) => {
  await login(page);
  const id = await createInfoItem(page, `添付回帰-詳細 ${Date.now()}`);
  try {
    await page.goto(`/info-items/${id}`);
    // 作成者なので参考資料の追加 input（accept 無し）が出る。
    const attachInput = page.locator('.info-dlg input[type="file"]:not([accept])').first();
    await expect(attachInput).toBeAttached();
    await attachInput.setInputFiles({ name: "hosoku.png", mimeType: "image/png", buffer: Buffer.from("PNGdummy") });

    // 「追加予定」バッジ付きの新規ステージ行が出る。
    const staged = page.locator(".attach-list .attach").filter({ hasText: "hosoku.png" });
    await expect(staged).toHaveCount(1);
  } finally {
    await deleteInfoItem(page, id);
  }
});
