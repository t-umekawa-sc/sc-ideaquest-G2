import { expect, test, type Page } from "@playwright/test";

// レビュー#2 ゲームモード ON/OFF の gating＝実効ゲームモード（GET /me の game_mode.effective＝override ?? company_default）
// OFF でゲーム層UIを丸ごと非表示にする。根拠＝doc/テスト/M_共通シェル・ナビ.md §2-B（M-TC-005〜009）・デザイン標準 §4.11。
// 実効値は個人上書き（PATCH /me game_mode_override=false）で作り、テスト終了時に null（会社設定に従う）へ復元する
// （seed ユーザーは他 spec と共用のため必ず戻す）。サーバー層（(app)/layout・各 page）は me を都度読むので goto で反映される。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}
function csrfOf(c: { name: string; value: string }[]) { return c.find((x) => x.name === "iq_csrf")?.value ?? ""; }

async function setGameOverride(page: Page, value: boolean | null) {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.patch("/api/v1/me", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { game_mode_override: value },
  });
  expect(res.status(), await res.text()).toBe(200);
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
    data: { title: `GMアイデア_${stamp}`, value: `価値_${stamp}`, body: `本文_${stamp}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

test("M-TC-005/006/007/008 game mode OFF hides nav game group / header balance / hero / game notifications (#2)", async ({ page }) => {
  await login(page);
  try {
    await setGameOverride(page, false); // 個人 OFF（会社既定 true でも個人が優先＝実効 OFF）

    // M-TC-007 ダッシュボード＝ヒーロー/週間ランキング（ゲーム層）が消える（業務パネルは残る）。
    await page.goto("/");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".pixel-panel.hero")).toHaveCount(0);
    await expect(page.locator(".rank-panel")).toHaveCount(0);

    // M-TC-006 ヘッダー＝Lv/コイン/SP チップ・レベル円環が消え、アバター（ユーザーメニュー）は残る。
    await expect(page.locator(".header-actions .pixel-stat.level")).toHaveCount(0);
    await expect(page.locator(".header-actions .pixel-stat.coin")).toHaveCount(0);
    await expect(page.locator(".lvring")).toHaveCount(0);
    await expect(page.locator(".usermenu__trigger")).toBeVisible(); // 本人識別（アバター）は残す

    // M-TC-005 グローバルナビ＝業務群は出るがゲーム群（ショップ/きせかえ/魔法/実績/ランキング）が出ない。
    await page.locator(".appnav-burger").click();
    await expect(page.locator(".appnav-root.is-open")).toBeVisible();
    const drawer = page.locator("#appnav-drawer");
    await expect(drawer.getByRole("menuitem", { name: /ホーム/ })).toBeVisible();
    await expect(drawer.getByRole("menuitem", { name: /クエスト/ })).toBeVisible();
    await expect(drawer.getByRole("menuitem", { name: /ショップ/ })).toHaveCount(0);
    await expect(drawer.getByRole("menuitem", { name: /きせかえ/ })).toHaveCount(0);
    await expect(drawer.getByRole("menuitem", { name: /ランキング/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // M-TC-008 通知＝種別セレクトからゲーム系（実績/魔法）が消える（業務系は残る）。
    await page.goto("/notifications");
    await expect(page.locator(".filters option", { hasText: "実績" })).toHaveCount(0);
    await expect(page.locator(".filters option", { hasText: "魔法" })).toHaveCount(0);
    await expect(page.locator(".filters option", { hasText: "メンション" })).toHaveCount(1); // 業務系は残る
  } finally {
    await setGameOverride(page, null); // 会社設定に従う（他 spec へ影響させない）
  }
});

test("M-TC-009 game mode OFF hides chat magic cast UI (normal reactions and body remain) (#2)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `GM_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  const body = `投稿_${stamp}`;
  try {
    // 先にメッセージを投稿（game ON のうちに用意＝作成導線はゲーム層ではない）。
    const csrf = csrfOf(await page.context().cookies());
    const post = await page.request.post("/api/v1/chat-messages", {
      headers: { "X-CSRF-Token": csrf }, multipart: { idea_id: ideaId, body },
    });
    expect(post.status(), await post.text()).toBeLessThan(300);

    await setGameOverride(page, false); // 実効 OFF
    await page.goto(`/ideas/${ideaId}/chat`);
    const msg = page.locator(".msg", { hasText: body });
    await expect(msg.locator(".msg__text")).toContainText(body); // チャット本文は残る
    await msg.locator(".reaction-add").click();
    await expect(page.locator(".reaction-picker")).toBeVisible();
    // 魔法セクション（ラベル＋ボタン）ごと出ない＝新規キャスト不可。通常絵文字は残る。
    // ※ラベルで判定＝未解放ゼロの場合でも gating OFF なら「魔法」ラベルは出る（gating の有無を確実に切り分ける）。
    await expect(page.locator(".reaction-picker .rp__label", { hasText: "魔法" })).toHaveCount(0);
    await expect(page.locator(".reaction-picker .rp__spell")).toHaveCount(0);
    await expect(page.locator(".reaction-picker .rp__emoji").first()).toBeVisible();
  } finally {
    await setGameOverride(page, null); // 会社設定に従う へ復元
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});


