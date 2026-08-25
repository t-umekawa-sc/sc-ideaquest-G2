import { expect, test, type Page } from "@playwright/test";

// SC-22 更新履歴モーダル（D.4 版タイムライン＋差分・実接続）。公開で初版 revision=1・PATCH で revision=2 を作り、
// 「版 N（履歴）」→モーダルに実データ（v2/v1〔初版〕・変更フィールド・差分セグメント）が出ることを確認する。
// 根拠＝doc/テスト/D_アイデア.md §3（D-TC-217）・API設計 D.4・screens/SC-22。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}
function csrfOf(c: { name: string; value: string }[]) { return c.find((x) => x.name === "iq_csrf")?.value ?? ""; }

async function createRecruiting(page: Page, title: string): Promise<string> {
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, color: "#0D9488", quest_group_id: groups.data[0].id, categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E 目的", status: "recruiting" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function createPublishedIdea(page: Page, questId: string, stamp: string): Promise<string> {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title: `履歴アイデア_${stamp}`, value: `価値_${stamp}`, body: `本文_${stamp}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function patchIdea(page: Page, ideaId: string, data: Record<string, unknown>) {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.patch(`/api/v1/ideas/${ideaId}`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data,
  });
  expect(res.status(), await res.text()).toBe(200);
}

// D-TC-217 更新履歴モーダルが実データ（版タイムライン＋差分）。
test("D-TC-217 SC-22 revision history modal renders real timeline and diff", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E履歴_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  // 公開＝初版 revision=1。本文/価値を編集 → revision=2。
  await patchIdea(page, ideaId, { value: `価値_${stamp}_改`, body: `本文_${stamp}_改` });
  try {
    await page.goto(`/ideas/${ideaId}`);
    // 「版 2（履歴）」ボタン→更新履歴モーダル。
    await page.getByRole("button", { name: /版.*（履歴）/ }).click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByText("更新履歴", { exact: true })).toBeVisible();

    // v1（初版）バッジ＝実データ（デモ文言でない）。
    await expect(modal.getByText("初版", { exact: true })).toBeVisible();
    // v2 の変更フィールドバッジ（価値・アイデア本文）。
    await expect(modal.getByText("アイデア本文", { exact: true })).toBeVisible();
    await expect(modal.getByText("価値", { exact: true })).toBeVisible();

    // v2 の差分を展開＝getRevisionDiff の add/del セグメントが出る。
    await modal.getByText("差分を表示", { exact: true }).click();
    await expect(modal.locator(".diff-add").first()).toBeVisible();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
