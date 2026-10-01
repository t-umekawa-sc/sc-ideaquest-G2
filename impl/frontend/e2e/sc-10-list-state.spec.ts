import { expect, test, type Page } from "@playwright/test";

// M-TC-016/017: 一覧の操作状態（検索/ソート/絞込/ページ）の URL 復元（デザイン標準 §4.5⑨・横断標準）。
// 共通コンポーネント DataTable が検索/ソート/絞込/ページを ?<storageKey>.q/.sort/.f/.page に同期（router.replace）し、
// 詳細へ遷移して戻る（pop）と離脱前の操作状態を復元する。機構は全一覧で共通＝SC-10 クエスト一覧で代表検証。
// 根拠＝doc/テスト/M_共通シェル・ナビ.md M-TC-016/017／デザイン標準 §4.5⑨。
const OWNER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

// 募集中クエスト（非下書き）を user@acme 所有で1件作る。デモグループ（GET /quest-groups）があれば所属させる。
async function createRecruiting(page: Page, title: string): Promise<void> {
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const csrf = (await page.context().cookies()).find((c) => c.name === "iq_csrf")?.value ?? "";
  const res = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: {
      title, color: "#0D9488",
      quest_group_ids: groups.data?.length ? [groups.data[0].id] : [],
      categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E 目的", status: "recruiting",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

// 一覧の状態復元/ソート/列設定の検証には、user@acme が参加する（カード表示される）クエストが複数必要。
// pristine DB では user@acme はクエスト未参加のため、各テストが自前で募集中クエストを2件用意する
// （seed 非依存・自己完結＝デモ seed のクエスト有無や他テストの生成物に依存しない）。
test.beforeEach(async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  await createRecruiting(page, `一覧状態A_${stamp}`);
  await createRecruiting(page, `一覧状態B_${stamp}`);
});

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

// M-TC-018: 列設定ポップオーバーがウィンドウ内に収まり全候補に到達できる（受入不具合＝下余白不足時に候補が画面外へ）。
// 短いビューポートで下余白を不足させ、列設定を開いても .col-menu がウィンドウをはみ出さない（bottom≤innerHeight・top≥0）ことを検証。
test("M-TC-018 column-settings popover stays within the window on short viewport", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 520 }); // 下余白不足を誘発
  await page.goto("/quests");
  await expect(page.locator("a.quest-card").first()).toBeVisible({ timeout: 12000 });
  await page.getByTitle("リスト表示").click();
  await page.getByRole("button", { name: "列設定" }).click();
  const menu = page.locator(".col-menu");
  await expect(menu).toBeVisible();
  const fits = await page.evaluate(() => {
    const m = document.querySelector(".col-menu") as HTMLElement | null;
    if (!m) return { ok: false };
    const r = m.getBoundingClientRect();
    return { ok: r.bottom <= window.innerHeight + 1 && r.top >= -1, scrollable: m.scrollHeight > m.clientHeight - 1 };
  });
  expect(fits.ok, "列設定メニューがウィンドウ内に収まる").toBe(true);
});
