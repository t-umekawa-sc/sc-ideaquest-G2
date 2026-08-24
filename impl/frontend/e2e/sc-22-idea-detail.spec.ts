import { expect, test, type Page } from "@playwright/test";

// SC-22 アイデア詳細（実接続・D.1）。本文/価値/利害関係者/ステータス/作成者/版を getIdea で描画。
// 投票/フォロー（D.5/D.6）は実接続＝挙動は sc-22-vote-follow.spec.ts（D-TC-209〜212）。添付（D.3）・評価（F）・チャット（E）は未接続＝表示のみ/デモ。
// 根拠＝doc/テスト/D_アイデア.md §3・screens/SC-22。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}
function csrfOf(c: { name: string; value: string }[]) { return c.find((x) => x.name === "iq_csrf")?.value ?? ""; }
async function createRecruiting(page: Page, title: string): Promise<string> {
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, color: "#0D9488", quest_group_id: groups.data[0].id, categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E 目的", status: "recruiting" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

test("D-TC-207 SC-22 detail renders getIdea data", async ({ page }) => {
  await login(page);
  const questId = await createRecruiting(page, `E2E詳細_${Date.now().toString().slice(-8)}`);
  const stamp = Date.now().toString().slice(-8);
  const title = `詳細アイデア_${stamp}`;
  const value = `詳細の価値_${stamp}`;
  const body = `詳細の本文_${stamp}`;
  const csrf = csrfOf(await page.context().cookies());
  const created = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, value, body, stakeholders: [{ label: "物流部", is_custom: false }], time_limit: null, note: null, status: "published" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const ideaId = (await created.json()).id as string;
  try {
    await page.goto(`/ideas/${ideaId}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(value)).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByText("投稿: テスト 太郎")).toBeVisible();
    // 利害関係者＝ヘッダーの meta 行。
    await expect(page.getByLabel("アイデア情報").getByText(/物流部/)).toBeVisible();
    // ステータス（公開）バッジ＝ヘッダー（exact で公開範囲等と区別）。
    await expect(page.getByLabel("アイデア情報").getByText("公開", { exact: true })).toBeVisible();
    // 投票/フォローのボタンは活性（D.5/D.6 接続済み・挙動は D-TC-209〜212）。
    await expect(page.getByRole("button", { name: "▲ 賛成" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /フォロー/ })).toBeEnabled();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
