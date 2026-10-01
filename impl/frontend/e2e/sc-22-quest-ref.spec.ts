import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures"; // ワーカ別DB隔離(§4.1)=各ワーカ専用会社でログイン
import { gotoAuthed, csrfToken, csrfHeaders, createRecruiting, createPublishedIdea } from "./helpers";
// SC-22 の quest 参照（D.1）＝「クエストへ戻る」実導線・カテゴリーバッジ・completed 事前無効化。
// 根拠＝doc/テスト/D_アイデア.md §3（D-TC-213/214）・screens/SC-22 §4.5・API設計 D.1/C.5。

async function transition(page: Page, questId: string, to: string) {
  const res = await page.request.post(`/api/v1/quests/${questId}/transition`, {
    headers: await csrfHeaders(page),
    data: { to },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test("D-TC-213 SC-22 back link targets the quest and shows category badge", async ({ page }) => {
  await gotoAuthed(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E参照_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}`);
    // 「クエストへ戻る」が一覧固定でなく当該クエストを指す（ラベルは履歴有無で動的＝安定クラスで特定）。
    const back = page.locator("a.backlink--float");
    await expect(back).toHaveAttribute("href", `/quests/${questId}`);
    // クエストのカテゴリーバッジがヘッダーに出る。
    await expect(page.getByLabel("アイデア情報").getByText("業務改善", { exact: true })).toBeVisible();
  } finally {
    const c2 = await csrfToken(page);
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("D-TC-214 SC-22 completed quest disables vote; new follow shows info (not disabled)", async ({ page }) => {
  await gotoAuthed(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E凍結_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  // アイデア公開後にクエストを完了へ前進（recruiting→in_progress→evaluating→completed）。
  await transition(page, questId, "in_progress");
  await transition(page, questId, "evaluating");
  await transition(page, questId, "completed");
  try {
    await page.goto(`/ideas/${ideaId}`);
    // 凍結バッジ＋投票/新規フォローの事前無効化。
    await expect(page.getByText("⏸ 完了（凍結）")).toBeVisible();
    await expect(page.getByRole("button", { name: "▲ 賛成" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "▼ 反対" })).toBeDisabled();
    // フォローは無効化しない＝新規は押下で info（解除のみ可・memory: completed-quest-freeze-ui-standard）。
    const follow = page.getByRole("button", { name: "☆ フォロー" });
    await expect(follow).toBeEnabled();
    await expect(follow).toHaveAttribute("title", /新規フォローできません/);
  } finally {
    const c2 = await csrfToken(page);
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
