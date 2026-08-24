import { expect, test, type Page } from "@playwright/test";

// SC-22 投票（D.5）・フォロー（D.6）のフロント接続 e2e。楽観更新＋サーバー権威。
// 根拠＝doc/テスト/D_アイデア.md §3（D-TC-209〜212）・screens/SC-22 §4.5・API設計 D.5/D.6。
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
    data: { title: `投票アイデア_${stamp}`, value: `価値_${stamp}`, body: `本文_${stamp}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function myVoteOf(page: Page, ideaId: string): Promise<string | null> {
  const d = await page.request.get(`/api/v1/ideas/${ideaId}`).then((r) => r.json());
  return (d.vote?.my_vote ?? null) as string | null;
}

test("D-TC-209 SC-22 vote approve reflects tally and highlight", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E投票_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}`);
    const agree = page.getByRole("button", { name: "▲ 賛成" });
    await expect(agree).toBeEnabled();
    await agree.click();
    // 集計＝賛成 1・ボタンがハイライト（aria-pressed）。
    await expect(page.getByText("▲ 賛成 1")).toBeVisible();
    await expect(agree).toHaveAttribute("aria-pressed", "true");
    // サーバー権威＝my_vote=approve。
    await expect.poll(() => myVoteOf(page, ideaId)).toBe("approve");
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("D-TC-210 SC-22 vote switch approve to oppose (one vote)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E切替_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}`);
    const agree = page.getByRole("button", { name: "▲ 賛成" });
    const oppose = page.getByRole("button", { name: "▼ 反対" });
    await agree.click();
    await expect(page.getByText("▲ 賛成 1")).toBeVisible();
    // 切替＝反対 1・賛成 0（1人1票）。
    await oppose.click();
    await expect(page.getByText("▼ 反対 1")).toBeVisible();
    await expect(page.getByText("▲ 賛成 0")).toBeVisible();
    await expect(oppose).toHaveAttribute("aria-pressed", "true");
    await expect(agree).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => myVoteOf(page, ideaId)).toBe("oppose");
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("D-TC-211 SC-22 vote cancel by re-clicking same button", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E取消_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}`);
    const agree = page.getByRole("button", { name: "▲ 賛成" });
    await agree.click();
    await expect(page.getByText("▲ 賛成 1")).toBeVisible();
    await expect.poll(() => myVoteOf(page, ideaId)).toBe("approve");
    // 同ボタン再クリック＝取消。
    await agree.click();
    await expect(page.getByText("▲ 賛成 0")).toBeVisible();
    await expect(agree).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => myVoteOf(page, ideaId)).toBeNull();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("D-TC-212 SC-22 follow then unfollow (toggle)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2Eフォロー_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const followingOf = async () => (await page.request.get(`/api/v1/ideas/${ideaId}`).then((r) => r.json())).following as boolean;
  try {
    await page.goto(`/ideas/${ideaId}`);
    const follow = page.getByRole("button", { name: /フォロー/ });
    await expect(follow).toHaveText("☆ フォロー");
    await follow.click();
    await expect(follow).toHaveText("★ フォロー中");
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    await expect.poll(followingOf).toBe(true);
    // 再クリック＝解除。
    await follow.click();
    await expect(follow).toHaveText("☆ フォロー");
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await expect.poll(followingOf).toBe(false);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
