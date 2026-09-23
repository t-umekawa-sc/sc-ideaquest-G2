import { expect, test, type Page } from "@playwright/test";

// SC-11 クエスト作成（実接続・C.2）＋ URL 付きモーダル（Parallel@modal＋Intercept）＋入力検証 §4.7。
// 一般ユーザー ACME-01（デモグループ所属・handoff §4-4 の dev seed 前提）でログインし、
// /quests から作成モーダルの開閉・直アクセス・検証・下書き作成→一覧反映を確認する。
// 根拠＝doc/画面設計/screens/SC-11／API設計 C.2／デザイン標準 §4.7／フロントエンド実装フロー規約 §1.1。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
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
test("C-TC-201 quest-create URL modal opens from list and closes", async ({ page }) => {
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
test("C-TC-202 quest-create direct access renders full page (no modal)", async ({ page }) => {
  await login(page);
  await page.goto("/quests/new");
  await expect(page.getByRole("heading", { name: "クエスト作成" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// §4.7: 必須未入力で「クエストを作成」＝上部サマリ＋インライン aria-invalid、遷移しない（フォーカス移動もしない）。
test("C-TC-203 SC-11 validation shows inline errors and summary on empty submit", async ({ page }) => {
  await login(page);
  await page.goto("/quests/new"); // フルページで検証（モーダルと同一フォーム）
  await page.getByRole("button", { name: "クエストを作成" }).click();

  await expect(page.locator(".form-summary")).toBeVisible();
  await expect(page.locator("#q_name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { name: "クエスト作成" })).toBeVisible(); // 遷移していない
});

// 実接続: 下書きを作成→一覧に下書きが出る（GET /quest-groups の実データ＝デモグループを使用）。
test("C-TC-204 SC-11 create draft persists and appears in list", async ({ page }) => {
  await login(page);
  const title = `E2E下書き_${Date.now().toString().slice(-8)}`;
  try {
    await page.goto("/quests/new");
    await page.locator("#q_name").fill(title);
    await page.getByRole("button", { name: "＋ 業務改善" }).click(); // カテゴリ候補を1件追加
    await page.locator("#q_deadline").fill("2026-12-31");
    await page.locator("#q_theme").fill("E2E テスト用の目的・テーマ");
    // 参加部署は FR-38 で Multiselect（0件=全社）＝単一既定選択の #q_group は廃止。未選択（全社）のまま下書き保存できる。
    await page.getByRole("button", { name: "下書き保存" }).click();

    await expect(page).toHaveURL(/\/quests$/);
    await expect(page.getByText(title)).toBeVisible();
  } finally {
    await cleanupByTitlePrefix(page, title);
  }
});

// C-TC-278（回帰）SC-11 作成モーダルの発見トグルを押してもレイアウトが崩れない（フッターが下端固定のまま）。
// 受入不具合＝短ビューポートで .switch のトグルを押すとモーダル本文が大きくスクロールしフッターが上へ飛び
// 下に大きな空白が出た。原因＝`.switch` に position:relative が無く視覚隠しの checkbox(position:absolute) が
// 位置指定祖先を失って画面外へ→クリック/フォーカスでブラウザの scroll-into-view がモーダルをスクロール。
// 修正＝`.switch{position:relative}`＋input を left/top:0 で封じ込め。表示/挙動ガード＝e2e（テスト規約 §5.3）。
test("C-TC-278 SC-11 discoverable toggle keeps modal footer pinned (no layout jump)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 }); // フッターが見えるまでスクロールが要る高さ
  await login(page);
  await page.goto("/quests");
  await page.getByRole("link", { name: /クエストを作成/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const toggle = page.locator("label.switch");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click(); // 発見カタログ ON

  // フッターがパネル下端に固定されたまま（崩れると footer が上方へ飛び panel 下端と乖離する）。
  const pinned = await page.evaluate(() => {
    const foot = document.querySelector(".modal__footer")!.getBoundingClientRect();
    const panel = document.querySelector(".modal__panel")!.getBoundingClientRect();
    return Math.abs(foot.bottom - panel.bottom) < 3;
  });
  expect(pinned).toBe(true);
});

// C-TC-284: 編集で無変更保存＝updateQuest を呼ばず info「変更はありません」（保存ボタン統一・デザイン標準 §14）。
// API で recruiting クエストを作成（作成者=user@acme＝編集可）→編集ページを開き、何も変えず「保存する」。
test("C-TC-284 no-change edit save shows info toast (no success)", async ({ page }) => {
  await login(page);
  const prefix = "E2E無変更編集_";
  const title = `${prefix}${Date.now().toString().slice(-8)}`;
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const csrf = (await page.context().cookies()).find((c) => c.name === "iq_csrf")?.value ?? "";
  const created = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: {
      title, color: "#0D9488", quest_group_ids: [groups.data[0].id],
      categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E目的", status: "recruiting",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id as string;
  try {
    await page.goto(`/quests/${id}/edit`);
    await expect(page.locator("#q_name")).toHaveValue(title); // プリフィル完了＝シグネチャ確定

    await page.getByRole("button", { name: "保存する", exact: true }).click(); // edit-save（recruiting）
    await expect(page.getByText("変更はありません")).toBeVisible();
    await expect(page.getByText("クエストを保存しました")).toHaveCount(0);
  } finally {
    await cleanupByTitlePrefix(page, prefix);
  }
});
