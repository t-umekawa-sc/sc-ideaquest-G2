import { expect, test, type Page } from "@playwright/test";

// SC-25 評価画面（F.2 実接続）＋SC-22 §4.6 評価結果（F.1）＋選定（F.3）。ACME-01（owner＝評価者＋選定可）で、
// recruiting クエスト＋published アイデアを API で作成し、評価の確定/下書き/選定を画面↔API で確認する。
// 根拠＝doc/テスト/F_評価.md §4（F-TC-201〜203）・API設計 F・screens/SC-25/SC-22。
const USER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(USER.company);
  await page.locator("#login_id").fill(USER.loginId);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  // ログイン成立の判定＝/login を抜けて共通ヘッダーが出る（挨拶文は時間帯で変わり「ようこそ」は存在しないため使わない）。
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
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

async function createPublishedIdea(page: Page, questId: string, stamp: string): Promise<string> {
  const csrf = csrfOf(await page.context().cookies());
  const res = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { title: `評価アイデア_${stamp}`, value: `価値_${stamp}`, body: `本文_${stamp}`, stakeholders: [], time_limit: null, note: null, status: "published" },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

const ASPECTS = ["新規性", "影響度", "実現度", "適合性", "コスト"];

async function rateAll(page: Page, n: number) {
  for (const label of ASPECTS) {
    await page.getByRole("radiogroup", { name: `${label}の点数` }).getByRole("radio", { name: `${n}点` }).click();
  }
}

test("F-TC-201 SC-25 submit evaluation reflects in SC-22 result", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E評価_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}/eval`);
    await expect(page.getByText(`評価アイデア_${stamp}`)).toBeVisible(); // 文脈が実データ
    await rateAll(page, 5);
    await page.locator("#evalOverall").fill("全体として非常に良い。");
    await page.getByRole("button", { name: "評価を確定" }).click();

    await expect(page.getByText("評価を確定しました")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/ideas/${ideaId}$`));

    // SC-22 評価結果に実データ（評価者1名・平均5.0）が出る。
    const evalSection = page.getByLabel("評価結果");
    await expect(evalSection.getByText(/評価者1名/)).toBeVisible();
    await expect(evalSection.getByText("5.0", { exact: true }).first()).toBeVisible();
    await expect(evalSection.getByText("全体として非常に良い。")).toBeVisible();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("F-TC-202 SC-25 draft is prefilled on revisit", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E下書き_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}/eval`);
    await page.getByRole("radiogroup", { name: "新規性の点数" }).getByRole("radio", { name: "3点" }).click();
    await page.getByRole("button", { name: "下書き保存" }).click();
    await expect(page.getByText("下書きを保存しました")).toBeVisible();

    // 再訪＝getMyEvaluation でプリフィル（新規性3点が復元）。
    await page.goto(`/ideas/${ideaId}/eval`);
    await expect(
      page.getByRole("radiogroup", { name: "新規性の点数" }).getByRole("radio", { name: "3点" }),
    ).toHaveAttribute("aria-checked", "true");

    // 確定していないので SC-22 は評価者0名（評価待ち）。
    await page.goto(`/ideas/${ideaId}`);
    await expect(page.getByLabel("評価結果").getByText(/まだ提出済みの評価がありません/)).toBeVisible();
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

test("F-TC-203 SC-22 select toggle by owner", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E選定_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}`);
    const selectBtn = page.getByRole("button", { name: /このアイデアを選定/ });
    await expect(selectBtn).toBeVisible();
    await selectBtn.click();
    // 選定は XP のみ付与（コインはクエスト確定時に平均点ベースで別途＝select_idea は _XP_SELECTION のみ）。
    await expect(page.getByText("アイデアを選定しました。投稿者に XP を付与しました。")).toBeVisible();
    await expect(page.getByRole("button", { name: /選定済み/ })).toBeVisible();
    await expect(page.getByLabel("アイデア情報").getByText("選定候補", { exact: true })).toBeVisible();

    // サーバー権威で反映（GET /ideas/{id} の is_selected=true）。
    const detail = await page.request.get(`/api/v1/ideas/${ideaId}`).then((r) => r.json());
    expect(detail.is_selected).toBe(true);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// #16 クエスト選定の祝福（GF-AC-160/161）＝初回選定（XP付与）で中央に祝福オーバーレイ（.select-celebrate）が出る／クリックで閉じる／解除では出ない。
test("G-TC-171 SC-22 selection celebration appears on award and not on unselect (#16)", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E祝福_${stamp}`);
  const ideaId = await createPublishedIdea(page, questId, stamp);
  try {
    await page.goto(`/ideas/${ideaId}`);
    await page.getByRole("button", { name: /このアイデアを選定/ }).click();
    // 初回選定（XP付与）で祝福オーバーレイが出る（👑/SELECTED!/アイデア名/✦+200 XP）。
    const cele = page.locator(".select-celebrate");
    await expect(cele).toBeVisible();
    await expect(cele.getByText("SELECTED!")).toBeVisible();
    await expect(cele.getByText(`評価アイデア_${stamp}`)).toBeVisible();
    // クリックで即閉じ。
    await cele.click();
    await expect(cele).toHaveCount(0);
    // 解除では祝福を出さない（スナックバーのみ）。
    await page.getByRole("button", { name: /選定済み/ }).click();
    await expect(page.getByText("選定を解除しました。")).toBeVisible();
    await expect(page.locator(".select-celebrate")).toHaveCount(0);
  } finally {
    const c2 = csrfOf(await page.context().cookies());
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
  }
});

// #16 reduce（GF-AC-162）＝reduce-motion では祝福オーバーレイを出さず、成功スナックバーで通知（選定自体は正常）。
test.describe("reduce-motion #16", () => {
  test("G-TC-172 SC-22 selection celebration is suppressed under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    const stamp = Date.now().toString().slice(-8);
    const questId = await createRecruiting(page, `E2E祝福R_${stamp}`);
    const ideaId = await createPublishedIdea(page, questId, stamp);
    try {
      await page.goto(`/ideas/${ideaId}`);
      await page.getByRole("button", { name: /このアイデアを選定/ }).click();
      // reduce では祝福オーバーレイは出ない／成功スナックバー＋選定済みは正常。
      await expect(page.getByText("アイデアを選定しました。投稿者に XP を付与しました。")).toBeVisible();
      await expect(page.getByRole("button", { name: /選定済み/ })).toBeVisible();
      await expect(page.locator(".select-celebrate")).toHaveCount(0);
    } finally {
      const c2 = csrfOf(await page.context().cookies());
      await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c2 } });
    }
  });
});
