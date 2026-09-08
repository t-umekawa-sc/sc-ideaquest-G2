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
  // ログイン成立の判定＝/login を抜けて共通ヘッダーが出る（挨拶文は時間帯で変わり「ようこそ」は存在しないため使わない）。
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}
function csrfOf(c: { name: string; value: string }[]) { return c.find((x) => x.name === "iq_csrf")?.value ?? ""; }

// 入力欄は既定で最小化（composerMin=true・スリムバー .composer__mini）。textarea .composer__box を使う前に展開する。
async function openComposer(page: Page) {
  const box = page.locator(".composer__box");
  if (await box.isVisible().catch(() => false)) return; // 既に展開済み（送信では再最小化しない）
  await page.locator(".composer__mini").click(); // click が mini の出現/操作可能を auto-wait（描画前の競合を回避）
  await expect(box).toBeVisible();
}

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

    // 投稿→スレッドに出る（postMessage→getChat）。入力欄は既定で最小化なので展開してから入力。
    await openComposer(page);
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

async function postMsg(page: Page, ideaId: string, body: string) {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post("/api/v1/chat-messages", {
    headers: { "X-CSRF-Token": csrf },
    multipart: { idea_id: ideaId, body },
  });
  expect(res.status(), await res.text()).toBe(201);
}

// E-TC-203 SC-24 複数引用返信＝2件を引用して1つの返信に積む。
test("E-TC-203 SC-24 multiple quotes in one reply", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E複数引用_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}/chat`);
    await openComposer(page); // 既定で最小化された入力欄を展開
    // 2件投稿。
    for (const t of [`親A_${stamp}`, `親B_${stamp}`]) {
      await page.locator(".composer__box").fill(t);
      await page.getByRole("button", { name: "送信", exact: true }).click();
      await expect(page.locator(".msg", { hasText: t })).toBeVisible();
    }
    // 2件を💬で引用（ホバーアクション）。
    for (const t of [`親A_${stamp}`, `親B_${stamp}`]) {
      const m = page.locator(".msg", { hasText: t });
      await m.hover();
      await m.getByRole("button", { name: "引用返信" }).click();
    }
    await expect(page.locator(".reply-ctx__head")).toHaveText("引用返信（2件）");
    // まとめ返信を送信→2件の引用ブロック。
    await page.locator(".composer__box").fill(`まとめ_${stamp}`);
    await page.getByRole("button", { name: "送信", exact: true }).click();
    const reply = page.locator(".msg", { hasText: `まとめ_${stamp}` });
    await expect(reply.locator(".msg__quote")).toHaveCount(2);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-202 SC-22 §4.4 チャット活発度/プレビューが実データ。
test("E-TC-202 SC-22 chat activity and preview render real data", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E活発度_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const body = `プレビュー投稿_${stamp}`;
  await postMsg(page, ideaId, body);
  try {
    await page.goto(`/ideas/${ideaId}`);
    const chatCard = page.getByLabel("チャット");
    await expect(chatCard.getByText("💬 1")).toBeVisible(); // 実 total_messages
    await expect(chatCard.locator(".chat-preview").getByText(body)).toBeVisible();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// #17 reduce（GF-AC-172）＝reduce-motion では新着メッセージの登場（msg-enter）とリアクションのポップ（reaction-pop）が無効
// ＝即表示（投稿・受信・リアクション自体は正常）。実効抑制は OS reduce OR [data-anim-reduced]。
test.describe("reduce-motion #17", () => {
  test("G-TC-173 SC-24 message-enter and reaction-pop are disabled under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    const stamp = Date.now().toString().slice(-8);
    const questId = await createRecruiting(page, `E2E手触りR_${stamp}`);
    const ideaId = await createPublishedIdea(page, questId, stamp);
    const body = `テスト投稿R_${stamp}`;
    try {
      await page.goto(`/ideas/${ideaId}/chat`);
      await openComposer(page); // 既定で最小化された入力欄を展開
      // 投稿＝メッセージ行が出る／👍 でリアクションが出る（投稿・リアクションは reduce でも正常）。
      await page.locator(".composer__box").fill(body);
      await page.getByRole("button", { name: "送信", exact: true }).click();
      const msg = page.locator(".msg", { hasText: body });
      await expect(msg.locator(".msg__text")).toContainText(body);
      await msg.locator(".reaction-add").click();
      await page.locator(".reaction-picker .rp__emoji", { hasText: "👍" }).click();
      const reaction = msg.locator(".reaction", { hasText: "👍" });
      await expect(reaction).toBeVisible();

      // reduce では登場/ポップの animation が none。
      const rowAnim = await page.locator(".msg-row", { hasText: body }).first().evaluate((el) => getComputedStyle(el).animationName);
      expect(rowAnim).toBe("none");
      const reactAnim = await reaction.evaluate((el) => getComputedStyle(el).animationName);
      expect(reactAnim).toBe("none");
    } finally {
      const c2 = csrfOf(await page.context().cookies());
      await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
    }
  });
});
