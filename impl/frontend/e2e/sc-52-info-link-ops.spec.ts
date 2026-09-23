// SC-52 情報詳細＝関連リンクのインライン編集（会社内全員・保存前に即反映）。
// N-TC-220: 種別変更で完了トーストが「最前面」に出る（モーダル起動中も見える＝z-index 回帰・DFT）。
// N-TC-221: 種別変更で関連リンクの並び順が変わらない（種別依存の並び替えを起こさない・DFT）。
// 根拠＝doc/テスト/N_情報インプット.md §3・SC-52・デザイン標準 §14（完了通知）。
import { expect, test, type Page } from "@playwright/test";

const CREDS = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  // storageState（auth.setup.ts）で user@acme 認証済み＝ホームへ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}
const csrfOf = (c: { name: string; value: string }[]) => c.find((x) => x.name === "iq_csrf")?.value ?? "";

// 情報＋関連リンク（related）を API で n 件用意し、情報 id を返す。
async function seedInfoWithLinks(page: Page, n: number): Promise<{ infoId: string; titles: string[] }> {
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `LINKOPS_${Date.now()}` } }).then((r) => r.json());
  const cand = await page.request.get(`/api/v1/info-link-candidates?limit=${n}`).then((r) => r.json());
  const items = (cand.candidates ?? cand.data ?? []).slice(0, n);
  expect(items.length, "リンク候補が不足").toBe(n);
  for (const c of items) {
    const r = await page.request.post("/api/v1/info-links", { headers: h, data: { info_item_id: info.id, target_type: c.target_type, target_id: c.target_id, kind: "related" } });
    expect(r.status(), await r.text()).toBe(201);
  }
  return { infoId: info.id, titles: items.map((c: { title: string }) => c.title) };
}

async function cleanup(page: Page, infoId: string) {
  const csrf = csrfOf(await page.context().cookies());
  await page.request.delete(`/api/v1/info-items/${infoId}`, { headers: { "X-CSRF-Token": csrf } });
}

test("N-TC-220 リンク種別変更で完了トーストが最前面に出る（モーダル起動中も見える）", async ({ page }) => {
  await login(page);
  const { infoId } = await seedInfoWithLinks(page, 1);
  try {
    await page.goto(`/info-items/${infoId}`);
    await expect(page.locator(".app-header")).toBeVisible();
    await page.getByRole("button", { name: /リンクを編集/ }).click();
    await page.locator("select.link-kind").first().selectOption("supporting");
    // 完了トーストが表示され、文言が出る（保存する前に反映済みが分かる）。
    const snack = page.locator(".snackbar", { hasText: "関連リンク" });
    await expect(snack).toBeVisible();
    // 最前面＝スナックバー z-index がモーダル(80)より十分上（回帰防止）。
    const z = await page.locator(".snackbar-stack").evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(z).toBeGreaterThan(100);
    // モーダル表示中でも「実際に見える」こと＝computed opacity>0（body.modal-open の背景アニメ停止で
    // 登場アニメが paused になり opacity 0 のまま裏に隠れる回帰を防ぐ・toBeVisible は opacity0 を検出しない）。
    await expect.poll(async () => Number(await snack.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
  } finally {
    await cleanup(page, infoId);
  }
});

test("N-TC-221 リンク種別変更で並び順が変わらない", async ({ page }) => {
  await login(page);
  const { infoId } = await seedInfoWithLinks(page, 2);
  try {
    await page.goto(`/info-items/${infoId}`);
    await expect(page.locator(".app-header")).toBeVisible();
    await page.getByRole("button", { name: /リンクを編集/ }).click();
    const titlesBefore = await page.locator(".link-item:not(.is-rejected) .link-item__title").allInnerTexts();
    expect(titlesBefore.length).toBe(2);
    // 先頭リンクの種別を related→supporting に変更（種別依存の並び替えを誘発する操作）。
    await page.locator(".link-item:not(.is-rejected) select.link-kind").first().selectOption("supporting");
    await expect(page.locator(".snackbar", { hasText: "関連リンク" })).toBeVisible(); // 反映完了を待つ
    const titlesAfter = await page.locator(".link-item:not(.is-rejected) .link-item__title").allInnerTexts();
    expect(titlesAfter).toEqual(titlesBefore); // 並び順は不変
  } finally {
    await cleanup(page, infoId);
  }
});
