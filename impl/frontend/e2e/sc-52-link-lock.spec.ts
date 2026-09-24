// SC-52 情報側リンク編集＝採否ロックの可視化（FR-41 Phase2）。N-TC-225。
// 成果物側で採用（adopted）にしたリンクは、情報側の「リンクを編集」で種別コンボが非活性＋🔒バッジになり、
// 棄却（✕）が出ない（成果物側で未処理に戻すまでロック）。
// 根拠＝doc/テスト/N_情報インプット.md・SC-52 §7-採否・N.3-採否。
import { expect, test, type Page } from "@playwright/test";

const csrfOf = (c: { name: string; value: string }[]) => c.find((x) => x.name === "iq_csrf")?.value ?? "";

async function login(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

test("N-TC-225 情報側リンク編集で採否ロックが分かる（コンボ非活性＋🔒）", async ({ page }) => {
  await login(page);
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const stamp = Date.now().toString().slice(-8);
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const quest = await page.request.post("/api/v1/quests", {
    headers: h,
    data: { title: `ロックQT_${stamp}`, color: "#0D9488", quest_group_ids: [groups.data[0].id], categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E", status: "recruiting" },
  }).then((r) => r.json());
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `ロック情報_${stamp}` } }).then((r) => r.json());
  const link = await page.request.post("/api/v1/info-links", { headers: h, data: { info_item_id: info.id, target_type: "quests", target_id: quest.id, kind: "related" } }).then((r) => r.json());
  // 成果物側で採用（adopted）に採否＝ロックがかかる。
  const patched = await page.request.patch(`/api/v1/quests/${quest.id}/related-info/${link.id}`, { headers: h, data: { disposition: "adopted", note: "採用メモ" } });
  expect(patched.ok(), await patched.text()).toBeTruthy();
  try {
    await page.goto(`/info-items/${info.id}`);
    await expect(page.locator(".app-header")).toBeVisible();
    await page.getByRole("button", { name: /リンクを編集/ }).click();
    const locked = page.locator(".link-item.is-locked", { hasText: `ロックQT_${stamp}` });
    await expect(locked).toBeVisible();
    await expect(locked.locator("select.link-kind")).toBeDisabled();          // コンボ非活性
    await expect(locked.locator(".badge", { hasText: "採用" })).toBeVisible();  // 🔒 採用 バッジ
    await expect(locked.locator(".link-item__rm")).toHaveCount(0);            // ✕棄却は出さない
  } finally {
    await page.request.delete(`/api/v1/quests/${quest.id}`, { headers: { "X-CSRF-Token": csrf } });
    await page.request.delete(`/api/v1/info-items/${info.id}`, { headers: { "X-CSRF-Token": csrf } });
  }
});
