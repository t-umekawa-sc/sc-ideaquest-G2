import { expect, test, type Page } from "@playwright/test";

// SC-91 システム管理（会社一覧）＝system_admin 専用（doc/テスト/B §8・API設計 B.1）。
// OPS 運営テナントの system_admin（bootstrap seed）でログインして操作する。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };
const GENERAL = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page, c: { company: string; loginId: string; password: string }) {
  await page.goto("/login");
  await page.locator("#company_code").fill(c.company);
  await page.locator("#login_id").fill(c.loginId);
  await page.locator("#password").fill(c.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// ページ遷移（/admin/companies のドキュメント要求）ではなく API fetch（/api/v1/...）に限定して捕捉。
const isCompaniesApi = (r: { url(): string; method(): string }) =>
  r.url().includes("/api/v1/admin/companies") && r.method() === "GET";

// B-TC-110: system_admin が会社一覧を表示＝seed 会社（ACME-01）が見える。
test("B-TC-110 system admin sees company list", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/companies");
  // 見出しはモック準拠＝page-title「システム管理（運営）」＋ section-head「会社（テナント）」。
  await expect(page.getByRole("heading", { name: "システム管理（運営）" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "会社（テナント）" })).toBeVisible();
  await expect(page.getByText("ACME-01")).toBeVisible();
});

// B-TC-111: 会社作成＝一覧に現れる（status=suspended＝「停止」バッジ）。作成は URL モーダル（intercept）。
test("B-TC-111 create company appears in list", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/companies");
  const code = `E2E-${Date.now().toString().slice(-8)}`;
  await page.getByRole("link", { name: "＋ 会社を作成" }).click(); // トリガは URL モーダルへの Link
  await page.locator("#c_name").fill("E2E テスト社");
  await page.locator("#c_code").fill(code);
  await page.locator("#c_db").fill(`ideaquest_e2e_${Date.now().toString().slice(-8)}`);
  await page.getByRole("button", { name: /作成する/ }).click(); // 送信ボタンは modal（body 直下に portal）
  // 作成成功＝モーダルが閉じ、イベントで一覧が再取得される。ライブ検索で絞って行の出現を toPass で再試行。
  await expect(async () => {
    await page.getByRole("searchbox").fill(code);
    await expect(page.getByRole("row", { name: new RegExp(code) })).toBeVisible({ timeout: 1000 });
  }).toPass();
});

