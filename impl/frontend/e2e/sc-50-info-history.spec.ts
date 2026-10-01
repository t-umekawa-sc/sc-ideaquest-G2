// SC-50 §85 更新履歴＝変更内容を見せる（アイデア SC-22 相当）。台帳＝N §3.3（N-TC-213）。
// 作成者が内容を編集して保存すると、更新履歴の最新版に変更フィールドのバッジが付き、「差分を表示」で差分が出る。
import { test, expect } from "./fixtures"; // ワーカ別DB隔離（§4.1）＝各ワーカ専用会社で情報デモを隔離
import { gotoAuthed, csrfToken, createInfoItem } from "./helpers";

async function deleteInfoItem(page: import("@playwright/test").Page, id: string) {
  await page.request.delete(`/api/v1/info-items/${id}`, { headers: { "X-CSRF-Token": await csrfToken(page) } });
}

test("N-TC-213: 更新履歴が変更内容を見せる（バッジ＋差分展開）", async ({ page }) => {
  await gotoAuthed(page);
  const id = await createInfoItem(page, "履歴タイトルX");
  try {
    await page.goto(`/info-items/${id}`);
    // 作成者なのでタイトルを編集して保存＝版2を作る。
    const titleInput = page.locator(".info-dlg input.input").first();
    await expect(titleInput).toHaveValue("履歴タイトルX");
    await titleInput.fill("履歴タイトルY");
    await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/info-items/${id}`) && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "保存する" }).click(),
    ]);

    // 再度開いて 🕘 更新履歴 を展開。
    await page.goto(`/info-items/${id}`);
    await page.locator("summary", { hasText: "🕘 更新履歴" }).click();

    // 最新版（先頭）に変更フィールドのバッジ「タイトル」が付く。
    const latest = page.locator(".info-rev").first();
    await expect(latest.locator(".info-rev__fields .badge", { hasText: "タイトル" })).toBeVisible();

    // 「差分を表示」を展開すると差分（旧を削除・新を追加）が出る。
    await latest.locator("summary", { hasText: "差分を表示" }).click();
    await expect(latest.locator(".diff-del", { hasText: "X" })).toBeVisible();
    await expect(latest.locator(".diff-add", { hasText: "Y" })).toBeVisible();
  } finally {
    await deleteInfoItem(page, id);
  }
});
