import { expect, test, type Page } from "@playwright/test";

// SC-22 の quest 参照（D.1）＝「クエストへ戻る」実導線・カテゴリーバッジ・completed 事前無効化。
// 根拠＝doc/テスト/D_アイデア.md §3（D-TC-213/214）・screens/SC-22 §4.5・API設計 D.1/C.5。
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

async function createRecruiting(page: Page, title: string, categories: string[]): Promise<string> {
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, color: "#0D9488", quest_group_id: groups.data[0].id, categories, deadline: "2026-12-31", purpose: "E2E 目的", status: "recruiting" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function createPublishedIdea(page: Page, questId: string, stamp: string): Promise<string> {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title: `参照アイデア_${stamp}`, value: `価値_${stamp}`, body: `本文_${stamp}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function transition(page: Page, questId: string, to: string) {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post(`/api/v1/quests/${questId}/transition`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { to },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test("D-TC-213 SC-22 back link targets the quest and shows category badge", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E参照_${stamp}`, ["業務改善"]);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}`);
    // 「クエストへ戻る」が一覧固定でなく当該クエストを指す。
    const back = page.getByRole("link", { name: /へ戻る/ });
    await expect(back).toHaveAttribute("href", `/quests/${questId}`);
    // クエストのカテゴリーバッジがヘッダーに出る。
    await expect(page.getByLabel("アイデア情報").getByText("業務改善", { exact: true })).toBeVisible();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("D-TC-214 SC-22 completed quest disables vote and new follow", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E凍結_${stamp}`, ["業務改善"]);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  // アイデア公開後にクエストを完了へ前進（recruiting→in_progress→evaluating→completed）。
  await transition(page, questId, "in_progress");
  await transition(page, questId, "evaluating");
  await transition(page, questId, "completed");
  try {
    await page.goto(`/ideas/${ideaId}`);
    // 凍結バッジ＋投票/新規フォローの事前無効化。
    await expect(page.getByText("⏸ 完了（凍結）")).toBeVisible();
    await expect(page.getByRole("button", { name: "▲ 賛成" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "▼ 反対" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "☆ フォロー" })).toBeDisabled();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
