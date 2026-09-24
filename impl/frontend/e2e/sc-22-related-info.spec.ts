// SC-22 アイデア詳細＝概要直下「関連情報ストリップ」（FR-41・情報インプット連携・D related-info）。
// クエスト SC-12 と同じ strip 配置（概要カードの直下・全幅）。
// D-TC-237: リンクした情報がストリップにカード表示され、反証は⚠強調＋ヘッダーに反証件数が出る。
// D-TC-238: 「＋ 関連情報を追加」で既存情報を関連付けできる（成果物→情報・逆向きピッカー）。
// 根拠＝doc/テスト/D_アイデア.md・SC-22・API設計 D（related-info）／N.3。
import { expect, test, type Page } from "@playwright/test";

const csrfOf = (c: { name: string; value: string }[]) => c.find((x) => x.name === "iq_csrf")?.value ?? "";

async function login(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

// user@acme が owner の recruiting クエスト＋public アイデアを作成し idea id を返す。
async function createIdea(page: Page, tag: string): Promise<{ questId: string; ideaId: string }> {
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const quest = await page.request.post("/api/v1/quests", {
    headers: h,
    data: { title: `関連情報IDEA_QT_${tag}`, color: "#0D9488", quest_group_ids: [groups.data[0].id], categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E", status: "recruiting" },
  }).then((r) => r.json());
  const idea = await page.request.post(`/api/v1/quests/${quest.id}/ideas`, {
    headers: h,
    data: { title: `関連情報アイデア_${tag}`, value: `v_${tag}`, body: `b_${tag}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(idea.status(), await idea.text()).toBe(201);
  return { questId: quest.id, ideaId: (await idea.json()).id as string };
}

test("D-TC-237 SC-22 概要直下の関連情報ストリップにリンク情報が出る（反証は⚠）", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const { questId, ideaId } = await createIdea(page, stamp);
  // 情報を作成し、反証としてこのアイデアへ関連付け。
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `反証情報_${stamp}` } }).then((r) => r.json());
  const link = await page.request.post("/api/v1/info-links", { headers: h, data: { info_item_id: info.id, target_type: "ideas", target_id: ideaId, kind: "refuting" } });
  expect(link.status(), await link.text()).toBe(201);
  try {
    await page.goto(`/ideas/${ideaId}`);
    await expect(page.locator(".app-header")).toBeVisible();
    const panel = page.locator(".ri-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".ri-head__title")).toContainText("関連情報");
    await expect(panel.locator(".ri-head__alert")).toContainText("反証"); // ヘッダーに反証件数
    const card = panel.locator(".ri-card", { hasText: `反証情報_${stamp}` });
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/is-refuting/);
    await expect(card.locator(".badge", { hasText: "反証" })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": csrf } });
    await page.request.delete(`/api/v1/info-items/${info.id}`, { headers: { "X-CSRF-Token": csrf } });
  }
});

test("D-TC-238 SC-22 ストリップの「＋ 関連情報を追加」で既存情報を関連付けできる（成果物→情報）", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const { questId, ideaId } = await createIdea(page, stamp);
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `追加候補情報_${stamp}` } }).then((r) => r.json());
  try {
    await page.goto(`/ideas/${ideaId}`);
    await expect(page.locator(".app-header")).toBeVisible();
    const panel = page.locator(".ri-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".ri-card")).toHaveCount(0); // 初期は関連なし
    await panel.getByRole("button", { name: /関連情報を追加/ }).click();
    await page.getByRole("searchbox", { name: "情報を検索" }).fill(stamp);
    const row = page.locator(".pick-row", { hasText: `追加候補情報_${stamp}` });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole("button", { name: /選択を確定/ }).click();
    await expect(panel.locator(".ri-card", { hasText: `追加候補情報_${stamp}` })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": csrf } });
    await page.request.delete(`/api/v1/info-items/${info.id}`, { headers: { "X-CSRF-Token": csrf } });
  }
});
