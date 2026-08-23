import { expect, test, type Page } from "@playwright/test";

// SC-21 アイデア登録・編集フォーム（実接続・D.2／§13／§4.7 前段）。一般ユーザー ACME-01（デモグループ所属・dev seed 前提）で、
// 下地の recruiting クエストを API で作成 → 登録フルページ /quests/{id}/ideas/new で投稿/下書き、/ideas/{id} 編集モーダルで保存を確認する。
// §4.7 の 3 チャネル（サマリ scroll＋足元ヒント＋sticky スナックバー）は SC-21 では主ボタン活性ガードにより主経路で到達不能＝
// 本 spec は前段ガード（ボタン活性・blur インライン）を D-TC-204 で担保。3 チャネルの発火はサーバエラー経由で後続 TC。
// 分岐網羅は api レベル（D-TC-101〜118）で担保（テスト規約 §4・§5.1 line 112）。根拠＝doc/テスト/D_アイデア.md §3・screens/SC-21。
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

// 下地の公開クエストを API で作成（デモグループ・recruiting）。作成者＝ACME-01（owner＝idea_create あり）。返り値＝クエスト id。
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

// アイデアを API で作成（編集 e2e の下地）。返り値＝アイデア id。
async function createIdeaApi(page: Page, questId: string, title: string, status: "draft" | "published"): Promise<string> {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title, value: "E2E 価値", body: "E2E 本文", stakeholders: [], time_limit: null, note: null, status },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function listIdeas(page: Page, questId: string): Promise<Array<{ id: string; title: string; status: string }>> {
  const res = await page.request.get(`/api/v1/quests/${questId}/ideas?limit=100`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data;
}

async function deleteQuestQuiet(page: Page, id: string) {
  const csrf = csrfOf(await page.context().cookies());
  await page.request.delete(`/api/v1/quests/${id}`, { headers: { "X-CSRF-Token": csrf } });
}

// D-TC-201 即公開作成＝フォームで投稿→成功トースト→クエスト詳細へ戻る→一覧(API)に published で出る。
test("D-TC-201 SC-21 publish idea via form appears in list", async ({ page }) => {
  await login(page);
  const qtitle = `E2Eアイデア公開_${Date.now().toString().slice(-8)}`;
  const questId = await createRecruiting(page, qtitle);
  const ititle = `公開アイデア_${Date.now().toString().slice(-8)}`;
  try {
    await page.goto(`/quests/${questId}/ideas/new`);
    await page.locator("#idea_subject").fill(ititle);
    await page.locator("#idea_value").fill("このアイデアの価値");
    await page.locator("#idea_body").fill("このアイデアの本文");
    await page.getByRole("button", { name: "投稿する" }).click();

    await expect(page.getByText("アイデアを投稿しました")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/quests/${questId}$`));

    const ideas = await listIdeas(page, questId);
    const found = ideas.find((i) => i.title === ititle);
    expect(found, "投稿したアイデアが一覧に出る").toBeTruthy();
    expect(found!.status).toBe("published");
  } finally {
    await deleteQuestQuiet(page, questId);
  }
});

// D-TC-202 下書き保存＝本人にのみ表示（一覧に status=draft・author=本人）。
test("D-TC-202 SC-21 save draft is visible to author as draft", async ({ page }) => {
  await login(page);
  const qtitle = `E2Eアイデア下書き_${Date.now().toString().slice(-8)}`;
  const questId = await createRecruiting(page, qtitle);
  const ititle = `下書きアイデア_${Date.now().toString().slice(-8)}`;
  try {
    await page.goto(`/quests/${questId}/ideas/new`);
    await page.locator("#idea_subject").fill(ititle);
    await page.locator("#idea_value").fill("下書きの価値");
    await page.locator("#idea_body").fill("下書きの本文");
    await page.getByRole("button", { name: "下書き保存" }).click();

    await expect(page.getByText("下書きを保存しました")).toBeVisible();

    const ideas = await listIdeas(page, questId);
    const found = ideas.find((i) => i.title === ititle);
    expect(found, "下書きが本人の一覧に出る").toBeTruthy();
    expect(found!.status).toBe("draft");
  } finally {
    await deleteQuestQuiet(page, questId);
  }
});

// D-TC-203 編集＝既存アイデアを詳細から編集→件名更新が API に反映される。
test("D-TC-203 SC-21 edit updates title", async ({ page }) => {
  await login(page);
  const qtitle = `E2Eアイデア編集_${Date.now().toString().slice(-8)}`;
  const questId = await createRecruiting(page, qtitle);
  const before = `編集前_${Date.now().toString().slice(-8)}`;
  const after = `編集後_${Date.now().toString().slice(-8)}`;
  const ideaId = await createIdeaApi(page, questId, before, "published");
  try {
    await page.goto(`/ideas/${ideaId}`);
    // idea-actions の「編集」（詳細本体はデモだが編集モーダルは実 ideaId で接続）。
    await page.getByRole("button", { name: "編集", exact: true }).click();

    // 編集モーダル＝getIdea でプリフィル。件名が実データで埋まるのを待つ。
    const subject = page.locator("#idea_subject");
    await expect(subject).toHaveValue(before);
    await subject.fill(after);
    await page.getByRole("button", { name: "変更を保存" }).click();

    await expect(page.getByText("変更を保存しました")).toBeVisible();

    const res = await page.request.get(`/api/v1/ideas/${ideaId}`);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).title).toBe(after);
  } finally {
    await deleteQuestQuiet(page, questId);
  }
});

// D-TC-204 §4.7 前段ガード＝主ボタンは 3 必須が揃うまで無効・件名 blur でインライン検証が出る。
test("D-TC-204 SC-21 submit gated by required + blur inline validation", async ({ page }) => {
  await login(page);
  const qtitle = `E2Eアイデア検証_${Date.now().toString().slice(-8)}`;
  const questId = await createRecruiting(page, qtitle);
  try {
    await page.goto(`/quests/${questId}/ideas/new`);
    const submit = page.getByRole("button", { name: "投稿する" });
    await expect(submit).toBeDisabled();

    // 件名にフォーカス→空のまま blur（次項目へ）＝インライン検証（aria-invalid＋文言）。
    await page.locator("#idea_subject").click();
    await page.locator("#idea_value").click();
    await expect(page.locator("#idea_subject")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("件名は必須です。")).toBeVisible();

    // 3 必須を充足すると活性化する。
    await page.locator("#idea_subject").fill("件名");
    await page.locator("#idea_value").fill("価値");
    await page.locator("#idea_body").fill("本文");
    await expect(submit).toBeEnabled();
  } finally {
    await deleteQuestQuiet(page, questId);
  }
});

// D-TC-208 登録モーダルは初期表示で誤検証しない（モーダルのフォーカス制御で件名の必須エラーが出ない）。
// blur 検証（タブ移動）は維持されることも確認。
test("D-TC-208 SC-21 modal has no premature validation on open", async ({ page }) => {
  await login(page);
  const questId = await createRecruiting(page, `E2Eモーダル_${Date.now().toString().slice(-8)}`);
  try {
    await page.goto(`/quests/${questId}`);
    await page.getByRole("button", { name: "＋ アイデアを追加" }).click(); // URL モーダル（intercept）
    await page.locator("#idea_subject").waitFor();
    // 初期表示（無操作）＝誤検証なし。
    await expect(page.getByText("件名は必須です。")).toHaveCount(0);
    await expect(page.locator("#idea_subject")).not.toHaveAttribute("aria-invalid", "true");
    // 件名→価値へタブ移動（blur）＝§4.7 の blur 検証は維持。
    await page.locator("#idea_subject").click();
    await page.locator("#idea_value").click();
    await expect(page.getByText("件名は必須です。")).toBeVisible();
  } finally {
    await deleteQuestQuiet(page, questId);
  }
});
