import { expect, test, type Page } from "@playwright/test";

// M-TC-015: モーダル/確認ダイアログ表示中はバックドロップ背後の CSS 無限アニメを停止する
// （デザイン標準 §モーダル／受入不具合 DFT-E-012 の回帰）。
// 再現した不具合＝半透明バックドロップ(45%)の背後で transform 系の無限アニメ（未読ベルの
// bell-wiggle など）が動き続けると、Chrome が固定バックドロップを毎フレーム再合成して
// 「チカチカ」する（DOM/スタイルは不変・20fps 録画では 60Hz 合成にエイリアスして静止に見えるが
// 実機では見える）。fix＝`body.modal-open :not(.modal)...{ animation-play-state: paused }`。
// 決定的に検証するため、アプリの未読状態に依存せず**背景に既知の無限アニメを注入**して確認する。
// 根拠＝doc/テスト/M_共通シェル・ナビ.md M-TC-015／DFT-E-012。
const OWNER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: Page) {
  // storageState（e2e/auth.setup.ts）で既に user@acme 認証済み＝再ログインせずホームへ遷移するだけ。
  // 毎テストのフォームログインを廃止し、並列フル実行でのログインレート制限超過を防ぐ。
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

test("M-TC-015 open modal pauses background CSS animations behind backdrop (DFT-E-012)", async ({ page }) => {
  await login(page);
  await page.goto("/quests");

  // 背景に既知の (1)無限アニメ と (2)backdrop-filter を持つ要素を注入
  // （bell やゲーム風パネル等の実アプリ状態に依存しない決定的プローブ）。
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent =
      "@keyframes __probe_spin { to { transform: rotate(360deg); } } .__flicker_probe { position: fixed; top: 0; left: 0; width: 8px; height: 8px; animation: __probe_spin 1s linear infinite; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }";
    document.head.appendChild(style);
    const el = document.createElement("div");
    el.className = "__flicker_probe";
    el.id = "__flicker_probe";
    document.body.appendChild(el);
  });

  // 注入直後は「モーダル無し」＝背景アニメ稼働かつ backdrop-filter 有効（陽性の前提）。
  const before = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById("__flicker_probe")!);
    return { anim: s.animationPlayState, bf: s.backdropFilter || (s as any).webkitBackdropFilter };
  });
  expect(before.anim).toBe("running");
  expect(before.bf).toContain("blur");

  // クエスト作成 URL モーダルを開く（seed 非依存の安定導線・C-TC-201 と同じ）。
  await page.getByRole("link", { name: /クエストを作成/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400); // enter アニメ後の「放置」状態へ

  // 修正の要点＝バックドロップ背後の CSS アニメは停止・backdrop-filter は無効化されていること。
  const after = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById("__flicker_probe")!);
    return { anim: s.animationPlayState, bf: s.backdropFilter || (s as any).webkitBackdropFilter };
  });
  expect(after.anim).toBe("paused");
  expect(after.bf).toBe("none");

  // ダイアログ外で running な CSS アニメが 0 件・backdrop-filter を持つ要素が 0 件
  // （＝背後の再合成／ぼかし再評価というチカつき源が無い）。
  const behind = await page.evaluate(() => {
    const running = (document as any)
      .getAnimations()
      .filter((a: Animation) => {
        const t = (a.effect as any)?.target as HTMLElement | undefined;
        return a.playState === "running" && t && !t.closest(".modal") && !t.closest(".iq-confirm");
      }).length;
    const bf = Array.from(document.querySelectorAll<HTMLElement>("*")).filter((el) => {
      if (el.closest(".modal") || el.closest(".iq-confirm")) return false;
      const s = getComputedStyle(el);
      const v = s.backdropFilter || (s as any).webkitBackdropFilter || "";
      return v && v !== "none";
    }).length;
    return { running, bf };
  });
  expect(behind.running).toBe(0);
  expect(behind.bf).toBe(0);

  // 閉じると背景アニメは再開する（凍結しっぱなしにしない）。
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const resumed = await page.evaluate(
    () => getComputedStyle(document.getElementById("__flicker_probe")!).animationPlayState,
  );
  expect(resumed).toBe("running");
});
