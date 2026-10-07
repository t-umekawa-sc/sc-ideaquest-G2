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
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15000 }); // N=7 密集時の詳細ページロード遅延を吸収（既定5s→15s）
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

// C-TC-308（回帰・受入指摘）ガイダンス ⓘ(ScreenPurpose・§4.13) が hover でホスト行の残り幅いっぱいに展開する。
// 受入不具合＝内容が短いと内容幅で止まり「ものすごく短くしか広がらない」＝(1)CSS が max-width 駆動で内容幅で停止
//   (2)data-sp-host が内容幅の .filters だった。修正＝width 駆動＋460px 上限撤去＋host を全幅の .list-toolbar に。
// 判定＝展開した pop の右端が .list-toolbar 右端の近く（余白≒16px）＝残り幅を埋めている。表示ガード＝e2e（§5.3）。
test("C-TC-308 SC-12 search-tab guidance band fills host row width on hover", async ({ page }) => {
  await gotoAuthed(page);
  const title = `E2ESPバンド_${Date.now().toString().slice(-8)}`;
  const id = await createRecruiting(page, title);
  try {
    await page.goto(`/quests/${id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15000 });
    await page.getByRole("tab", { name: /全文検索/ }).click();
    const sp = page.locator(".screen-purpose").first();
    await expect(sp).toBeVisible();
    await sp.hover();
    await page.waitForTimeout(350); // width 展開アニメ（.2s）を待つ
    const gap = await page.evaluate(() => {
      const el = document.querySelector(".screen-purpose")!;
      const toolbar = el.closest(".list-toolbar")!; // 全幅ホスト（＝残り幅いっぱいの基準）
      const pop = el.querySelector(".screen-purpose__pop")!;
      return Math.round(toolbar.getBoundingClientRect().right - pop.getBoundingClientRect().right);
    });
    // pop 右端がツールバー右端の近く（≒16px 余白）＝行の残り幅を埋めている（内容幅や狭い .filters で止まらない）。
    expect(gap, "pop が行の残り幅いっぱいに展開（ツールバー右端との余白）").toBeGreaterThanOrEqual(6);
    expect(gap, "pop がツールバー右端を大きく超えない").toBeLessThanOrEqual(48);
  } finally {
    await deleteQuiet(page, id);
  }
});

// 状態遷移（recruiting→in_progress）と削除（→一覧へ）。owner のみの ⋯ アクション。
test("C-TC-206 SC-12 transition forward then delete", async ({ page }) => {
  // 注：N=7 密集時に主フロー（遷移→削除）が稀にストールする残存フレーク。test.slow() は救済にならず
  // （90s を使い切ってから retry するだけ）flake 回復を遅くするため付けない＝30s で早く落として retries:2 で吸収。
  await gotoAuthed(page);
  const title = `E2E遷移_${Date.now().toString().slice(-8)}`;
  const id = await createRecruiting(page, title);
  let deleted = false;
  try {
    await page.goto(`/quests/${id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15000 }); // N=7 密集時の詳細ページロード遅延を吸収（既定5s→15s）

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
