// SC-52 情報の詳細ダイアログ＝閉じるガード（未保存の破棄確認）と無変更保存の挙動（SC-50 §78）。
// N-TC-206: dirty（未保存）で閉じると破棄確認が出る＝「編集に戻る」で残り「破棄して閉じる」で閉じる（黙って捨てない）。
// N-TC-207: 無変更で「保存する」を押すと版を増やさずダイアログを閉じて「変更はありません」を通知（他フォームと統一）。
// フィクスチャは自己完結＝seed 情報の作成者はデモ user のため編集不可。テスト内で user@acme が新規登録し作成者になる。
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

// user@acme で情報を新規登録し、作成された情報の id を返す（作成者＝内容編集可）。
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

// テストが作った情報を物理削除して後始末する（raw・作成者本人なら DELETE 可）。
// 一覧に残ると created_at 降順で seed 行を押し出し、他 e2e（N-TC-203 等）を壊すため必須。
async function deleteInfoItem(page: import("@playwright/test").Page, id: string) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
  await page.request.delete(`/api/v1/info-items/${id}`, { headers: { "X-CSRF-Token": csrf } });
}

test("N-TC-206: 未保存で閉じると破棄確認＝編集に戻るで残り破棄して閉じるで閉じる", async ({ page }) => {
  await login(page);
  const title = `破棄確認テスト ${Date.now()}`;
  const id = await createInfoItem(page, title);
  try {
    // 直アクセスの詳細（standalone Modal）を開く＝作成者なのでタイトルが編集可能。
    await page.goto(`/info-items/${id}`);
    const titleInput = page.locator(".info-dlg input.input").first();
    await expect(titleInput).toHaveValue(title);

    // タイトルを編集して dirty にする。
    await titleInput.fill(`${title} 編集`);

    // フッター「閉じる」→ 破棄確認が出る（黙って閉じない）。
    await page.locator(".modal__footer").getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(page.getByRole("heading", { name: "編集を破棄しますか？" })).toBeVisible();

    // 「編集に戻る」＝閉じずに詳細が残り、編集値も保持。
    await page.getByRole("button", { name: "編集に戻る" }).click();
    await expect(page.getByRole("heading", { name: "編集を破棄しますか？" })).toBeHidden();
    await expect(titleInput).toHaveValue(`${title} 編集`);

    // Esc も同じガードを通る（背景/×/Esc の全経路・standalone Modal 経由）。
    await titleInput.press("Escape");
    await expect(page.getByRole("heading", { name: "編集を破棄しますか？" })).toBeVisible();
    await page.getByRole("button", { name: "編集に戻る" }).click();
    await expect(titleInput).toHaveValue(`${title} 編集`);

    // 再度「閉じる」→「破棄して閉じる」＝ダイアログが閉じる。
    await page.locator(".modal__footer").getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByRole("button", { name: "破棄して閉じる" }).click();
    await expect(page.locator(".info-dlg")).toHaveCount(0);
  } finally {
    await deleteInfoItem(page, id);
  }
});

test("N-TC-207: 無変更で保存すると閉じて『変更はありません』を通知", async ({ page }) => {
  await login(page);
  const title = `無変更保存テスト ${Date.now()}`;
  const id = await createInfoItem(page, title);
  try {
    await page.goto(`/info-items/${id}`);
    const saveBtn = page.locator(".modal__footer").getByRole("button", { name: "保存する" });
    await expect(saveBtn).toBeVisible();

    // 何も編集せず「保存する」＝版を増やさず閉じて通知（dirty ではないので破棄確認は出ない）。
    await saveBtn.click();
    await expect(page.getByText("変更はありません")).toBeVisible();
    await expect(page.locator(".info-dlg")).toHaveCount(0);
  } finally {
    await deleteInfoItem(page, id);
  }
});
