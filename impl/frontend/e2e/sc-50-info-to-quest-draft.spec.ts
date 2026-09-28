import { expect, test, type Page } from "@playwright/test";

// 「この情報からクエストを作成」の遷移回帰（Step B）。受入不具合＝作成した下書きをクエスト一覧から
// 開くと from-info ダイアログが再表示される（旧実装の二重遷移＝router.back()＋setTimeout(router.push)
// による履歴汚染）。修正 99c9e256＝RouteModal.close(to)/standalone nextHref の単一遷移。
// 根拠＝doc/テスト/N_情報インプット §3.6（N-TC-226/227）／SC-50／API C.2・N.3。
const INFO_ID = "14f00000-0000-4000-b000-000000000030"; // seed: 市場・業務メモ 30（bootstrap seed_demo_info）

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で user@acme 認証済み＝再ログイン不要。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

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

// N-TC-226/227: 情報→下書き作成→単一遷移＋一覧から開いても from-info ダイアログが出ない。
test("N-TC-226/227 create quest-from-info → single nav → reopening draft never shows from-info dialog", async ({ page }) => {
  await login(page);
  const prefix = "N-TC-227_";
  const title = `${prefix}${Date.now().toString().slice(-8)}`;
  try {
    // 情報詳細→「この情報からクエストを作成」（intercept モーダル）
    await page.goto(`/info-items/${INFO_ID}`);
    await page.getByRole("button", { name: /この情報からクエストを作成/ }).click();
    await expect(page.locator("#qfi-name")).toBeVisible();

    // 件名入力→「下書きを作成」
    await page.locator("#qfi-name").fill(title);
    await page.getByRole("button", { name: "下書きを作成" }).click();

    // N-TC-226: 作成後は作った下書きへ単一遷移（情報一覧へ戻らない）＋ダイアログは閉じている。
    await expect(page).toHaveURL(/\/quests\/[0-9a-f-]{8,}(\/edit)?$/, { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/info-items(\?|$)/);
    await expect(page.locator("#qfi-name")).toHaveCount(0);
    const draftUrl = page.url();
    const draftId = draftUrl.match(/\/quests\/([0-9a-f-]{8,})/)![1];

    // N-TC-227(a): クエスト一覧から下書きを開く（soft nav = intercept）→ from-info は出ず QuestForm 編集が開く。
    await page.goto("/quests");
    await page.getByText(title).first().click();
    await expect(page).toHaveURL(new RegExp(`/quests/${draftId}/edit$`), { timeout: 10000 });
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