// B-TC-160: 会社作成ダイアログは URL 付きモーダル（Parallel@modal＋Intercept・§112）。
// 一覧からのソフト遷移＝URL が /new になりモーダルが差し込まれ背景の一覧は維持／直アクセス＝フルページ・フォールバック。
test("B-TC-160 create dialog is a URL modal (intercept) with full-page fallback", async ({ page }) => {
  await login(page, OPS);
  await page.goto("/admin/companies");
  await page.getByRole("link", { name: "＋ 会社を作成" }).click();
  await expect(page).toHaveURL(/\/admin\/companies\/new$/); // URL を持つ
  await expect(page.getByRole("dialog")).toBeVisible(); // モーダルが出る
  await expect(page.getByRole("heading", { name: "会社（テナント）を作成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "システム管理（運営）" })).toBeVisible(); // 背景の一覧は維持
  await page.getByRole("button", { name: "キャンセル" }).click(); // 閉じると URL が戻る
  await expect(page).toHaveURL(/\/admin\/companies$/);
  // 直アクセス（リロード相当）＝intercept にマッチせずフルページ・フォールバック（モーダルでない）。
  await page.goto("/admin/companies/new");
  await expect(page.getByRole("heading", { name: "会社（テナント）を作成" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← 会社一覧へ戻る" })).toBeVisible();
});

// B-TC-112: 非 system_admin（general）は SC-91 に入れない（サーバーガード＝/ へリダイレクト）。
test("B-TC-112 general user cannot access SC-91", async ({ page }) => {
  await login(page, GENERAL);
  await page.goto("/admin/companies");
  await expect(page).toHaveURL(/\/$/); // ダッシュボードへ差し戻し
});

// B-TC-137: 会社一覧が DataTable サーバー駆動モードで動く（§1.8.1 委譲）。
// 初期取得は per_page=5（CompanyList の perPage を転送）／会社名ヘッダ click で sort=name が飛ぶ／
// 件数バッジ（.list-count）が表示される（page_info.total 由来）。並び/件数はサーバーが確定する。
test("B-TC-137 server mode: initial per_page and sort=name query", async ({ page }) => {
  await login(page, OPS);
  // ページ遷移（/admin/companies のドキュメント要求）ではなく API fetch（/api/v1/...）に限定して捕捉。
  const isList = (r: { url(): string; method(): string }) =>
    r.url().includes("/api/v1/admin/companies") && r.method() === "GET";
  // 初期一覧リクエスト（マウント後の委譲 query）。
  const [initialReq] = await Promise.all([
    page.waitForRequest(isList),
    page.goto("/admin/companies"),
  ]);
  expect(new URL(initialReq.url()).searchParams.get("per_page")).toBe("5");
  await expect(page.locator(".list-count")).toBeVisible();
  // 会社名ヘッダ click＝単一ソート昇順→ sort=name のサーバー再クエリ。
  const [sortReq] = await Promise.all([
    page.waitForRequest((r) => isList(r) && new URL(r.url()).searchParams.get("sort") === "name"),
    page.getByRole("columnheader", { name: "会社名" }).click(),
  ]);
  expect(new URL(sortReq.url()).searchParams.get("sort")).toBe("name");
  // 並び替えチップが出る（適用中表示）＝クライアント状態も反映。
  await expect(page.getByText("並び替え:")).toBeVisible();
});

// B-TC-138: 項目別フィルタ（§1.8.1②）がサーバー委譲される。状態=停止 を適用→ status=suspended が飛び、
// 適用中チップ「状態: 停止」が出る（絞込はサーバーが確定＝backend の enum ホワイトリスト）。
test("B-TC-138 server mode: status filter issues status= query", async ({ page }) => {
  await login(page, OPS);
  await Promise.all([page.waitForRequest(isCompaniesApi), page.goto("/admin/companies")]);
  await page.getByRole("button", { name: /絞り込み/ }).click();
  await page.getByRole("checkbox", { name: "停止" }).check();
  const [req] = await Promise.all([
    page.waitForRequest((r) => isCompaniesApi(r) && new URL(r.url()).searchParams.get("status") === "suspended"),
    page.getByRole("button", { name: "適用する" }).click(),
  ]);
  expect(new URL(req.url()).searchParams.get("status")).toBe("suspended");
  await expect(page.getByText(/状態: 停止/)).toBeVisible();
});

// B-TC-139: 行固定（ピン）のページ跨ぎ（§1.8.1④）。ACME-01 を固定→状態=停止 で絞ると母集合（data）からは
// 外れるが、pin_ids でサーバーが解決して pinned に返すため固定セクションに残り続ける（絞込非依存）。
test("B-TC-139 server mode: pinned row survives an excluding filter", async ({ page }) => {
  await login(page, OPS);
  await Promise.all([page.waitForRequest(isCompaniesApi), page.goto("/admin/companies")]);
  // ACME-01（active）を検索で出して固定する。
  await page.getByRole("searchbox").fill("ACME-01");
  const acmeRow = page.getByRole("row", { name: /ACME-01/ });
  await expect(acmeRow).toBeVisible();
  await acmeRow.getByRole("button", { name: "この行を固定" }).click();
  await expect(acmeRow).toHaveClass(/is-pinned/);
  // 検索を解除（固定は pin_ids で保持される）。
  await page.getByRole("button", { name: "検索を解除" }).click();
  // 状態=停止 で絞る（ACME-01=active は data から外れる）。リクエストに status=suspended と pin_ids が載る。
  await page.getByRole("button", { name: /絞り込み/ }).click();
  await page.getByRole("checkbox", { name: "停止" }).check();
  const [req] = await Promise.all([
    page.waitForRequest((r) => isCompaniesApi(r) && new URL(r.url()).searchParams.get("status") === "suspended"),
    page.getByRole("button", { name: "適用する" }).click(),
  ]);
  expect(new URL(req.url()).searchParams.get("pin_ids")).not.toBeNull();
  // 絞込後も ACME-01 は固定行として残る（サーバーが pin を絞込非依存で解決）。
  await expect(page.getByRole("row", { name: /ACME-01/ })).toHaveClass(/is-pinned/);
});

// B-TC-140: CSV エクスポート（§1.8.1③）。エクスポート押下→同一 EP の ?format=csv でダウンロード（companies.csv）。
// 生成/BOM/監査は backend（B-TC-131/132）。ここではフロントが正しく委譲しダウンロードが発火することを検証。
test("B-TC-140 server mode: export downloads companies.csv", async ({ page }) => {
  await login(page, OPS);
  await Promise.all([page.waitForRequest(isCompaniesApi), page.goto("/admin/companies")]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "エクスポート" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("companies.csv");
});
