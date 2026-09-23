// SC-50 内容・説明の入力欄（.rt__area）は内部スクロールせず縦に伸びる（最低高さは維持）。台帳＝N §3.5（N-TC-216）。
import { expect, test } from "@playwright/test";

const CREDS = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(CREDS.company);
  await page.locator("#login_id").fill(CREDS.loginId);
  await page.locator("#password").fill(CREDS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.locator(".app-header")).toBeVisible();
}

test("N-TC-216: 内容・説明は内部スクロールせず縦に伸びる（登録ダイアログ）", async ({ page }) => {
  await login(page);
  await page.goto("/info-items/new");
  const area = page.locator(".rt__area");
  await expect(area).toBeVisible();

  // 空のときは最低高さ（min-height:140px）を保つ。
  const empty = await area.evaluate((el) => el.clientHeight);
  expect(empty).toBeGreaterThanOrEqual(140);

  // 旧 max-height(320px) を超える十分に長い内容を挿入。
  await area.evaluate((el) => {
    el.innerHTML = Array.from({ length: 60 }, (_, i) => `<p>これは内容欄が縦に伸びるかを確認する長い段落です（${i + 1} 行目）。</p>`).join("");
  });

  // 内部スクロールが出ない＝内容に応じて縦に伸びている（scrollHeight ≈ clientHeight）。
  const { scrollH, clientH } = await area.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  expect(clientH).toBeGreaterThan(320); // 320px を超えて伸びている
  expect(scrollH - clientH).toBeLessThanOrEqual(2); // 内部スクロール無し（誤差許容）
});

test("N-TC-217: 内容・説明は手動で縦幅をドラッグ変更できる（登録ダイアログ）", async ({ page }) => {
  await login(page);
  await page.goto("/info-items/new");
  const area = page.locator(".rt__area");
  await expect(area).toBeVisible();
  // resize: vertical（右下グリップで縦幅変更可）が有効。
  const resize = await area.evaluate((el) => getComputedStyle(el).resize);
  expect(resize).toBe("vertical");
});

test("N-TC-218: 手動リサイズ後も内容で伸びてスクロールが出ない（DFT-N-004）", async ({ page }) => {
  await login(page);
  await page.goto("/info-items/new");
  const area = page.locator(".rt__area");
  await expect(area).toBeVisible();

  // 手動リサイズ（拡大）を模擬＝inline height を 600px に設定（ネイティブ resize グリップのドラッグ相当）。
  await area.evaluate((el) => { (el as HTMLElement).style.height = "600px"; });
  await expect.poll(async () => area.evaluate((el) => el.clientHeight)).toBeGreaterThan(300); // 拡大が反映

  // 拡大値を超える長い内容を挿入 → fit() が内容まで伸ばし、内部スクロールが出ない。
  await area.evaluate((el) => { el.innerHTML = Array.from({ length: 80 }, (_, i) => `<p>本文の行 ${i + 1} 目です。</p>`).join(""); });
  await expect.poll(async () => area.evaluate((el) => el.clientHeight)).toBeGreaterThan(600); // 内容で更に伸びた
  const { scrollH, clientH } = await area.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  expect(scrollH - clientH).toBeLessThanOrEqual(2); // 内部スクロール無し
});

test("N-TC-219: 拡大後に縮小できる／元サイズ(140px)より下げない（DFT-N-005）", async ({ page }) => {
  await login(page);
  await page.goto("/info-items/new");
  const area = page.locator(".rt__area");
  await expect(area).toBeVisible();

  // 一度拡大（500px）。
  await area.evaluate((el) => { (el as HTMLElement).style.height = "500px"; });
  await expect.poll(async () => area.evaluate((el) => el.clientHeight)).toBeGreaterThan(300);

  // 縮小（200px）＝内容が短いので 200px まで縮む（min-height を付け替えないので縮められる＝DFT-N-005 回帰防止）。
  await area.evaluate((el) => { (el as HTMLElement).style.height = "200px"; });
  await expect.poll(async () => area.evaluate((el) => el.clientHeight)).toBeLessThan(260);

  // 元サイズ(min-height:140px)より小さくはしない＝40px 指定でも 140px 付近で下げ止まる。
  await area.evaluate((el) => { (el as HTMLElement).style.height = "40px"; });
  await expect.poll(async () => area.evaluate((el) => el.clientHeight)).toBeGreaterThanOrEqual(140);
  const clamped = await area.evaluate((el) => el.clientHeight);
  expect(clamped, `clamped=${clamped}`).toBeLessThan(200); // 140px（元サイズ）付近まで縮み、それ以下にはならない
});
