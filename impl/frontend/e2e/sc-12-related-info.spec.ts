// SC-12 クエスト詳細＝上部「関連情報ストリップ」（FR-41・情報インプット連携・C.8b）。
// C-TC-287: リンクした情報がストリップにカード表示され、反証は⚠強調＋ヘッダーに反証件数が出る。
// 根拠＝doc/テスト/C_クエスト.md・SC-12 §4.1d・API設計 C.8b。
import { expect, test, type Page } from "@playwright/test";

const csrfOf = (c: { name: string; value: string }[]) => c.find((x) => x.name === "iq_csrf")?.value ?? "";

async function login(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

test("C-TC-287 SC-12 上部の関連情報ストリップにリンク情報が出る（反証は⚠）", async ({ page }) => {
  await login(page);
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  // user@acme が owner のクエストを作成（自分がパーティー＝閲覧可）。
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const quest = await page.request.post("/api/v1/quests", {
    headers: h,
    data: { title: `関連情報QT_${Date.now()}`, color: "#0D9488", quest_group_ids: [groups.data[0].id], categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E", status: "recruiting" },
  }).then((r) => r.json());
  // 情報を作成し、反証としてこのクエストへ関連付け。
  const stamp = Date.now().toString().slice(-8);
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `反証情報_${stamp}` } }).then((r) => r.json());
  const link = await page.request.post("/api/v1/info-links", { headers: h, data: { info_item_id: info.id, target_type: "quests", target_id: quest.id, kind: "refuting" } });
  expect(link.status(), await link.text()).toBe(201);
  try {
    await page.goto(`/quests/${quest.id}`);
    await expect(page.locator(".app-header")).toBeVisible();
    // 上部ストリップが出る。
    const panel = page.locator(".ri-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".ri-head__title")).toContainText("関連情報");
    await expect(panel.locator(".ri-head__alert")).toContainText("反証"); // ヘッダーに反証件数
    // リンクした情報がカードで出て、反証バッジ＋⚠強調。
    const card = panel.locator(".ri-card", { hasText: `反証情報_${stamp}` });
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/is-refuting/);
    await expect(card.locator(".badge", { hasText: "反証" })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/quests/${quest.id}`, { headers: { "X-CSRF-Token": csrf } });
    await page.request.delete(`/api/v1/info-items/${info.id}`, { headers: { "X-CSRF-Token": csrf } });
  }
});

test("C-TC-288 SC-12 ストリップの「＋ 関連情報を追加」で既存情報を関連付けできる（成果物→情報）", async ({ page }) => {
  await login(page);
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const quest = await page.request.post("/api/v1/quests", {
    headers: h,
    data: { title: `追加QT_${Date.now()}`, color: "#0D9488", quest_group_ids: [groups.data[0].id], categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E", status: "recruiting" },
  }).then((r) => r.json());
  const stamp = Date.now().toString().slice(-8);
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `追加候補情報_${stamp}` } }).then((r) => r.json());
  try {
    await page.goto(`/quests/${quest.id}`);
    await expect(page.locator(".app-header")).toBeVisible();
    const panel = page.locator(".ri-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".ri-card")).toHaveCount(0); // 初期は関連なし
    // ＋ 関連情報を追加 → 検索 → 選択 → 確定。
    await panel.getByRole("button", { name: /関連情報を追加/ }).click();
    await page.getByRole("searchbox", { name: "情報を検索" }).fill(stamp);
    const row = page.locator(".pick-row", { hasText: `追加候補情報_${stamp}` });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole("button", { name: /選択を確定/ }).click();
    // ストリップに追加した情報がカードで出る（INFO_CHANGED_EVENT で再取得）。
    await expect(panel.locator(".ri-card", { hasText: `追加候補情報_${stamp}` })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/quests/${quest.id}`, { headers: { "X-CSRF-Token": csrf } });
    await page.request.delete(`/api/v1/info-items/${info.id}`, { headers: { "X-CSRF-Token": csrf } });
  }
});
