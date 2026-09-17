import { expect, test, type Page } from "@playwright/test";

// SC-13 発見カタログ（FR-40・C.9）の掲示板ダイアログ標準機能の回帰（受入不具合 DFT-E-013/014）。
// C-TC-266＝最大化(⤢)が出る（前セッションで `maximizable={false}` を誤って上書き＝標準機能欠落・§106）。
// C-TC-267＝閉じアニメが出る（`{detail && <Dialog>}` の即アンマウントで exit アニメが飛んでいた）。
// 前提＝dev seed の発見デモ discoverable クエスト（bootstrap `seed_demo_discovery`・全社公開・非メンバー）。
// 根拠＝doc/テスト/C_クエスト.md §7 C-TC-266/267／SC-13／デザイン標準 §106（最大化）・Modal 閉じアニメ契約。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
const DEMO_TITLE = "【発見デモ】部署横断アイデア募集";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

async function openCatalogDialog(page: Page) {
  await page.goto("/quest-catalog");
  await page.getByText(DEMO_TITLE).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("C-TC-266 catalog dialog is maximizable (DFT-E-013)", async ({ page }) => {
  await login(page);
  await openCatalogDialog(page);
  // 標準の最大化(⤢)ボタンが出る＝`maximizable` 既定 on（§106）。誤って false 上書きすると出ない。
  const maxBtn = page.getByRole("button", { name: "最大化" });
  await expect(maxBtn).toBeVisible();
  await maxBtn.click();
  // 最大化状態＝パネルに is-max・トグルは「元のサイズに戻す」へ。
  await expect(page.locator(".modal__panel.is-max")).toBeVisible();
  await expect(page.getByRole("button", { name: "元のサイズに戻す" })).toBeVisible();
});

test("C-TC-267 catalog dialog plays close animation (DFT-E-014)", async ({ page }) => {
  await login(page);
  await openCatalogDialog(page);
  // 開いている間は .modal.show（enter 済み）。
  await expect(page.locator(".modal.show")).toBeVisible();
  // 閉じ要求＝exit アニメ開始。修正後は Modal が open=false でも ANIM_MS の間マウントを保持し
  // .show を外してフェードアウトする（＝`.modal:not(.show)` が一瞬 attach する）。
  // 旧不具合（即アンマウント）では .modal が即座に DOM から消え、この中間状態が観測できない。
  await page.locator(".modal__close").click();  // ヘッダーの × で閉じる
  await expect(page.locator(".modal:not(.show)")).toBeAttached({ timeout: 250 });
  // 最終的にはアンマウントされて閉じる。
  await expect(page.locator(".modal")).toHaveCount(0, { timeout: 2000 });
});

test("C-TC-268 reduce-motion suppresses modal CRT animation, keeps behavior", async ({ page }) => {
  // 抑制 ON（OS reduce）＝CRT 電源ON/OFF 演出は出ない（`--crt-in` クラス自体を付けない）が、
  // 情報（ダイアログ本文）は残り・閉じる挙動も保つ（即時クローズ）。テスト規約 §6・デザイン標準 §4.9。
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await openCatalogDialog(page);
  await expect(page.locator(".modal__panel")).toBeVisible();          // 情報は残る
  await expect(page.locator(".modal__panel--crt-in")).toHaveCount(0); // CRT 演出は付かない（open/close とも抑制）
  await page.locator(".modal__close").click();
  await expect(page.locator(".modal")).toHaveCount(0, { timeout: 300 }); // reduce＝即閉じ（挙動は保つ）
});
