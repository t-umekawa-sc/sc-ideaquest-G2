import { execSync } from "node:child_process";
import path from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

// e2e 共有ヘルパ（テスト規約 §4.1・2系統モデルの横断層）。
// 目的＝各 spec に散っていた重複実装（csrf 抽出・psql・ドメイン生成・ログイン・一覧 assertion）を
// 1 箇所へ集約し、fragile の whack-a-mole（個別 spec を1本ずつ硬化し続ける）を根治する。
// 方針＝呼び出し側の見た目は最頻ケースで最短（引数なし）・想定される変種は opts で吸収（ローカル再実装を復活させない）。
// 会社DB操作は `workerCompany.dbName`（fixtures）を渡す＝ワーカ別DB隔離と整合。

const IMPL_DIR = path.resolve(__dirname, "..", ".."); // e2e → frontend → impl

// ---- CSRF / HTTP ----

/** 現在のコンテキストの iq_csrf cookie 値（未取得なら ""）。書き込み系 API の X-CSRF-Token に使う。 */
export async function csrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
}

/** 書き込み系 API 向けの共通ヘッダ（CSRF + JSON）。 */
export async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  return { "X-CSRF-Token": await csrfToken(page), "Content-Type": "application/json" };
}

// ---- 会社DB直接操作（docker compose db psql） ----

/** 会社DB に SQL を実行（戻り値なし）。db は fixtures の workerCompany.dbName を渡す。 */
export function psql(db: string, sql: string): void {
  execSync(`docker compose exec -T db psql -U ideaquest -d ${db} -c ${JSON.stringify(sql)}`, {
    cwd: IMPL_DIR,
    stdio: "pipe",
  });
}

/** 会社DB に SQL を実行し単一値を取得（-tA）。件数/ID の検証に使う。 */
export function psqlValue(db: string, sql: string): string {
  return execSync(`docker compose exec -T db psql -U ideaquest -d ${db} -tA -c ${JSON.stringify(sql)}`, {
    cwd: IMPL_DIR,
    stdio: "pipe",
  })
    .toString()
    .trim();
}

// ---- 認証 ----

/** storageState 前提で認証済みホームへ遷移し、共通ヘッダの可視を確認（旧 login(page) の置換）。 */
export async function gotoAuthed(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

/** ログインフォームから実ログイン（SC-00 系・未認証 opt-out spec 用）。成功＝/login を離れヘッダ可視。 */
export async function formLogin(
  page: Page,
  creds: { company: string; loginId: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.locator("#company_code").fill(creds.company);
  await page.locator("#login_id").fill(creds.loginId);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

// ---- ドメイン生成 ----

export type CreateRecruitingOpts = {
  /** 既定 ["業務改善"] */
  categories?: string[];
  /** 既定＝デモグループ先頭 [data[0].id]（無ければ会社全体 []）。明示 [] で会社全体。 */
  questGroupIds?: string[];
  /** 既定 "recruiting" */
  status?: "recruiting" | "draft";
  /** 既定 "2026-12-31" */
  deadline?: string;
  /** 既定 "E2E 目的" */
  purpose?: string;
};

/** 募集中クエストを API 作成し quest id を返す。最頻ケースは createRecruiting(page, title)。 */
export async function createRecruiting(page: Page, title: string, opts: CreateRecruitingOpts = {}): Promise<string> {
  let questGroupIds = opts.questGroupIds;
  if (questGroupIds === undefined) {
    const groups = await page.request.get("/api/v1/quest-groups").then((r) => r.json());
    questGroupIds = groups.data?.[0]?.id ? [groups.data[0].id] : [];
  }
  const res = await page.request.post("/api/v1/quests", {
    headers: await csrfHeaders(page),
    data: {
      title,
      color: "#0D9488",
      quest_group_ids: questGroupIds,
      categories: opts.categories ?? ["業務改善"],
      deadline: opts.deadline ?? "2026-12-31",
      purpose: opts.purpose ?? "E2E 目的",
      status: opts.status ?? "recruiting",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

/** 指定クエストに published なアイデアを API 作成し idea id を返す。 */
export async function createPublishedIdea(page: Page, questId: string, stamp: string): Promise<string> {
  const res = await page.request.post(`/api/v1/quests/${questId}/ideas`, {
    headers: await csrfHeaders(page),
    data: {
      title: `評価アイデア_${stamp}`,
      value: `価値_${stamp}`,
      body: `本文_${stamp}`,
      stakeholders: [],
      time_limit: null,
      note: null,
      status: "published",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

/** 情報アイテムを画面フロー（/info-items/new）で作成し id を返す。 */
export async function createInfoItem(page: Page, title: string): Promise<string> {
  await page.goto("/info-items/new");
  await page.locator("#im-title").fill(title);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => /\/info-items$/.test(new URL(r.url()).pathname) && r.request().method() === "POST"),
    page.getByRole("button", { name: "登録する" }).click(),
  ]);
  const created = (await resp.json()) as { id: string };
  expect(created.id).toBeTruthy();
  return created.id;
}

// ---- DataTable assertion（.list-count 多重/セル内 badge を吸収） ----
// フッターの件数ラベル .list-count は region 内に複数（件/名・ページャ span）あり strict 違反・二重一致で
// 不安定になる（§6 の control-plane フレーク）。ここでは件数＝データ行数（tbody tr）・有無＝セルの可視で判定する。

/** 一覧のデータ行数を検証（tbody tr＝thead 除外）。ワーカ別DB隔離で決定的な件数向け。 */
export async function expectListCount(region: Locator, n: number): Promise<void> {
  await expect(region.locator("tbody tr")).toHaveCount(n);
}

/** 指定テキスト（文字列/正規表現）のセルが可視＝当該行が一覧に存在することを検証。 */
export async function expectRowVisible(region: Locator, name: string | RegExp): Promise<void> {
  await expect(region.getByRole("cell", { name })).toBeVisible();
}

/** region 内の検索欄が空（value=""）＝検索が解除されていることを検証（データ非依存で堅牢）。 */
export async function expectSearchCleared(region: Locator): Promise<void> {
  await expect(region.getByRole("searchbox")).toHaveValue("");
}

export { expect };
