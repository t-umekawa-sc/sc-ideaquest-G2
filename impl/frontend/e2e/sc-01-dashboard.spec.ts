import { expect, test, type Page } from "@playwright/test";

// SC-01 ダッシュボード＝ヒーロー残高の backend 接続 e2e（GET /me 残高スライス・K.1）。
// 根拠＝doc/画面設計/screens/SC-01_ダッシュボード.md・doc/API設計/K_プロフィール・背景画像.md K.1／
// フロントエンド実装フロー規約 §1.1（画面単位接続）。担保範囲＝ヒーロー(Lv/XPバー NEXT/コイン/SP)と
// 共通ヘッダー通貨(Lv/コイン)が GET /me の balance と一致すること（値はハードコードせず /me 実値と突合＝接続の証明）。
// レベル進捗（xp_to_next/level_span）はサーバの §7 純粋関数で算出。週間ランキング等（G/C/D）は範囲外＝demo。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  // ログイン成立の判定＝/login を抜けて共通ヘッダーが出る（挨拶文は時間帯で変わり「ようこそ」は存在しないため使わない）。
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

// ヒーロー残高＝GET /me の balance と一致（接続の証明）。ヘッダー通貨も同値。
test("hero and header balance reflect GET /me", async ({ page }) => {
  await login(page); // ダッシュボード（/）表示
  // 認証済みページと同一 Cookie で /me を取得し、UI 表示と突合する。
  const me = await page.request.get("/api/v1/me").then((r) => r.json());
  const b = me.balance;

  // ヒーロー（ゲーム層・SC-01 §4.2）
  await expect(page.locator(".hero__lv")).toHaveText(`Lv.${b.level}`);
  await expect(page.locator(".hero__next")).toHaveText(`NEXT ${b.xp_to_next} XP`);
  await expect(page.locator(".hero__coin .coin")).toContainText(`◆ ${b.coin_balance}`);
  await expect(page.locator(".hero__coin .skill")).toContainText(`✦ SP ${b.skill_point_balance}`);
  // XPバーのツールチップ（ホバー表示）データ＝/me と一致（レベル内獲得 XP＝level_span − xp_to_next・累計＝xp）。
  const xpInLevel = b.level_span - b.xp_to_next;
  await expect(page.locator(".xp-bar-wrap")).toHaveAttribute(
    "data-tip", `獲得 XP ${xpInLevel} / ${b.level_span}（累計 ${b.xp}）`
  );

  // 共通ヘッダー通貨（バー・§4.1）＝同じ /me balance
  await expect(page.locator(".app-header .pixel-stat.level").first()).toHaveText(`Lv.${b.level}`);
  await expect(page.locator(".app-header .pixel-stat.coin").first()).toContainText(`◆ ${b.coin_balance}`);
});

// #21 レベルオーラの脈動 reduce（GF-AC-212）＝reduce でヒーローアバターのオーラ脈動（aura-pulse）が止まる。
// 二方向ガード＝非 reduce では aura-pulse が生きている（装飾が有効）／reduce では animationName none（脈動停止・オーラ box-shadow と称号は表示）。
// data-tier は levelRank(level).tier で全レベル付与ゆえ ::after は常設。ゲーム層ダッシュボード（.dash-page ヒーロー）を見る ACME ユーザーで観測。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §5-T（G-TC-175）・GF-AC-212。
const GAME_USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
test.describe("reduce-motion #21", () => {
  test("G-TC-175 hero level aura pulse stops under reduced motion (#21)", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#company_code").fill(GAME_USER.company);
    await page.locator("#login_id").fill(GAME_USER.loginId);
    await page.locator("#password").fill(GAME_USER.password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
    // ゲーム層ダッシュボードのヒーローアバター（オーラ ::after 常設）。
    const avatar = page.locator(".dash-page .hero__avatar[data-tier]");
    await expect(avatar).toBeVisible();
    const auraAnim = () => avatar.evaluate((el) => getComputedStyle(el, "::after").animationName);
    // 非 reduce（no-preference）＝オーラは aura-pulse で脈打つ（装飾が生きている＝アサートが有意味）。
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(auraAnim).toBe("aura-pulse");
    // reduce＝脈動停止（animationName none）。オーラ box-shadow と称号チップは表示のまま。
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(auraAnim).toBe("none");
    await expect(page.locator(".hero__title[data-tier]")).toBeVisible();
  });
});

// I-TC-157 SC-01 ダッシュボードで「自分のクエスト」を参加中と分離＋下書きカードは編集ダイアログ導線（ユーザー要望・2026-09-16）。
// is_owner（backend C-TC-247）でクエストを二分し、下書き（アイデア）は ?edit=1、クエスト下書きは /edit へ。
const ACME = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
test("I-TC-157 dashboard splits own quests and draft cards link to edit dialog", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#company_code").fill(ACME.company);
  await page.locator("#login_id").fill(ACME.loginId);
  await page.locator("#password").fill(ACME.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /すべての通知/ })).toBeVisible();
  // 自分の作成クエストがあるので「自分のクエスト」セクションが出る（参加中とは別枠）。
  await expect(page.locator('section[aria-label="自分のクエスト"]')).toBeVisible({ timeout: 8000 });
  // API が is_owner を返し、参加中(=is_owner:false)と自作(=true)が混在する。
  const dash = await page.request.get("/api/v1/dashboard").then((r) => r.json());
  const qs: Array<{ is_owner?: boolean }> = dash.quests ?? [];
  expect(qs.every((q) => typeof q.is_owner === "boolean")).toBe(true);
  expect(qs.some((q) => q.is_owner)).toBe(true);
  // 下書きカード（アイデア）は編集ダイアログ導線＝?edit=1（存在すれば）。
  const draftHrefs = await page
    .locator('section[aria-label="下書き"] a.draft-card')
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") || ""));
  for (const h of draftHrefs) {
    // idea 下書き→ ?edit=1／quest 下書き→ /edit／評価下書き→ /eval のいずれか（詳細ページ直リンクは廃止）。
    expect(h.includes("?edit=1") || h.includes("/edit") || h.includes("/eval")).toBe(true);
  }
});
