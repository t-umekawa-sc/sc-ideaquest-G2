import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures"; // ワーカ別DB隔離（§4.1）＝各ワーカ専用会社で情報デモを隔離
import { gotoAuthed } from "./helpers";

// 「この情報からクエストを作成」の閉じ挙動＋Step B 遷移回帰。
// N-TC-226（改定 2026-09-28）＝登録系ダイアログ標準（デザイン標準 §4.1）＝作成後は詳細（クエスト）へ遷移せず、
//   ダイアログを閉じて呼び元（情報詳細ダイアログ）へ戻る。下書きクエスト自体は作成される。
// N-TC-227＝作成した下書きをクエスト一覧から開いても from-info ダイアログが再表示されない（履歴汚染回帰）。
// 根拠＝doc/テスト/N_情報インプット §3.6（N-TC-226/227）／SC-50／API C.2・N.3／デザイン標準 §4.1。


// 実 DB に作った下書きクエストを API で後片付け（title 前方一致・同一 Cookie の CSRF を載せる）。
async function cleanupByTitlePrefix(page: Page, prefix: string) {
  const res = await page.request.get("/api/v1/quests?limit=100");
  if (!res.ok()) return;
  const body = await res.json();
  const csrf = (await page.context().cookies()).find((c) => c.name === "iq_csrf")?.value ?? "";
  for (const q of body.data ?? []) {
    if (typeof q.title === "string" && q.title.startsWith(prefix)) {
      await page.request.delete(`/api/v1/quests/${q.id}`, { headers: { "X-CSRF-Token": csrf } });
    }
  }
}

// N-TC-226/227: 情報→下書き作成→ダイアログを閉じて情報詳細へ戻る＋一覧から開いても from-info ダイアログが出ない。
test("N-TC-226/227 create quest-from-info → closes back to info detail dialog → reopening draft never shows from-info dialog", async ({ page }) => {
  await gotoAuthed(page);
  const prefix = "N-TC-227_";
  const title = `${prefix}${Date.now().toString().slice(-8)}`;
  try {
    // 実動線＝情報一覧→行クリックで情報詳細（intercept モーダル）→「この情報からクエストを作成」（intercept モーダル）。
    // ＝ユーザーの「呼び元の情報詳細ダイアログに戻る」は、一覧上に重なる intercept モーダルのこと。
    await page.goto("/info-items");
    await page.locator("table.dt-fixed tbody tr, .dt-card").first().click();
    await page.waitForURL(/\/info-items\/[0-9a-f-]{8,}$/, { timeout: 8000 });
    const infoDetailUrl = page.url(); // 呼び元の情報詳細ダイアログ URL
    await page.getByRole("button", { name: /この情報からクエストを作成/ }).click();
    await expect(page.locator("#qfi-name")).toBeVisible();

    // 件名入力→「下書きを作成」
    await page.locator("#qfi-name").fill(title);
    await page.getByRole("button", { name: "下書きを作成" }).click();

    // N-TC-226（新標準）: 作成後は詳細（クエスト）へ遷移せず、ダイアログを閉じて呼び元（情報詳細ダイアログ）へ戻る。
    await expect(page).toHaveURL(infoDetailUrl, { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/quests\/[0-9a-f-]{8,}/); // クエスト詳細へ遷移しない
    await expect(page.locator("#qfi-name")).toHaveCount(0);      // from-info ダイアログは閉じている
    // 情報詳細ダイアログへ戻っている（CTA が再び見える）。
    await expect(page.getByRole("button", { name: /この情報からクエストを作成/ })).toBeVisible();

    // 下書きクエストは作成済み（一覧で件名が引ける）＝作成自体は成功している。
    await page.goto("/quests");
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 });

    // N-TC-227(a): クエスト一覧から下書きを開く（soft nav = intercept）→ from-info は出ず QuestForm 編集が開く。
    await page.getByText(title).first().click();
    await expect(page).toHaveURL(/\/quests\/[0-9a-f-]{8,}\/edit$/, { timeout: 10000 });
    const draftId = page.url().match(/\/quests\/([0-9a-f-]{8,})/)![1];
    await expect(page.locator("#qfi-name")).toHaveCount(0); // ★ from-info ダイアログが出ない
    await expect(page.locator("#q_name")).toBeVisible();     // QuestForm 編集が開く
    await expect(page.locator("#q_name")).toHaveValue(title);

    // N-TC-227(b): 直アクセス＋リロード（standalone フルページ）でも from-info は出ない。
    await page.goto(`/quests/${draftId}/edit`);
    await page.reload();
    await expect(page.locator("#qfi-name")).toHaveCount(0);
    await expect(page.locator("#q_name")).toBeVisible();
  } finally {
    await cleanupByTitlePrefix(page, prefix);
  }
});
