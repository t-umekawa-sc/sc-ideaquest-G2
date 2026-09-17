import { expect, test, type Page } from "@playwright/test";

// M-TC-016/017: 一覧の操作状態（検索/ソート/絞込/ページ）の URL 復元（デザイン標準 §4.5⑨・横断標準）。
// 共通コンポーネント DataTable が検索/ソート/絞込/ページを ?<storageKey>.q/.sort/.f/.page に同期（router.replace）し、
// 詳細へ遷移して戻る（pop）と離脱前の操作状態を復元する。機構は全一覧で共通＝SC-10 クエスト一覧で代表検証。
// 根拠＝doc/テスト/M_共通シェル・ナビ.md M-TC-016/017／デザイン標準 §4.5⑨。
const OWNER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OWNER.company);
  await page.locator("#login_id").fill(OWNER.loginId);
  await page.locator("#password").fill(OWNER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

test("M-TC-016 quest list restores a user sort after opening a quest and going back (pop)", async ({ page }) => {
  await login(page);
  await page.goto("/quests");
  // 一覧が描画される（カードが1件以上）＝検証の前提。
  await expect(page.locator("a.quest-card").first()).toBeVisible({ timeout: 12000 });

  // リスト表示へ切替（ヘッダクリックでソートするため）。
  await page.getByTitle("リスト表示").click();
  const deadlineHeader = page.locator('th[data-key="deadline"]');
  await expect(deadlineHeader).toBeVisible();
  await deadlineHeader.click(); // 締切で昇順ソート（ユーザー操作）

  // ソートが URL に載り、「並び替えを解除」チップが出る。
  await expect(page.getByRole("button", { name: "並び替えを解除" })).toBeVisible();
  await expect.poll(() => page.url()).toContain("sc10-quests.sort=");

  // 下書き（クリックで編集モーダルへ行く）を避け、詳細へ遷移できる非下書き行を開く。
  const detailRow = page.locator("tbody tr").filter({ hasNot: page.getByText("下書き") }).first();
  await expect(detailRow).toBeVisible();
  await detailRow.click();
  await page.waitForURL(/\/quests\/[0-9a-f-]{36}$/, { timeout: 10000 });

  // ブラウザ戻る（pop）＝ユーザーの「戻ってきた」動線。
  await page.goBack();
  await page.waitForURL(/\/quests(\?|$)/);

  // 戻り後もソート状態が復元される（URL＋チップ）。
  await expect.poll(() => page.url()).toContain("sc10-quests.sort=");
  await expect(page.getByRole("button", { name: "並び替えを解除" })).toBeVisible();
});

test("M-TC-017 quest list restores sort + filter (applied via URL) after opening a quest and going back", async ({ page }) => {
  await login(page);
  await page.goto("/quests");
  await expect(page.locator("a.quest-card").first()).toBeVisible({ timeout: 12000 });

  // 非下書きの status ラベルを実データから1つ拾う（絞込後も1件以上残り、カードクリックで詳細へ行けるように）。
  const statuses = await page.locator("a.quest-card .badge").allInnerTexts();
  const status = statuses.map((s) => s.trim()).find((s) => ["募集中", "進行中", "評価中", "完了"].includes(s));
  expect(status, "非下書きの status を持つクエストが少なくとも1件必要").toBeTruthy();

  // ソート＋絞込を URL から適用（decodeUrlState 経路＝共通機構）。
  const f = encodeURIComponent(JSON.stringify({ status: { type: "enum", key: "status", values: [status] } }));
  await page.goto(`/quests?sc10-quests.sort=-ideas&sc10-quests.f=${f}`);

  // 適用時に両チップが出る＝URL から状態が復元された。
  await expect(page.getByRole("button", { name: "並び替えを解除" })).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole("button", { name: "絞込を解除" })).toBeVisible();

  // 先頭カード（絞込＝非下書き status）で詳細へ → ブラウザ戻る（pop）。
  const card = page.locator("a.quest-card").first();
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL(/\/quests\/[0-9a-f-]{36}$/, { timeout: 10000 });
  await page.goBack();
  await page.waitForURL(/\/quests(\?|$)/);

  // 戻り後も「ソート」「絞込」の双方が復元（URL＋両チップ）。
  await expect.poll(() => page.url()).toContain("sc10-quests.sort=");
  await expect.poll(() => page.url()).toContain("sc10-quests.f=");
  await expect(page.getByRole("button", { name: "並び替えを解除" })).toBeVisible();
  await expect(page.getByRole("button", { name: "絞込を解除" })).toBeVisible();
});
