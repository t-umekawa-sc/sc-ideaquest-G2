import { expect, test, type Page } from "@playwright/test";

// SC-11 クエスト作成（実接続・C.2）＋ URL 付きモーダル（Parallel@modal＋Intercept）＋入力検証 §4.7。
// 一般ユーザー ACME-01（デモグループ所属・handoff §4-4 の dev seed 前提）でログインし、
// /quests から作成モーダルの開閉・直アクセス・検証・下書き作成→一覧反映を確認する。
// 根拠＝doc/画面設計/screens/SC-11／API設計 C.2／デザイン標準 §4.7／フロントエンド実装フロー規約 §1.1。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// 実 DB に作ったクエストを API で後片付け（title 前方一致・同一 Cookie の CSRF を載せる）。
async function cleanupByTitlePrefix(page: Page, prefix: string) {
  const res = await page.request.get("/api/v1/quests?limit=100");
  if (!res.ok()) return;
  const body = await res.json();
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
  for (const q of body.data ?? []) {
    if (typeof q.title === "string" && q.title.startsWith(prefix)) {
      await page.request.delete(`/api/v1/quests/${q.id}`, { headers: { "X-CSRF-Token": csrf } });
    }
  }
}

// 一覧からのソフト遷移＝モーダルで差し込まれ、Esc で閉じて一覧へ戻る（URL を持つモーダル）。
test("quest-create URL modal opens from list and closes", async ({ page }) => {
  await login(page);
  await page.goto("/quests");
  await page.getByRole("link", { name: /クエストを作成/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /クエストを作成/ })).toBeVisible();
  await expect(page).toHaveURL(/\/quests\/new$/);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/quests$/);
});

// 直アクセス/リロードはフルページにフォールバック（モーダルではない）。
test("quest-create direct access renders full page (no modal)", async ({ page }) => {
  await login(page);
  await page.goto("/quests/new");
  await expect(page.getByRole("heading", { name: "クエスト作成" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// §4.7: 必須未入力で「クエストを作成」＝上部サマリ＋インライン aria-invalid、遷移しない（フォーカス移動もしない）。
test("SC-11 validation shows inline errors and summary on empty submit", async ({ page }) => {
  await login(page);
  await page.goto("/quests/new"); // フルページで検証（モーダルと同一フォーム）
  await page.getByRole("button", { name: "クエストを作成" }).click();

  await expect(page.locator(".form-summary")).toBeVisible();
  await expect(page.locator("#q_name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { name: "クエスト作成" })).toBeVisible(); // 遷移していない
});

// 実接続: 下書きを作成→一覧に下書きが出る（GET /quest-groups の実データ＝デモグループを使用）。
test("SC-11 create draft persists and appears in list", async ({ page }) => {
  await login(page);
  const title = `E2E下書き_${Date.now().toString().slice(-8)}`;
  try {
    await page.goto("/quests/new");
    await page.locator("#q_name").fill(title);
    await page.getByRole("button", { name: "＋ 業務改善" }).click(); // カテゴリ候補を1件追加
    await page.locator("#q_deadline").fill("2026-12-31");
    await page.locator("#q_theme").fill("E2E テスト用の目的・テーマ");
    await expect(page.locator("#q_group")).not.toHaveValue(""); // 実データのグループが既定選択
    await page.getByRole("button", { name: "下書き保存" }).click();

    await expect(page).toHaveURL(/\/quests$/);
    await expect(page.getByText(title)).toBeVisible();
  } finally {
    await cleanupByTitlePrefix(page, title);
  }
});
