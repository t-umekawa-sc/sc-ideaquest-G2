import { expect, test, type Page } from "@playwright/test";

// SC-03 画像アップロード（K.4・MinIO 署名URL）の backend 接続 e2e。
// 根拠＝doc/API設計/K_プロフィール・背景画像.md K.4・§1.10／実装計画 フェーズ1。
// 担保＝(1) プロフィール画像（アイコン）を選ぶと署名URL(/avatars/)の img が表示され、削除で頭文字に戻る、
// (2) ヘッダーメニューから背景画像を設定すると全画面背景(.app-bg.is-set)に反映、リセットで戻る。
const U = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
// 最小 PNG（1x1）。サーバーは MIME/サイズを検証する。
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000001f15c4890000000a4944" +
  "54789c6360000002000154a24f0e0000000049454e44ae426082",
  "hex",
);

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(U.company);
  await page.locator("#login_id").fill(U.loginId);
  await page.locator("#password").fill(U.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

test("SC-03 avatar icon upload and delete", async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "プロフィール編集" })).toBeVisible();

  await page.setInputFiles('.icon-field input[type=file]', { name: "a.png", mimeType: "image/png", buffer: PNG });
  const img = page.locator(".icon-field .quest-icon__img");
  await expect(img).toBeVisible({ timeout: 8000 });
  await expect(img).toHaveAttribute("src", /\/avatars\//);       // 署名URL（MinIO）
  // GET /me もアイコン署名URL を返す（接続の証明）。
  const me = await page.request.get("/api/v1/me").then((r) => r.json());
  expect(me.profile.avatar_image_url).toContain("/avatars/");

  // 削除＝既定（頭文字）へ戻る。
  await page.getByRole("button", { name: "削除（既定に戻す）" }).click();
  await expect(page.locator(".icon-field .quest-icon__char")).toBeVisible({ timeout: 8000 });
});

test("SC-03 background image set and reset from header menu", async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  // ユーザーメニューを開く→「背景画像を変更」の隠し input へファイル設定。
  await page.getByRole("button", { name: /のメニュー/ }).click();
  await page.setInputFiles('.usermenu__list input[type=file]', { name: "b.png", mimeType: "image/png", buffer: PNG });
  // 全認証画面の背景に反映（.app-bg.is-set＝router.refresh 後に付与）。
  await expect(page.locator(".app-bg.is-set")).toHaveCount(1, { timeout: 8000 });
  const me = await page.request.get("/api/v1/me").then((r) => r.json());
  expect(me.profile.background_image_url).toContain("/backgrounds/");

  // リセット（メニューが開いていなければ開いてから）。
  const reset = page.getByRole("menuitem", { name: "背景画像をリセット" });
  if (!(await reset.isVisible())) await page.getByRole("button", { name: /のメニュー/ }).click();
  await reset.click();
  await expect(page.locator(".app-bg.is-set")).toHaveCount(0, { timeout: 8000 });
});
