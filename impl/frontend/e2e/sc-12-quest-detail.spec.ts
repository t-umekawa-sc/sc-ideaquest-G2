import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures"; // ワーカ別DB隔離(§4.1)=各ワーカ専用会社でログイン
import { gotoAuthed, csrfToken, createRecruiting } from "./helpers";
// SC-12 クエスト詳細（実接続・C.1/C.3/C.5/C.2）。一般ユーザー ACME-01（デモグループ所属・dev seed 前提）で、
// 下地クエストを API で作成 → 詳細でヘッダー/概要/パーティーの実データ表示・状態遷移・削除を確認する。
// アイデア一覧＝D／全文検索＝J／週間ランキング＝G はデモのため範囲外。根拠＝screens/SC-12・API設計 C。

async function deleteQuiet(page: Page, id: string) {
  await page.request.delete(`/api/v1/quests/${id}`, { headers: { "X-CSRF-Token": await csrfToken(page) } });
}

// ヘッダー/概要/パーティーが GET /quests/{id} の実データを描画する。
test("C-TC-205 SC-12 detail renders header/about/party from API", async ({ page }) => {
  await gotoAuthed(page);
  const title = `E2E詳細_${Date.now().toString().slice(-8)}`;
  const id = await createRecruiting(page, title);
  try {
    await page.goto(`/quests/${id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    // 参加部署（FR-38 再設計）＝作成に使った先頭グループ名が「🗂 参加部署: …」に出る（旧「グループ: デモグループ」から変更）。
    const groupName = (await page.request.get("/api/v1/quest-groups").then((r) => r.json())).data[0].name;
    await expect(page.getByText(new RegExp(`参加部署: .*${groupName}`))).toBeVisible();

    // カテゴリはヘッダー（クエスト情報）に badge 表示（「概要」タブはレビュー#3で廃止＝ヘッダーと重複のため）。
    await expect(page.getByLabel("クエスト情報").getByText("業務改善", { exact: true })).toBeVisible();

    // パーティータブ＝作成者（テスト 太郎）が「作成者」バッジ付きで出る。
    await page.getByRole("tab", { name: /パーティー/ }).click();
    await expect(page.getByLabel("パーティー").getByText("テスト 太郎")).toBeVisible();
    await expect(page.getByLabel("パーティー").getByText("作成者")).toBeVisible();
  } finally {
    await deleteQuiet(page, id);
  }
});

// 状態遷移（recruiting→in_progress）と削除（→一覧へ）。owner のみの ⋯ アクション。
test("C-TC-206 SC-12 transition forward then delete", async ({ page }) => {
  await gotoAuthed(page);
  const title = `E2E遷移_${Date.now().toString().slice(-8)}`;
  const id = await createRecruiting(page, title);
  let deleted = false;
  try {
    await page.goto(`/quests/${id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // ⋯ → ステータスを進める（→ 進行中）→ 確認 OK。
    await page.getByRole("button", { name: "操作" }).click();
    await page.getByRole("menuitem", { name: /ステータスを進める/ }).click();
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("進行中").first()).toBeVisible();

    // ⋯ → クエストを削除 → danger 確認 → 一覧へ、タイトルは消える。
    await page.getByRole("button", { name: "操作" }).click();
    await page.getByRole("menuitem", { name: "クエストを削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(page).toHaveURL(/\/quests$/);
    await expect(page.getByText(title)).toHaveCount(0);
    deleted = true;
  } finally {
    if (!deleted) await deleteQuiet(page, id);
  }
});
