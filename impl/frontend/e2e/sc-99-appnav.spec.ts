import { expect, test, type Page } from "@playwright/test";

// レビュー#1 グローバルナビ（☰→左ドロワー／📌ピン留めでサイドバー・デザイン標準 §4.1・画面遷移図 §4 集約）。
// 分散導線（ホームタイル・GameNav）を集約したドロワーの開閉・遷移・ピン留め永続・reduce を e2e で担保。
// 根拠＝doc/テスト/M_共通シェル・ナビ.md §2-A（M-TC-001〜004）。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  // ログイン成立＝/login を抜けて共通ヘッダーが出る（挨拶文は時間帯依存のため使わない）。
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

test("M-TC-001 global nav drawer opens with items and closes on Esc/backdrop (#1)", async ({ page }) => {
  await login(page);
  const burger = page.locator(".appnav-burger");
  await expect(burger).toBeVisible();
  // 開く＝.appnav-root.is-open が立ち、業務群＋ゲーム群の項目が出る。
  await burger.click();
  await expect(page.locator(".appnav-root.is-open")).toHaveCount(1);
  const drawer = page.locator("#appnav-drawer");
  await expect(drawer.getByRole("menuitem", { name: "ホーム" })).toBeVisible();
  await expect(drawer.getByRole("menuitem", { name: "クエスト" })).toBeVisible();
  await expect(drawer.getByRole("menuitem", { name: "通知" })).toBeVisible();
  await expect(drawer.getByRole("menuitem", { name: "ショップ" })).toBeVisible();
  await expect(drawer.getByRole("menuitem", { name: "魔法・スキル" })).toBeVisible();
  // Esc で閉じる。
  await page.keyboard.press("Escape");
  await expect(page.locator(".appnav-root.is-open")).toHaveCount(0);
  // 再度開いて背面クリックで閉じる。
  await burger.click();
  await expect(page.locator(".appnav-root.is-open")).toHaveCount(1);
  // 背面はビューポート全面だが左端はドロワーが重なる→ドロワー外（右側）をクリックする。
  await page.locator(".appnav-backdrop").click({ position: { x: 900, y: 300 } });
  await expect(page.locator(".appnav-root.is-open")).toHaveCount(0);
});

test("M-TC-002 selecting a nav item navigates and closes the drawer (#1)", async ({ page }) => {
  await login(page);
  await page.locator(".appnav-burger").click();
  await page.locator("#appnav-drawer").getByRole("menuitem", { name: "ショップ" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.locator(".appnav-root.is-open")).toHaveCount(0);
});

test("M-TC-003 pin makes a persistent sidebar remembered across reload, and can be unpinned (#1)", async ({ page }) => {
  await login(page); // 既定 viewport 1280px（≥1024）＝ピン可
  await page.locator(".appnav-burger").click();
  // 📌ピン→ドック（本文右シフト＝html.iq-nav-pinned）。
  await page.locator(".appnav-pin").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("iq-nav-pinned"))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("iq_nav_pinned"))).toBe("1");
  // ピン時にウィンドウ全体へ横スクロールを出さない（本文はビューポート内に収まる＝ヘッダー右の余白崩れ防止）。
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowX).toBeLessThanOrEqual(1); // サブピクセル誤差のみ許容
  // リロード後も維持（localStorage 記憶）。
  await page.reload();
  await expect(page.locator(".app-header")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("iq-nav-pinned"))).toBe(true);
  // もう一度 📌 で解除。
  await page.locator(".appnav-pin").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("iq-nav-pinned"))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("iq_nav_pinned"))).toBe("0");
});

test.describe("reduce-motion #1", () => {
  test("M-TC-004 drawer/backdrop slide is disabled under reduced motion (#1)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    // ドロワーはマウント時からポータルに存在（閉じていても DOM にある）。
    const durOf = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(await durOf(".appnav")).toBe("0s");
    expect(await durOf(".appnav-backdrop")).toBe("0s");
  });
});
