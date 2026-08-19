import { expect, test, type Page } from "@playwright/test";

// SC-02 通知一覧＝プロトタイプ相互作用の回帰 e2e（デモ fixtures・backend H 未接続）。
// 根拠＝doc/画面設計/screens/SC-02_通知一覧.md・mocks/SC-02_通知一覧.html／フロントエンド実装フロー規約 §3・§8（DoD＝モック一致）。
// 担保範囲＝未読件数・状態/種別の絞り込み・すべて既読・セキュリティ通知は遷移せず既読化（ナビ/相互作用＝テスト規約 §7）。
// backend 非依存（送信/既読はクライアント状態のみ）。OPS でログインして /notifications を検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

async function gotoNotifications(page: Page) {
  await login(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "通知", exact: true })).toBeVisible();
}

// 初期表示＝未読4件・日付グループ（今日/昨日/それ以前）が出る。
test("notifications render with unread count and date groups", async ({ page }) => {
  await gotoNotifications(page);
  await expect(page.getByText("4 件の未読")).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "昨日", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "それ以前", exact: true })).toBeVisible();
});

// 状態=未読のみ＝既読通知が消え未読通知は残る（未読件数は総数のまま）。
test("state filter: unread-only hides read notifications", async ({ page }) => {
  await gotoNotifications(page);
  await expect(page.getByText("実績 「目利き」")).toBeVisible(); // 既読（id4）
  await page.getByLabel("状態").selectOption("unread");
  await expect(page.getByText("実績 「目利き」")).toHaveCount(0); // 既読は消える
  await expect(page.getByText("さんがチャットであなたをメンションしました").first()).toBeVisible(); // 未読は残る
  await expect(page.getByText("4 件の未読")).toBeVisible(); // 件数は総未読のまま
});

// 種別=セキュリティ＝セキュリティ通知のみ（メンション等は消える）。
test("type filter: security shows only security notifications", async ({ page }) => {
  await gotoNotifications(page);
  await page.getByLabel("種別").selectOption("security");
  await expect(page.getByText("からログインがありました")).toBeVisible(); // 新しい端末（secdev）
  await expect(page.getByText("パスワードが変更されました")).toBeVisible(); // secpw
  await expect(page.getByText("さんがチャットであなたをメンションしました")).toHaveCount(0); // 非セキュリティは消える
});

// すべて既読にする＝未読0。
test("mark all read clears unread count", async ({ page }) => {
  await gotoNotifications(page);
  await page.getByRole("button", { name: "すべて既読にする" }).click();
  await expect(page.getByText("0 件の未読")).toBeVisible();
});

// セキュリティ通知（参照先なし）はクリックで遷移せず既読化のみ（未読4→3・URL 不変）。
test("security notification click marks read without navigating", async ({ page }) => {
  await gotoNotifications(page);
  await page.getByText("からログインがありました").click(); // secdev（href なし）
  await expect(page).toHaveURL(/\/notifications$/); // 遷移しない
  await expect(page.getByText("3 件の未読")).toBeVisible(); // 既読化で 4→3
});