test("M-TC-010 quest screen game mode OFF hides KPI/ranking, keeps business panels (#2)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `GM_Q_${stamp}`);
  try {
    await setGameOverride(page, false); // 実効 OFF
    await page.goto(`/quests/${questId}`);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.getByRole("heading", { name: `GM_Q_${stamp}` })).toBeVisible();
    // ゲーム層パネル（KPI／クエスト内ランキング／その行）は非表示。
    await expect(page.locator(".quest-panels")).toHaveCount(0);
    await expect(page.locator(".quest-kpi")).toHaveCount(0);
    await expect(page.locator(".rank-panel")).toHaveCount(0);
    // 業務要素は残る＝クエスト情報ヘッダー・タブ・アイデアタブのツールバー（追加ボタン）。
    await expect(page.locator(".quest-head")).toBeVisible();
    await expect(page.locator("#quest-tabs")).toBeVisible();
    await expect(page.getByRole("button", { name: "＋ アイデアを追加" })).toBeVisible();
  } finally {
    await setGameOverride(page, null);
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("M-TC-011 level-up celebration is suppressed when game mode is OFF (positive control on) (#2)", async ({ page }) => {
  await login(page);
  // 既定（ゲームON）でダッシュボードを開き、LevelUpWatcher に既観測レベルを書かせる（初回は祝福しない）。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
  const key = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("iq:lastSeenLevel:"));
    if (k) localStorage.setItem(k, "1"); // 既観測を下げる＝次回マウントで「上がった」＝祝福条件成立
    return k ?? null;
  });
  expect(key, "ダッシュボード表示後に lastSeenLevel キーが存在するはず").toBeTruthy();
  try {
    // 陽性対照を先に＝ゲームON＋既観測 1 で祝福が「出る」ことを確認（トリガ成立＝以後の OFF 不在確認が有意になる）。
    await page.evaluate((k) => localStorage.setItem(k as string, "1"), key);
    await page.goto("/");
    await expect(page.locator(".levelup-overlay")).toBeVisible();  // timeout 内で出現を待つ
    // ゲームOFF＝LevelUpWatcher 自体が未マウント＝祝福オーバーレイは出ない。出るなら出ている猶予（1.5s）後に不在確認。
    await setGameOverride(page, false);
    await page.evaluate((k) => localStorage.setItem(k as string, "1"), key);
    await page.goto("/");
    await expect(page.locator(".app-header")).toBeVisible();
    // 出るなら ~mount 直後に描画され 2.6s 表示される。1s 待った「時点」で不在を点検（非リトライの count()＝
    // toHaveCount(0) だと自動消滅で 0 になり pass してしまうため使わない）。
    await page.waitForTimeout(1000);
    expect(await page.locator(".levelup-overlay").count(), "ゲームOFF では祝福オーバーレイが出ない").toBe(0);
  } finally {
    await setGameOverride(page, null);
    await page.evaluate((k) => { try { localStorage.removeItem(k as string); } catch { /* noop */ } }, key);
  }
});
