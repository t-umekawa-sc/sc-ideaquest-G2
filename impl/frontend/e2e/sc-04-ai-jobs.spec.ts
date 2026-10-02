import { test, expect } from "./fixtures"; // ワーカ別DB隔離(§4.1)=各ワーカ専用会社でログイン（会社スコープ）
import { gotoAuthed } from "./helpers";

// SC-04 AI処理状況の表示（FR-45・S.1/S.1a・doc/テスト/S_AIジョブ.md §3）。
// AIジョブの queued/running は worker が消費して状態が不安定ゆえ、表示ロジックの担保は API 応答を route で
// スタブして決定的に行う（backend 側の算出＝pytest S-TC-129/130 で担保済み・ここは frontend 表示の担保）。

test("S-TC-207 SC-04 上部に他ユーザの実行中を進捗率のみ匿名表示", async ({ page }) => {
  // 会社内 running（自分除外・ratio のみ）をスタブ。
  await page.route("**/api/v1/ai-jobs/running", (r) => r.fulfill({ json: { data: [{ ratio: 0.5 }, { ratio: 0.2 }] } }));
  await gotoAuthed(page);
  await page.goto("/ai-jobs");

  const others = page.locator(".ai-others");
  await expect(others).toBeVisible();
  await expect(others.getByText("実行中 #1")).toBeVisible();
  await expect(others.getByText("50%")).toBeVisible();
  await expect(others.getByText("実行中 #2")).toBeVisible();
  await expect(others.getByText("20%")).toBeVisible();
  // 匿名＝依頼者（メール/ログインID）や入力内容は出さない（進捗率のみ）。
  await expect(others).not.toContainText("@");
});

test("S-TC-208 SC-04 待機行は「前に N 件待機」を表示し見込み時間は出さない", async ({ page }) => {
  // 一覧（DataTable サーバー委譲）をスタブ＝待機(queue_position=3)＋実行中(ratio=0.4)。
  await page.route(/\/api\/v1\/ai-jobs\?/, (r) =>
    r.fulfill({
      json: {
        data: [
          { id: "11111111-1111-4111-8111-111111111111", task_type: "info_summarize", status: "queued", progress: null, queue_position: 3, eta_seconds: 120, created_at: "2026-10-02T04:00:00", finished_at: null },
          { id: "22222222-2222-4222-8222-222222222222", task_type: "info_summarize", status: "running", progress: { ratio: 0.4 }, queue_position: null, eta_seconds: null, created_at: "2026-10-02T04:01:00", finished_at: null },
        ],
        page_info: { page: 1, per_page: 20, total: 2, has_next: false },
      },
    }),
  );
  await gotoAuthed(page);
  await page.goto("/ai-jobs");

  await expect(page.getByText("前に 2 件待機")).toBeVisible(); // queue_position 3 → 自分の前は 2 件
  await expect(page.getByText("40%")).toBeVisible();            // 実行中は進捗率
  await expect(page.getByText(/約\d+分後/)).toHaveCount(0);     // 見込み時間（ETA）は出さない
});

test("S-TC-209 共通ヘッダーに AIジョブ導線＋active 件数バッジ", async ({ page }) => {
  // 自分の active（queued+running）件数をスタブ＝3。
  await page.route("**/api/v1/ai-jobs/summary", (r) => r.fulfill({ json: { queued: 2, running: 1, recent_done: 0, recent_failed: 0 } }));
  await gotoAuthed(page);

  const link = page.locator("a.ai-jobs-link");
  await expect(link).toBeVisible();
  await expect(link.locator(".bell__badge")).toHaveText("3"); // active = queued + running
  await link.click();
  await expect(page).toHaveURL(/\/ai-jobs$/); // クリックで SC-04 へ
});
