import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures"; // ワーカ別DB隔離(§4.1)=各ワーカ専用会社でログイン
import { gotoAuthed, csrfToken, csrfHeaders, createRecruiting, createPublishedIdea } from "./helpers";
// SC-22 更新履歴モーダル（D.4 版タイムライン＋差分・実接続）。公開で初版 revision=1・PATCH で revision=2 を作り、
// 「版 N（履歴）」→モーダルに実データ（v2/v1〔初版〕・変更フィールド・差分セグメント）が出ることを確認する。
// 根拠＝doc/テスト/D_アイデア.md §3（D-TC-217）・API設計 D.4・screens/SC-22。

async function patchIdea(page: Page, ideaId: string, data: Record<string, unknown>) {
  const res = await page.request.patch(`/api/v1/ideas/${ideaId}`, {
    headers: await csrfHeaders(page),
    data,
  });
  expect(res.status(), await res.text()).toBe(200);
}

// D-TC-217 更新履歴モーダルが実データ（版タイムライン＋差分）。
test("D-TC-217 SC-22 revision history modal renders real timeline and diff", async ({ page }) => {
  await gotoAuthed(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E履歴_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  // 公開＝初版 revision=1。本文/価値を編集 → revision=2。
  await patchIdea(page, ideaId, { value: `価値_${stamp}_改`, body: `本文_${stamp}_改` });
  try {
    await page.goto(`/ideas/${ideaId}`);
    // 「版 2（履歴）」ボタン→更新履歴モーダル。
    await page.getByRole("button", { name: /版.*（履歴）/ }).click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByText("更新履歴", { exact: true })).toBeVisible();

    // v1（初版）バッジ＝実データ（デモ文言でない）。
    await expect(modal.getByText("初版", { exact: true })).toBeVisible();
    // v2 の変更フィールドバッジ（価値・アイデア本文）。
    await expect(modal.getByText("アイデア本文", { exact: true })).toBeVisible();
    await expect(modal.getByText("価値", { exact: true })).toBeVisible();

    // v2 の差分を展開＝getRevisionDiff の add/del セグメントが出る。
    await modal.getByText("差分を表示", { exact: true }).click();
    await expect(modal.locator(".diff-add").first()).toBeVisible();
  } finally {
    const c2 = await csrfToken(page);
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
