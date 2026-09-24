// SC-12 採否 UI（FR-41 Phase2・disposition）。C-TC-293。
// カードを成果物側コンテキストで開き（?from=quests:id）→「この情報の扱い」で採用/不採用を保存し、
// パネルへの反映（採用＝バッジ＋メモ／不採用＝既定パネルから非表示＋ヘッダー件数）を検証する。
// 根拠＝doc/テスト/C_クエスト.md・SC-12 §4.1d・SC-52 §7-採否・C.8b。
import { expect, test, type Page } from "@playwright/test";

const csrfOf = (c: { name: string; value: string }[]) => c.find((x) => x.name === "iq_csrf")?.value ?? "";

async function login(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

// カードを採否モードで開き、状態を選んで（任意でメモ）保存し、モーダルが閉じ切るまで待つ。
async function dispose(page: Page, panel: ReturnType<Page["locator"]>, title: string, choice: string, note?: string) {
  await panel.locator(".ri-card", { hasText: title }).locator(".ri-title a").click();
  await expect(page.getByText("この情報の扱い", { exact: false })).toBeVisible();
  await page.locator(".ri-dispose__choice", { hasText: choice }).first().click();
  if (note !== undefined) await page.locator(".ri-dispose textarea").fill(note);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.locator(".modal")).toHaveCount(0); // 閉じ切るまで待つ（次操作とのレース防止）
}

test("C-TC-293 SC-12 採否＝採用でメモ表示・不採用で非表示＋件数", async ({ page }) => {
  await login(page);
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const stamp = Date.now().toString().slice(-8);
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const quest = await page.request.post("/api/v1/quests", {
    headers: h,
    data: { title: `採否QT_${stamp}`, color: "#0D9488", quest_group_ids: [groups.data[0].id], categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E", status: "recruiting" },
  }).then((r) => r.json());
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `採否情報_${stamp}` } }).then((r) => r.json());
  const link = await page.request.post("/api/v1/info-links", { headers: h, data: { info_item_id: info.id, target_type: "quests", target_id: quest.id, kind: "related" } });
  expect(link.status(), await link.text()).toBe(201);
  const title = `採否情報_${stamp}`;
  const note = `案Aに反映_${stamp}`;
  try {
    await page.goto(`/quests/${quest.id}`);
    const panel = page.locator(".ri-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".ri-card", { hasText: title })).toBeVisible();

    // 採用＝カードに「採用」バッジ＋処理メモが出る。
    await dispose(page, panel, title, "採用", note);
    const adopted = panel.locator(".ri-card", { hasText: title });
    await expect(adopted.locator(".badge", { hasText: "採用" })).toBeVisible();
    await expect(adopted.locator(".ri-note", { hasText: note })).toBeVisible();

    // 不採用＝既定パネルから消え、ヘッダーに不採用件数が出る。
    await dispose(page, panel, title, "不採用");
    await expect(panel.locator(".ri-card", { hasText: title })).toHaveCount(0);
    await expect(panel.locator(".ri-head__declined")).toContainText("不採用");
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${quest.id}`, { headers: { "X-CSRF-Token": c2 } });
    await page.request.delete(`/api/v1/info-items/${info.id}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("C-TC-295 結果タブに採用関連情報＋処理メモが出る", async ({ page }) => {
  await login(page);
  const csrf = csrfOf(await page.context().cookies());
  const h = { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  const stamp = Date.now().toString().slice(-8);
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const quest = await page.request.post("/api/v1/quests", {
    headers: h,
    data: { title: `結果QT_${stamp}`, color: "#0D9488", quest_group_ids: [groups.data[0].id], categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E", status: "recruiting" },
  }).then((r) => r.json());
  const info = await page.request.post("/api/v1/info-items", { headers: h, data: { title: `結果情報_${stamp}` } }).then((r) => r.json());
  const link = await page.request.post("/api/v1/info-links", { headers: h, data: { info_item_id: info.id, target_type: "quests", target_id: quest.id, kind: "related" } }).then((r) => r.json());
  const note = `結果に反映_${stamp}`;
  const patched = await page.request.patch(`/api/v1/quests/${quest.id}/related-info/${link.id}`, { headers: h, data: { disposition: "adopted", note } });
  expect(patched.ok(), await patched.text()).toBeTruthy();
  try {
    await page.goto(`/quests/${quest.id}`);
    await expect(page.locator(".app-header")).toBeVisible();
    await page.getByRole("tab", { name: /結果/ }).click();
    const section = page.getByLabel("採用された関連情報");
    await expect(section).toBeVisible();
    await expect(section.getByText(`結果情報_${stamp}`)).toBeVisible();
    await expect(section.getByText(note)).toBeVisible();
    // 情報タイトルは参照モード（採否モード）で開く＝?from 付き→「この情報の扱い」が出る。
    await expect(section.getByText(`結果情報_${stamp}`)).toHaveAttribute("href", new RegExp(`from=quests`));
    await section.getByText(`結果情報_${stamp}`).click();
    await expect(page.getByText("この情報の扱い", { exact: false })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/quests/${quest.id}`, { headers: { "X-CSRF-Token": csrf } });
    await page.request.delete(`/api/v1/info-items/${info.id}`, { headers: { "X-CSRF-Token": csrf } });
  }
});
