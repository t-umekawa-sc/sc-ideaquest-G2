import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// SC-24 アイデアチャット（E 実接続）＝メッセージ投稿→スレッド反映＋通常リアクション。ACME-01（owner＝comment 権限）で、
// recruiting クエスト＋published アイデア（公開で chat_group 自動作成）を API で用意して確認する。
// 根拠＝doc/テスト/E_チャット.md §3（E-TC-201）・API設計 E.1/E.2/E.4・screens/SC-24。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
const IMPL_DIR = path.resolve(__dirname, "..", ".."); // e2e → frontend → impl
function psql(sql: string) {
  try {
    execSync(`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c ${JSON.stringify(sql)}`, { cwd: IMPL_DIR, stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message: string };
    throw new Error(`psql failed: ${err.stderr?.toString() || ""} ${err.stdout?.toString() || ""} ${err.message}`);
  }
}
function psqlValue(sql: string): string {
  return execSync(`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -tA -c ${JSON.stringify(sql)}`, { cwd: IMPL_DIR }).toString().trim();
}
async function loginAs(page: Page, c: { company: string; loginId: string; password: string }) {
  await page.goto("/login");
  await page.locator("#company_code").fill(c.company);
  await page.locator("#login_id").fill(c.loginId);
  await page.locator("#password").fill(c.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  // 別アカウント（user2 等）は loginAs で実ログインする（別バケット・低頻度）。
  await page.goto("/");
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
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    // quest_group_ids は複数・0件＝会社全体（FR-38）。旧 API の quest_group_id（単数）は現行スキーマで extra_forbidden。
    data: { title, color: "#0D9488", quest_group_ids: [], categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E 目的", status: "recruiting" },
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

// E-TC-213 SC-24 ピン留め後にホバー操作メニューが残らない（受入不具合 DFT-E-005 の回帰）。
// クリックで📌ボタンにフォーカスが残っても :focus-visible ではないため、ホバーが外れれば .msg__actions は隠れる
// （旧 .msg:focus-within .msg__actions ではクリック後にメニューが出っぱなしだった）。owner＝ピン権限あり。
test("E-TC-213 SC-24 action menu hides after pinning when hover leaves (DFT-E-005)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2Eピン_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const body = `ピン対象_${stamp}`;
  try {
    await postMsg(page, ideaId, body);
    await page.goto(`/ideas/${ideaId}/chat`);
    const msg = page.locator(".msg", { hasText: body });
    await expect(msg.locator(".msg__text")).toContainText(body);

    // ホバーで操作メニューが出る。
    await msg.hover();
    await expect(msg.locator(".msg__actions")).toBeVisible();

    // 📌 ピン留め（owner 権限）→ ピルが出る。
    await msg.getByRole("button", { name: /ピン留め/ }).click();
    await expect(msg.locator(".msg__pinned")).toBeVisible();

    // マウスをメッセージ外へ＝ホバー解除。フォーカスはボタンに残るが :focus-visible ではないので
    // メニューは隠れる（この assert が DFT-E-005 の回帰＝旧実装では表示のまま）。
    await page.mouse.move(2, 2);
    await expect(msg.locator(".msg__actions")).toBeHidden();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-218 SC-24 ホバー操作メニューのツールチップ＋使用中アクティブ表示（ユーザー要望）。
// 各ボタンに機能説明の title／自分が使っているアクション（リアクション済み・ピン留め中）は is-active＋aria-pressed=true。
test("E-TC-218 SC-24 action menu tooltips and active state", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2Eメニュー_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const body = `メニュー対象_${stamp}`;
  try {
    await postMsg(page, ideaId, body);
    await page.goto(`/ideas/${ideaId}/chat`);
    const msg = page.locator(".msg").filter({ has: page.locator(".msg__text", { hasText: body }) });
    await msg.hover();

    // ① 各ボタンに機能を説明する title（ツールチップ）。react は data-act で一意特定（.reaction-add と名前が部分一致するため）。
    await expect(msg.locator('.msg__actions [data-act="react"]')).toHaveAttribute("title", /リアクション/);
    await expect(msg.getByRole("button", { name: "引用返信" })).toHaveAttribute("title", /引用/);
    await expect(msg.getByRole("button", { name: /ピン留め/ })).toHaveAttribute("title", /ピン留め/);
    await expect(msg.getByRole("button", { name: "編集" })).toHaveAttribute("title", /編集/);
    await expect(msg.getByRole("button", { name: "削除" })).toHaveAttribute("title", /削除/);

    // ② リアクション後は🙂がアクティブ（使用中）。
    await msg.locator(".reaction-add").click();
    await page.locator(".reaction-picker .rp__emoji", { hasText: "👍" }).click();
    await expect(msg.locator(".reaction", { hasText: "👍" })).toBeVisible();
    await msg.hover();
    await expect(msg.locator('[data-act="react"]')).toHaveClass(/is-active/);
    await expect(msg.locator('[data-act="react"]')).toHaveAttribute("aria-pressed", "true");

    // ②' ピッカー内でも既にリアクション済みの絵文字（👍）がアクティブ表示。
    await msg.locator('.msg__actions [data-act="react"]').click();
    await expect(page.locator(".reaction-picker")).toBeVisible();
    await expect(page.locator(".reaction-picker .rp__emoji.is-active").filter({ hasText: "👍" })).toBeVisible();
    await page.mouse.click(5, 5); // 外側クリックでピッカーを閉じる
    await expect(page.locator(".reaction-picker")).toBeHidden();

    // ③ ピン留め後は📌がアクティブ＋title が「ピン留め中…」。ピッカーを外側クリックで閉じた後なので再ホバーで操作メニューを出す。
    await msg.hover();
    await msg.getByRole("button", { name: /ピン留め/ }).click();
    await expect(msg.locator(".msg__pinned")).toBeVisible();
    await msg.hover();
    const pinBtn = msg.getByRole("button", { name: "ピン留めを外す" });
    await expect(pinBtn).toHaveClass(/is-active/);
    await expect(pinBtn).toHaveAttribute("aria-pressed", "true");
    await expect(pinBtn).toHaveAttribute("title", /ピン留め中/);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-219 SC-24 自分の送信メッセージは再入室で未読にならない（受入不具合 DFT-E-009 の回帰）。
// 旧＝送信で既読ポインタが進まず、戻る→再入室で backend の first_unread が自分の投稿を指し「ここから未読」が自分の投稿の上に出た。
// 新＝送信時に既読前進＋表示側で自分の投稿の上に区切りを出さない。
test("E-TC-219 SC-24 own sent message is not marked unread on re-entry (DFT-E-009)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E未読_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}/chat`);
    await openComposer(page);
    await page.locator(".composer__box").fill(`自分メッセージ_${stamp}`);
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expect(page.locator(".msg", { hasText: `自分メッセージ_${stamp}` })).toBeVisible();

    // 戻る（アイデア詳細）→ 再入室。
    await page.goto(`/ideas/${ideaId}`);
    await page.goto(`/ideas/${ideaId}/chat`);
    await expect(page.locator(".msg", { hasText: `自分メッセージ_${stamp}` })).toBeVisible();

    // 自分の投稿は既読扱い＝「ここから未読」が出ない。
    await expect(page.locator(".unread-sep")).toHaveCount(0);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-220 SC-24 全件未読での初期スクロール位置（受入不具合 DFT-E-010 の回帰）。
// 旧＝未読区切りへ block:"start" でスクロールし、全件未読時に区切り＋先頭メッセージがフローティング文脈バーの背後に潜り込んだ。
// 新＝バー下端＋余白の直下へ着地（scrollTopForTarget）。他ユーザー著者の未読メッセージを DB 直挿入して再現する。
test("E-TC-220 SC-24 initial scroll keeps unread separator below floating bar when all unread (DFT-E-010)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E未読スクロール_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  // chat_group を遅延生成しつつ id を取得（GET は既読化しない）。
  const chat = await page.request.get(`/api/v1/ideas/${ideaId}/chat`).then((r) => r.json());
  const cgid = chat.chat_group_id as string;
  try {
    // owner 以外（user2）著者の未読メッセージを十分な数だけ DB 挿入＝全件未読・スクロール可能に。
    psql(
      `INSERT INTO chat_messages (id, chat_group_id, author_id, body, created_at) ` +
        `SELECT gen_random_uuid(), '${cgid}', (SELECT id FROM users WHERE login_id='user2@acme.example'), ` +
        `'スクロール未読_${stamp}_'||g, now() + (g || ' seconds')::interval FROM generate_series(1,12) g;`,
    );
    await page.goto(`/ideas/${ideaId}/chat`);
    // 区切りが出る（全件未読）。
    await expect(page.locator(".unread-sep")).toHaveCount(1);
    // 初期スクロール後、区切りの上端がフローティングバー下端より下＝バーに隠れない（旧＝上に潜り込み）。
    await expect
      .poll(async () => {
        const sep = await page.locator(".unread-sep").boundingBox();
        const bar = await page.locator(".chat-context--float").boundingBox();
        if (!sep || !bar) return -999;
        return sep.y - (bar.y + bar.height); // >=0 ならバー下端より下
      })
      .toBeGreaterThanOrEqual(-1);
  } finally {
    // chat_reads.last_read_message_id が挿入メッセージを参照するため先に read カーソルを消す（FK 制約）。
    psql(`DELETE FROM chat_reads WHERE last_read_message_id IN (SELECT id FROM chat_messages WHERE chat_group_id='${cgid}');`);
    psql(`DELETE FROM chat_messages WHERE chat_group_id='${cgid}';`);
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-221 SC-24 入室時は「画面に見えたメッセージだけ既読」（受入不具合 DFT-E-011・ユーザー選択）。
// 旧＝入室で最新まで一律既読にしていた。新＝可視領域に入ったメッセージまでのみ既読＝見えていない下方の未読は残る。
test("E-TC-221 SC-24 entering a chat marks only visible messages read (DFT-E-011)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E可視既読_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const chat = await page.request.get(`/api/v1/ideas/${ideaId}/chat`).then((r) => r.json());
  const cgid = chat.chat_group_id as string;
  try {
    // 他ユーザー著者の未読メッセージをビューポート超過数だけ挿入（全件未読・スクロールしないと下方は見えない）。
    psql(
      `INSERT INTO chat_messages (id, chat_group_id, author_id, body, created_at) ` +
        `SELECT gen_random_uuid(), '${cgid}', (SELECT id FROM users WHERE login_id='user2@acme.example'), ` +
        `'可視既読_${stamp}_'||g, now() + (g || ' seconds')::interval FROM generate_series(1,15) g;`,
    );
    await page.goto(`/ideas/${ideaId}/chat`);
    await expect(page.locator(".unread-sep")).toHaveCount(1); // 全件未読＝区切りが出る
    // スクロールせず離脱→再入室。上部の見えた分だけ既読になり、下方の未読は残る。
    await page.goto(`/ideas/${ideaId}`);
    await page.goto(`/ideas/${ideaId}/chat`);
    // まだ未読が残る＝区切りが再び出る（旧＝入室で一律全既読なら区切りは消えていた）。
    await expect(page.locator(".unread-sep")).toHaveCount(1);
  } finally {
    psql(`DELETE FROM chat_reads WHERE last_read_message_id IN (SELECT id FROM chat_messages WHERE chat_group_id='${cgid}');`);
    psql(`DELETE FROM chat_messages WHERE chat_group_id='${cgid}';`);
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-222 SC-24 リアルタイム反映された他ユーザーの新着は、画面で見たら再入室で既読（受入不具合 DFT-E-011 の報告シナリオ）。
// A（owner）が投稿→B（user2・パーティー員）に realtime 反映→B は画面で見る→離脱→再入室で未読にならない。
test("E-TC-222 SC-24 realtime message seen by another user is read on re-entry (DFT-E-011)", async ({ page, browser }) => {
  await login(page); // A = owner
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2Ert_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  // B（user2）を comment 権限でパーティーに追加（会社全体でも非作成者は有効パーティー員が必須）。
  const u2 = psqlValue("SELECT id FROM users WHERE login_id='user2@acme.example'");
  const csrf = csrfOf(await page.context().cookies());
  const add = await page.request.post(`/api/v1/quests/${questId}/members`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { user_id: u2, permissions: ["comment"] },
  });
  expect(add.status(), await add.text()).toBe(201);
  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    await loginAs(pageB, { company: "ACME-01", loginId: "user2@acme.example", password: "Passw0rd!" });
    await pageB.goto(`/ideas/${ideaId}/chat`);
    await expect(pageB.locator(".chat-context--float")).toBeVisible();
    await pageB.waitForTimeout(1200); // realtime 購読の確立を待つ

    const body = `rt_${stamp}`;
    await postMsg(page, ideaId, body); // A が投稿→realtime で B へ
    await expect(pageB.locator(".msg", { hasText: body })).toBeVisible({ timeout: 15000 }); // B に反映（＝見えた）
    await pageB.waitForTimeout(600); // markReadUpToVisible の反映

    await pageB.goto(`/ideas/${ideaId}`);
    await pageB.goto(`/ideas/${ideaId}/chat`);
    await expect(pageB.locator(".msg", { hasText: body })).toBeVisible();
    await expect(pageB.locator(".unread-sep")).toHaveCount(0); // 見たので既読＝未読区切りは出ない
  } finally {
    await ctxB.close();
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

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

// E-TC-215 SC-24 引用クリックでジャンプ先が隠れずハイライトされる（受入不具合 DFT-E-006 の回帰）。
// 旧＝native アンカー(#id)でフローティング文脈バーの背後に潜り込み、どこへ飛んだか分からなかった。
// 新＝jumpToQuote がバー下端＋余白の直下へスクロール＋引用元に .msg--flash を一時付与。
test("E-TC-215 SC-24 quote click reveals target below floating bar and flashes it (DFT-E-006)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E引用ジャンプ_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const parent = `親_${stamp}`;
  try {
    // 親＋十分な数のフィラーを API で用意（スレッドをスクロール可能にして「隠れ」を再現できる状態に）。
    await postMsg(page, ideaId, parent);
    for (let i = 0; i < 12; i++) await postMsg(page, ideaId, `フィラー${i}_${stamp}`);
    await page.goto(`/ideas/${ideaId}/chat`);

    // 親を引用して返信（返信は最下部）。返信の引用抜粋にも親テキストが載るため、本文 .msg__text で親を一意特定する。
    await openComposer(page);
    const parentMsg = page.locator(".msg").filter({ has: page.locator(".msg__text", { hasText: parent }) });
    await parentMsg.hover();
    await parentMsg.getByRole("button", { name: "引用返信" }).click();
    await expect(page.locator(".reply-ctx__head")).toHaveText("引用返信（1件）");
    await page.locator(".composer__box").fill(`返信_${stamp}`);
    await page.getByRole("button", { name: "送信", exact: true }).click();
    const reply = page.locator(".msg", { hasText: `返信_${stamp}` });
    await expect(reply.locator(".msg__quote")).toHaveCount(1);

    // 引用チップをクリック→引用元へジャンプ。
    await reply.locator(".msg__quote").click();

    // ① 引用元に一時ハイライト（.msg--flash）が付く＝どこへ飛んだか分かる。
    await expect(parentMsg).toHaveClass(/msg--flash/);
    // ② 引用元の上端がフローティングバー下端より下＝バーに隠れない（旧実装では上端がバー下端より上＝潜り込み）。
    await expect
      .poll(async () => {
        const box = await parentMsg.boundingBox();
        const bar = await page.locator(".chat-context--float").boundingBox();
        if (!box || !bar) return -1;
        return box.y - (bar.y + bar.height); // >=0 ならバー下端より下
      })
      .toBeGreaterThanOrEqual(-1);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-216 SC-24 sticky コンポーザーが重なるメッセージにクリックを奪われない（受入不具合 DFT-E-007 の回帰）。
// 旧＝.composer に z-index 未指定（auto）＝重なったメッセージの z-index を持つ子（.msg__author/.msg__caster=2・
// 魔法行 .msg-row=3）が前面に出て、メッセージと入力欄が重なる位置でクリックを奪っていた（左だけ効く症状）。
// 新＝上部バー(.chat-context--float=9)と対称に z-index を付与＝メッセージ内容(≤3)より前・ポップアップ(≥40)より後ろ。
test("E-TC-216 SC-24 sticky composer stacks above message content (DFT-E-007)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E入力欄重なり_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}/chat`);
    await expect(page.locator(".composer")).toBeVisible();
    const z = await page
      .locator(".composer")
      .evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));
    expect(Number.isFinite(z)).toBe(true); // 旧＝auto（NaN）で red
    expect(z).toBeGreaterThan(3); // メッセージ内容の最大 z-index（魔法行=3）より前面
    expect(z).toBeLessThan(40); // reaction-picker(40)/emoji(45)/mention(46)/lightbox(60) より背面（ポップアップは奪ってよい）
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// E-TC-217 SC-24 最小化中に引用返信すると入力欄が展開する（受入不具合 DFT-E-008 の回帰）。
// 旧＝最小化中は composer__full（reply-ctx/textarea）が非表示で、💬を押しても引用チップが見えず「何も起きない」ように見えた。
// 新＝引用追加時に setComposerMin(false) で展開してから textarea へフォーカス。openComposer は呼ばない（最小化のまま操作する）。
test("E-TC-217 SC-24 quote-reply expands the minimized composer (DFT-E-008)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E最小化引用_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const body = `引用元_${stamp}`;
  try {
    await postMsg(page, ideaId, body);
    await page.goto(`/ideas/${ideaId}/chat`);
    // 入力欄は既定で最小化＝textarea は非表示・スリムバーが見えている。
    await expect(page.locator(".composer__mini")).toBeVisible();
    await expect(page.locator(".composer__box")).toBeHidden();

    // メッセージの💬引用返信を押す（openComposer せず）。
    const msg = page.locator(".msg").filter({ has: page.locator(".msg__text", { hasText: body }) });
    await msg.hover();
    await msg.getByRole("button", { name: "引用返信" }).click();

    // 入力欄が展開し、引用チップが見える（旧実装では最小化のままで hidden）。
    await expect(page.locator(".composer__box")).toBeVisible();
    await expect(page.locator(".reply-ctx__head")).toHaveText("引用返信（1件）");
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

  // G-TC-178 ピン留めアニメ（§17P 移植）の抑制＝reduce では stamp 押印アニメを付けない（ピル＝情報は残る）。
  test("G-TC-178 SC-24 pin stamp animation is disabled under reduced motion (pill still shows)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    const stamp = Date.now().toString().slice(-8);
    const questId = await createRecruiting(page, `E2Eピン抑制_${stamp}`);
    const ideaId = await createPublishedIdea(page, questId, stamp);
    const body = `ピン抑制_${stamp}`;
    try {
      await postMsg(page, ideaId, body);
      await page.goto(`/ideas/${ideaId}/chat`);
      const msg = page.locator(".msg", { hasText: body });
      await expect(msg.locator(".msg__text")).toContainText(body);
      // 📌 ピン留め（owner）→ ピルは出る（情報は残る）が、reduce では stamp アニメ class は付かない＝animation none。
      await msg.hover();
      await msg.getByRole("button", { name: /ピン留め/ }).click();
      const pill = msg.locator(".msg__pinned");
      await expect(pill).toBeVisible();
      const pillAnim = await pill.evaluate((el) => getComputedStyle(el).animationName);
      expect(pillAnim).toBe("none");
    } finally {
      const c2 = csrfOf(await page.context().cookies());
      await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
    }
  });
});
