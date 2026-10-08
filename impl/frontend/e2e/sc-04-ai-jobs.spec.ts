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

test("S-TC-119 SC-04 実行中の進捗・行キャンセル・完了行で対象へ遷移", async ({ page }) => {
  const RUN = "11111111-1111-4111-8111-111111111111";   // 実行中（進捗確認）
  const QUEUE = "22222222-2222-4222-8222-222222222222"; // 待ち（キャンセル対象）
  const DONE = "33333333-3333-4333-8333-333333333333";  // 完了（ref_idea_id で遷移）
  const REF_IDEA = "44444444-4444-4444-8444-444444444444";
  let canceled = false;
  let cancelUrl = "";

  await page.route("**/api/v1/ai-jobs/running", (r) => r.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/ai-jobs/summary", (r) => r.fulfill({ json: { queued: 1, running: 1, recent_done: 1, recent_failed: 0 } }));
  // キャンセル POST＝以後の一覧取得で当該ジョブが canceled になるようフラグを立てる（協調キャンセルの表示担保）。
  await page.route("**/api/v1/ai-jobs/*/cancel", (r) => { canceled = true; cancelUrl = r.request().url(); r.fulfill({ json: { id: QUEUE, status: "canceled" } }); });
  await page.route(/\/api\/v1\/ai-jobs\?/, (r) => r.fulfill({ json: {
    data: [
      { id: RUN, task_type: "info_summarize", status: "running", progress: { ratio: 0.4 }, queue_position: null, eta_seconds: null, created_at: "2026-10-02T04:01:00", finished_at: null },
      { id: QUEUE, task_type: "info_summarize", status: canceled ? "canceled" : "queued", progress: null, queue_position: canceled ? null : 3, eta_seconds: null, created_at: "2026-10-02T04:00:00", finished_at: canceled ? "2026-10-02T04:05:00" : null },
      { id: DONE, task_type: "info_summarize", status: "succeeded", progress: null, queue_position: null, eta_seconds: null, created_at: "2026-10-02T03:00:00", finished_at: "2026-10-02T03:02:00", ref_idea_id: REF_IDEA },
    ],
    page_info: { page: 1, per_page: 20, total: 3, has_next: false },
  } }));

  await gotoAuthed(page);
  await page.goto("/ai-jobs");

  // 1. 進捗確認＝実行中ジョブの進捗率が一覧に出る。
  await expect(page.getByText("40%")).toBeVisible();

  // 2. 行キャンセル＝待ち行の⋮→「キャンセル」→確認（OK）→cancel API 発火→再取得で当該行が「キャンセル」に。
  const queueRow = page.locator("tbody tr").filter({ hasText: "前に 2 件待機" }); // queue_position 3 → 前は 2 件
  await queueRow.getByRole("button", { name: "操作" }).click();
  await page.getByRole("menuitem", { name: "キャンセル" }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect.poll(() => cancelUrl).toContain(`/ai-jobs/${QUEUE}/cancel`);
  await expect(page.locator("tbody tr").filter({ hasText: "キャンセル" })).toBeVisible();

  // 3. 完了行クリック＝succeeded＋ref_idea_id は対象画面（/ideas/{id}）へ遷移（行クリック＝「結果を見る」と同じ）。
  const doneRow = page.locator("tbody tr").filter({ hasText: "完了" });
  await doneRow.getByText("情報の要約").click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${REF_IDEA}`));
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
