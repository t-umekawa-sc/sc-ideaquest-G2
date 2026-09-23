import { expect, test, type Page } from "@playwright/test";

// レビュー#1 グローバルナビ（☰→左ドロワー／📌ピン留めでサイドバー・デザイン標準 §4.1・画面遷移図 §4 集約）。
// 分散導線（ホームタイル・GameNav）を集約したドロワーの開閉・遷移・ピン留め永続・reduce を e2e で担保。
// 根拠＝doc/テスト/M_共通シェル・ナビ.md §2-A（M-TC-001〜004）。
async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

test("M-TC-001 global nav drawer opens with items and closes on Esc/backdrop (#1)", async ({ page }) => {
  // ナビ既定はピン留め（docked）に変更＝burger 非表示。オーバーレイ挙動は明示的に非ピン（iq_nav_pinned=0）で検証する。
  await page.addInitScript(() => { try { localStorage.setItem("iq_nav_pinned", "0"); } catch { /* ignore */ } });
  await login(page);
  const burger = page.locator(".appnav-burger");
  await expect(burger).toBeVisible();
  // 開く＝.appnav-root.is-open が立ち、業務群＋ゲーム群の項目が出る。
  await burger.click();
  await expect(page.locator(".appnav-root.is-open")).toHaveCount(1);
  const drawer = page.locator("#appnav-drawer");
  await expect(drawer.getByRole("menuitem", { name: "ホーム" })).toBeVisible();
  await expect(drawer.locator('a.appnav__item[href="/quests"]')).toBeVisible(); // 「クエスト」は「クエストを探す」等と名前が部分一致するため href で一意に狙う
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
  await page.addInitScript(() => { try { localStorage.setItem("iq_nav_pinned", "0"); } catch { /* ignore */ } });
  await login(page);
  await page.locator(".appnav-burger").click();
  await page.locator("#appnav-drawer").getByRole("menuitem", { name: "ショップ" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.locator(".appnav-root.is-open")).toHaveCount(0);
});

test("M-TC-003 pin makes a persistent sidebar remembered across reload, and can be unpinned (#1)", async ({ page }) => {
  await login(page); // 既定＝ピン留め（docked・localStorage 未設定でも既定 ON）。viewport 1280px（≥1024）＝ピン可。
  // 既定でドック（本文右シフト＝html.iq-nav-pinned）＝☰は隠れる。
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("iq-nav-pinned"))).toBe(true);
  await expect(page.locator(".appnav-burger")).toBeHidden();
  // ピン時にウィンドウ全体へ横スクロールを出さない（本文はビューポート内・ヘッダー右の余白崩れ防止）。
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowX).toBeLessThanOrEqual(1); // サブピクセル誤差のみ許容
  // 📌 で解除→非ドック・☰復活・localStorage="0"。
  await page.locator(".appnav-pin").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("iq-nav-pinned"))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("iq_nav_pinned"))).toBe("0");
  await expect(page.locator(".appnav-burger")).toBeVisible();
  // リロード後も「解除」を維持（localStorage 記憶）。
  await page.reload();
  await expect(page.locator(".app-header")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("iq-nav-pinned"))).toBe(false);
  // もう一度 📌 でピン（☰→overlay→pin）→ docked・localStorage="1"。
  await page.locator(".appnav-burger").click();
  await page.locator(".appnav-pin").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("iq-nav-pinned"))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("iq_nav_pinned"))).toBe("1");
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
