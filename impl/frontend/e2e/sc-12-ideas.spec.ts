import { expect, test, type Page } from "@playwright/test";

// SC-12 クエスト詳細のアイデアタブ（実接続・D.1／IDEAS_CHANGED）。一般ユーザー ACME-01 で、
// クエストを API 作成 → 詳細のアイデアタブが listIdeas の実データを描画し、SC-21 投稿が跨ルートで反映されることを確認。
// 分岐（可視性・門番等）は api レベル（D-TC-101〜118）で担保。根拠＝doc/テスト/D_アイデア.md §3・screens/SC-12。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}
function csrfOf(cookies: { name: string; value: string }[]) {
  return cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
}
async function createRecruiting(page: Page, title: string): Promise<string> {
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const groupId = groups.data?.[0]?.id;
  expect(groupId, "デモグループが必要（dev seed）").toBeTruthy();
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, color: "#0D9488", quest_group_id: groupId, categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E 目的", status: "recruiting" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}
async function createIdeaApi(page: Page, questId: string, title: string): Promise<void> {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, value: "E2E 価値", body: "E2E 本文", stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
}
async function deleteQuestQuiet(page: Page, id: string) {
  const csrf = csrfOf(await page.context().cookies());
  await page.request.delete(`/api/v1/quests/${id}`, { headers: { "X-CSRF-Token": csrf } });
}

// D-TC-205 一覧が実データで出る。
test("D-TC-205 SC-12 ideas tab renders listIdeas data", async ({ page }) => {
  await login(page);
  const questId = await createRecruiting(page, `E2Eタブ_${Date.now().toString().slice(-8)}`);
  const ititle = `一覧アイデア_${Date.now().toString().slice(-8)}`;
  await createIdeaApi(page, questId, ititle);
  try {
    await page.goto(`/quests/${questId}`);
    const region = page.getByRole("region", { name: "アイデア一覧" });
    await expect(region.getByText(ititle)).toBeVisible();
  } finally {
    await deleteQuestQuiet(page, questId);
  }
});

// D-TC-206 空→モーダル投稿→IDEAS_CHANGED で一覧へ反映（リロードなし）。
test("D-TC-206 SC-12 posted idea appears via IDEAS_CHANGED", async ({ page }) => {
  await login(page);
  const questId = await createRecruiting(page, `E2E反映_${Date.now().toString().slice(-8)}`);
  const ititle = `反映アイデア_${Date.now().toString().slice(-8)}`;
  try {
    await page.goto(`/quests/${questId}`);
    const region = page.getByRole("region", { name: "アイデア一覧" });
    await expect(region.getByText(/まだアイデアがありません/)).toBeVisible();

    // ＋ アイデアを追加 → URL モーダル（SC-21）で投稿。
    await page.getByRole("button", { name: "＋ アイデアを追加" }).click();
    await page.locator("#idea_subject").fill(ititle);
    await page.locator("#idea_value").fill("反映の価値");
    await page.locator("#idea_body").fill("反映の本文");
    await page.getByRole("button", { name: "投稿する" }).click();
    await expect(page.getByText("アイデアを投稿しました")).toBeVisible();

    // モーダルが閉じ、詳細のアイデアタブへ IDEAS_CHANGED で反映（リロードせず）。
    await expect(region.getByText(ititle)).toBeVisible();
  } finally {
    await deleteQuestQuiet(page, questId);
  }
});
