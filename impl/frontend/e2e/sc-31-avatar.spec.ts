// SC-31 アバター/着せ替え（ゲーム層）の e2e＝ベース体切替（男女2体）の永続（K-TC-015）。
// 正＝doc/画面設計/screens/SC-31_アバター着せ替え.md §9.2/§9.3・API設計 K.4.1（PUT /me/avatar-base）。
// 3D（WebGL）ビューア or 2D フォールバック（progressive enhancement）の**いずれか**が描画されることも確認。
// 共有 seed（ACME-01）を汚さないよう、切替後は**元値へ戻して cleanup**する。
import { expect, type Page, test } from "@playwright/test";

const U = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" }; // MFA OFF

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(U.company);
  await page.locator("#login_id").fill(U.loginId);
  await page.locator("#password").fill(U.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/", { timeout: 15000 });
}

const avatarBase = async (page: Page): Promise<string> =>
  (await page.request.get("/api/v1/me").then((r) => r.json())).profile.avatar_base;

test("K-TC-015 ベース体切替が永続する（SC-31 / K.4.1・3D or 2D 不問）", async ({ page }) => {
  await login(page);
  await page.goto("/avatar");

  const group = page.getByRole("group", { name: "ベース体の切替" });
  await expect(group).toBeVisible();

  // progressive enhancement＝3D Canvas か 2D マスコットのいずれかが描画される（§9.3）
  await expect(page.locator(".viewer__stage canvas, img.viewer__avatar").first()).toBeVisible();

  const initial = await avatarBase(page); // 通常 male（§5.3 既定）
  const toLabel = initial === "female" ? "男" : "女";
  const toValue = initial === "female" ? "male" : "female";

  // 切替→サーバー永続（PUT /me/avatar-base）
  await group.getByRole("button", { name: toLabel }).click();
  await expect.poll(() => avatarBase(page)).toBe(toValue);

  // リロード後も UI が反映（永続）
  await page.reload();
  await expect(page.getByRole("group", { name: "ベース体の切替" }).getByRole("button", { name: toLabel }))
    .toHaveAttribute("aria-pressed", "true");

  // cleanup＝元値へ戻す（共有 seed 非破壊）
  const backLabel = initial === "female" ? "女" : "男";
  await page.getByRole("group", { name: "ベース体の切替" }).getByRole("button", { name: backLabel }).click();
  await expect.poll(() => avatarBase(page)).toBe(initial);
});
