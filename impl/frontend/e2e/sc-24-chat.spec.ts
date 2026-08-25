import { expect, test, type Page } from "@playwright/test";

// SC-24 アイデアチャット（E 実接続）＝メッセージ投稿→スレッド反映＋通常リアクション。ACME-01（owner＝comment 権限）で、
// recruiting クエスト＋published アイデア（公開で chat_group 自動作成）を API で用意して確認する。
// 根拠＝doc/テスト/E_チャット.md §3（E-TC-201）・API設計 E.1/E.2/E.4・screens/SC-24。
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
    data: { title: `チャットアイデア_${stamp}`, value: `価値_${stamp}`, body: `本文_${stamp}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

test("E-TC-201 SC-24 post message appears and normal reaction", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2Eチャット_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const body = `テスト投稿_${stamp}`;
  try {
    await page.goto(`/ideas/${ideaId}/chat`);
    await expect(page.getByText(`チャットアイデア_${stamp}`)).toBeVisible(); // 文脈が実データ

    // 投稿→スレッドに出る（postMessage→getChat）。
    await page.locator(".composer__box").fill(body);
    await page.getByRole("button", { name: "送信", exact: true }).click();
    const msg = page.locator(".msg", { hasText: body });
    await expect(msg.locator(".msg__text")).toContainText(body);

    // ＋→ピッカー→👍 で通常リアクション（addReaction）。
    await msg.locator(".reaction-add").click();
    await page.locator(".reaction-picker .rp__emoji", { hasText: "👍" }).click();
    await expect(msg.locator(".reaction", { hasText: "👍" })).toBeVisible();

    // サーバー権威（GET chat に1件・reactions に👍）。
    const chat = await page.request.get(`/api/v1/ideas/${ideaId}/chat`).then((r) => r.json());
    expect(chat.data.length).toBe(1);
    expect(chat.data[0].reactions.normal.some((n: { emoji: string }) => n.emoji === "👍")).toBe(true);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
