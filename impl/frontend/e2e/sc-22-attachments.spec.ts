import { expect, test, type Page } from "@playwright/test";

// SC-21 で添付して投稿 → SC-22 に実データで出る＋ダウンロード（D.3・§1.10）。
// 根拠＝doc/テスト/D_アイデア.md §3（D-TC-215）・screens/SC-21/SC-22 §4.3・API設計 D.3。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
const PNG = Buffer.from("89504e470d0a1a0a0000000000000000000000000000000000000000", "hex");

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

test("D-TC-215 SC-21 upload attachment then SC-22 shows it with download", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E添付_${stamp}`);
  const fileName = `zu_${stamp}.png`;
  try {
    // SC-21 フルページ登録＝件名/価値/本文＋添付→投稿。
    await page.goto(`/quests/${questId}/ideas/new`);
    await page.locator("#idea_subject").fill(`添付アイデア_${stamp}`);
    await page.locator("#idea_value").fill(`価値_${stamp}`);
    await page.locator("#idea_body").fill(`本文_${stamp}`);
    await page.setInputFiles("#idea_files", { name: fileName, mimeType: "image/png", buffer: PNG });
    await expect(page.getByText(fileName)).toBeVisible(); // 添付チップに出る
    await page.getByRole("button", { name: "投稿する" }).click();
    await expect(page).toHaveURL(new RegExp(`/quests/${questId}$`)); // 投稿後は詳細へ戻る

    // 作成されたアイデアを API で特定し、SC-22 を開く。
    const list = await page.request.get(`/api/v1/quests/${questId}/ideas?limit=50`).then((r) => r.json());
    const idea = list.data.find((i: { title: string }) => i.title === `添付アイデア_${stamp}`);
    expect(idea, "作成したアイデアが一覧に無い").toBeTruthy();
    await page.goto(`/ideas/${idea.id}`);

    // SC-22 関連資料に実データで出る＋ダウンロードボタン活性。
    await expect(page.getByLabel("関連資料").getByText(fileName)).toBeVisible();
    const dl = page.getByLabel("関連資料").getByRole("button", { name: /ダウンロード/ });
    await expect(dl).toBeEnabled();

    // ダウンロード EP が署名URL を返す。
    const detail = await page.request.get(`/api/v1/ideas/${idea.id}`).then((r) => r.json());
    const aid = detail.attachments[0].id;
    const d = await page.request.get(`/api/v1/attachments/${aid}/download`);
    expect(d.status(), await d.text()).toBe(200);
    expect((await d.json()).url).toBeTruthy();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// アイデアを作成＋添付を1件アップロード（編集モードの下地）。返り値＝アイデア id。
async function createIdeaWithAttachment(page: Page, questId: string, stamp: string, fileName: string): Promise<string> {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title: `添付編集_${stamp}`, value: `価値_${stamp}`, body: `本文_${stamp}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const ideaId = (await res.json()).id as string;
  const up = await page.request.post(`/api/v1/ideas/${ideaId}/attachments`, {
    headers: { "X-CSRF-Token": csrf },
    multipart: { files: { name: fileName, mimeType: "image/png", buffer: PNG } },
  });
  expect(up.status(), await up.text()).toBe(201);
  return ideaId;
}

// D-TC-218 SC-21 編集モードで既存添付の一覧＋削除（確認ダイアログ→即時サーバー削除・版を生まない）。
test("D-TC-218 SC-21 edit mode lists existing attachment and deletes it", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E既存添付_${stamp}`);
  const fileName = `shiryo_${stamp}.png`;
  const ideaId = await createIdeaWithAttachment(page, questId, stamp, fileName);
  try {
    await page.goto(`/ideas/${ideaId}`);
    await page.getByRole("button", { name: "編集", exact: true }).click();
    // 編集フォームがプリフィルされ、保存済み添付が一覧に出る。
    await expect(page.locator("#idea_subject")).toHaveValue(`添付編集_${stamp}`);
    const attachRow = page.locator(".attach", { hasText: fileName });
    await expect(attachRow).toBeVisible();

    // × → 確認ダイアログ「削除する」で即時サーバー削除。
    await attachRow.getByRole("button", { name: `${fileName} を削除` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "削除する" }).click();
    await expect(page.getByText("添付を削除しました。")).toBeVisible();
    await expect(page.locator(".attach", { hasText: fileName })).toHaveCount(0);

    // サーバー側でも消えている（版は増えない＝current_revision は 1 のまま）。
    const detail = await page.request.get(`/api/v1/ideas/${ideaId}`).then((r) => r.json());
    expect(detail.attachments).toHaveLength(0);
    expect(detail.current_revision).toBe(1);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});
