import { expect, test, type Page } from "@playwright/test";

// SC-12 クエスト詳細（実接続・C.1/C.3/C.5/C.2）。一般ユーザー ACME-01（デモグループ所属・dev seed 前提）で、
// 下地クエストを API で作成 → 詳細でヘッダー/概要/パーティーの実データ表示・状態遷移・削除を確認する。
// アイデア一覧＝D／全文検索＝J／週間ランキング＝G はデモのため範囲外。根拠＝screens/SC-12・API設計 C。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

function csrfOf(cookies: { name: string; value: string }[]) {
  return cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
}

// 下地の公開クエストを API で作成（デモグループ・recruiting）。返り値＝クエスト id。
async function createRecruiting(page: Page, title: string): Promise<string> {
  const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
  const groupId = groups.data?.[0]?.id;
  expect(groupId, "デモグループ（GET /quest-groups）が必要（dev seed）").toBeTruthy();
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post("/api/v1/quests", {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, color: "#0D9488", quest_group_id: groupId, categories: ["業務改善"], deadline: "2026-12-31", purpose: "E2E 目的・テーマ", status: "recruiting" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function deleteQuiet(page: Page, id: string) {
  const csrf = csrfOf(await page.context().cookies());
  await page.request.delete(`/api/v1/quests/${id}`, { headers: { "X-CSRF-Token": csrf } });
}

// ヘッダー/概要/パーティーが GET /quests/{id} の実データを描画する。
test("SC-12 detail renders header/about/party from API", async ({ page }) => {
  await login(page);
  const title = `E2E詳細_${Date.now().toString().slice(-8)}`;
  const id = await createRecruiting(page, title);
  try {
    await page.goto(`/quests/${id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/グループ: デモグループ/)).toBeVisible();

    // 概要タブ＝カテゴリ/グループ等の実データ（ヘッダーにも同カテゴリが出るため概要セクションにスコープ）。
    await page.getByRole("tab", { name: /概要/ }).click();
    await expect(page.getByLabel("概要").getByText("業務改善")).toBeVisible();

    // パーティータブ＝作成者（テスト 太郎）が「作成者」バッジ付きで出る。
    await page.getByRole("tab", { name: /パーティー/ }).click();
    await expect(page.getByLabel("パーティー").getByText("テスト 太郎")).toBeVisible();
    await expect(page.getByLabel("パーティー").getByText("作成者")).toBeVisible();
  } finally {
    await deleteQuiet(page, id);
  }
});

// 状態遷移（recruiting→in_progress）と削除（→一覧へ）。owner のみの ⋯ アクション。
test("SC-12 transition forward then delete", async ({ page }) => {
  await login(page);
  const title = `E2E遷移_${Date.now().toString().slice(-8)}`;
  const id = await createRecruiting(page, title);
  let deleted = false;
  try {
    await page.goto(`/quests/${id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // ⋯ → ステータスを進める（→ 進行中）→ 確認 OK。
    await page.getByRole("button", { name: "操作" }).click();
    await page.getByRole("menuitem", { name: /ステータスを進める/ }).click();
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("進行中").first()).toBeVisible();

    // ⋯ → クエストを削除 → danger 確認 → 一覧へ、タイトルは消える。
    await page.getByRole("button", { name: "操作" }).click();
    await page.getByRole("menuitem", { name: "クエストを削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(page).toHaveURL(/\/quests$/);
    await expect(page.getByText(title)).toHaveCount(0);
    deleted = true;
  } finally {
    if (!deleted) await deleteQuiet(page, id);
  }
});
