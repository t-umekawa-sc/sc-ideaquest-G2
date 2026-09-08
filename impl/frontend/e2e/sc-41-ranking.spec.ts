import { expect, test, type Page } from "@playwright/test";

// SC-41 ランキング（G.5 実接続）＝会社内ランキングが実データ（getRankings）で描画される。ACME-01 で確認。
// 集計は会社全体（共有 DB）で非決定的なため、in-test で GET /rankings と照合して決定的に検証する。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §2（G-TC-206）・API設計 G.5・§7・SC-41。
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

test("G-TC-206 SC-41 ranking renders real data (me/total)", async ({ page }) => {
  await login(page);
  const rk = await page.request.get("/api/v1/rankings?period=this_week&scope=company").then((r) => r.json());
  await page.goto("/ranking");
  await expect(page.getByRole("heading", { name: "ランキング", exact: true })).toBeVisible();
  // 「あなたの順位」の総人数が実データ（デモ固定 全12人中 でない）。
  await expect(page.getByLabel("あなたの順位").getByText(`/ 全${rk.me.total_users}人中`)).toBeVisible();
  // 順位（圏外なら「圏外」）も実データ。
  const posText = rk.me.rank != null ? `${rk.me.rank}位` : "圏外";
  await expect(page.getByLabel("あなたの順位").locator(".myrank__pos")).toHaveText(posText);
  // ランキング行数が API の data 件数と一致（this_week・1ページ）。
  await expect(page.locator(".rank-list li")).toHaveCount(rk.data.length);
});

// #13 回帰ガード＝期間タブ切替で表彰台コンテナが累積しない（旧タブの .podium が消えず残るキー重複バグの再発防止）。
// 原因＝podium と rank-list が兄弟で同じ key={period} を使い、兄弟間キー重複で reconciliation が壊れて .podium が残っていた。
test("G-TC-167 SC-41 podium does not accumulate on period switch (#13)", async ({ page }) => {
  await login(page);
  await page.goto("/ranking");
  await expect(page.locator(".rank-panel.full")).toBeVisible();
  await expect(page.locator(".podium")).toHaveCount(1);
  for (const name of ["通算", "今月", "先週", "今週"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.locator(".podium")).toHaveCount(1); // 常に1つだけ（累積しない）
    await expect(page.locator(".rank-list")).toHaveCount(1);
  }
});

// #13 回帰ガード＝自分の行の登場ハイライト（rank-me-row）が暗いガラスパネル上で明色不透明背景（#EFF6FF）で終わらない
// ＝名前（明色）が潰れないこと。終了色は base .is-me の半透明シアンに揃える。is-me 行が無い期間はスキップ。
test("G-TC-168 SC-41 own row highlight is not near-white on dark panel (#13)", async ({ page }) => {
  await login(page);
  await page.goto("/ranking");
  await expect(page.locator(".rank-panel.full")).toBeVisible();
  await page.getByRole("tab", { name: "通算", exact: true }).click(); // 通算なら自分がランクインしている可能性が高い
  await expect(page.locator(".rank-panel.full")).toBeVisible();
  const meRow = page.locator(".rank-panel.full .rank-list li.is-me");
  if ((await meRow.count()) === 0) test.skip(true, "この期間は自分がランキング内に無い");
  await page.waitForTimeout(900); // rank-me-row（.7s both）の終了状態まで待つ
  const bg = await meRow.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgb(239, 246, 255)"); // #EFF6FF（--color-primary-soft）で終わらない
});

// GF-AC-133（#13 reduce）＝reduce-motion で /ranking の全演出（表彰台せり上がり rank-podium-rise・メダルきらめき
// rank-medal-shine・myrank グロー rank-myrank-in・自分の行 rank-me-row・自分のアバターのジャンプ rank-me-jump）が無効。
// @media(prefers-reduced-motion) で animation:none になる（computed animationName === "none"）。CountUp は即最終値（unit で担保）。
test.describe("reduce-motion #13", () => {
  test("G-TC-169 SC-41 ranking entrance/idle animations are disabled under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // OS reduce をエミュレート（prefers-reduced-motion: reduce）
    await login(page);
    await page.goto("/ranking");
    await expect(page.locator(".rank-panel.full")).toBeVisible();
    const animOff = async (sel: string) =>
      expect.poll(() => page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await animOff(".podium__col");        // 表彰台せり上がり
    await animOff(".podium__medal");      // メダルきらめき
    await animOff(".myrank");             // あなたの順位カードのグロー
    await animOff(".myrank .avatar");     // 自分のアバターのジャンプ
    // 自分の行/アバター（通算で自分がランクインしていれば）
    await page.getByRole("tab", { name: "通算", exact: true }).click();
    await expect(page.locator(".rank-panel.full")).toBeVisible();
    const meAvatar = page.locator(".rank-panel.full .rank-list li.is-me .avatar");
    if (await meAvatar.count()) {
      await expect.poll(() => meAvatar.first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    }
  });
});
