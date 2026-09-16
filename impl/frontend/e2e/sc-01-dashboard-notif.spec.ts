import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// I-TC-144 SC-01 ダッシュボード「最近の通知」に「既読にする」ボタン（ユーザー要望）。
// 未読通知を会社DBへ直接 insert して決定的に用意し、ボタンで参照先を開かず既読化できることを検証する。
// 根拠＝doc/テスト/I_ダッシュボード.md I-TC-144・SC-01 §4.8b／通知結線は H（H-TC-208/209/210）。
const OWNER = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
const IMPL_DIR = path.resolve(__dirname, "..", ".."); // e2e → frontend → impl

function psql(sql: string) {
  execSync(`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c ${JSON.stringify(sql)}`, {
    cwd: IMPL_DIR,
    stdio: "pipe",
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OWNER.company);
  await page.locator("#login_id").fill(OWNER.loginId);
  await page.locator("#password").fill(OWNER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
  await expect(page.locator(".app-header")).toBeVisible();
}

test("I-TC-144 dashboard recent notification has a mark-read button that marks read without navigating", async ({ page }) => {
  const id = randomUUID();
  const stamp = `ダッシュ通知${Date.now().toString().slice(-8)}`; // 本文に載る一意な actor 名で当該通知を特定
  // 未読の mention 通知を owner 宛に直挿入（created_at=now で「最近の通知」最上部に載る・業務通知＝game_mode 非依存）。
  psql(
    `INSERT INTO notifications (id, recipient_id, type, params, is_read, created_at) VALUES ` +
      `('${id}', (SELECT id FROM users WHERE login_id='${OWNER.loginId}'), 'mention', '{"actor_name":"${stamp}"}'::jsonb, false, now());`,
  );
  try {
    await login(page);
    await page.goto("/");

    // 「最近の通知」に当該通知が未読で出る（本文に一意 stamp）。
    const li = page.locator(".notif-list li").filter({ hasText: stamp });
    await expect(li).toHaveClass(/unread/);

    // 未読には「既読にする」ボタンがある（ユーザー要望の本体）。件名（.notif-head）の横に配置される。
    const readBtn = li.getByRole("button", { name: "既読にする" });
    await expect(readBtn).toBeVisible();
    await expect(li.locator(".notif-head .notif-read")).toHaveCount(1); // 件名行の横（メッセージ本文の上）

    // 件名はビジネスフォント＝ドット絵フォント（DotGothic16）でない・サイズは業務パネル準拠（過大でない）。
    // 旧＝SC-02 の未スコープ `.notif-title`（font-pixel/text-2xl）と名前衝突してドット絵24pxになっていた（クラス名分離で解消）。
    const font = await li.locator(".notif-subject").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { family: cs.fontFamily, size: parseFloat(cs.fontSize) };
    });
    expect(font.family).not.toMatch(/DotGothic16/i);
    expect(font.size).toBeLessThanOrEqual(16); // 業務パネル本文相当（≒14px）

    // クリック＝参照先を開かず（URL はダッシュボードのまま）既読化。
    await readBtn.click();
    await expect(page).toHaveURL(/\/$|\/dashboard/); // 遷移していない
    await expect(li).not.toHaveClass(/unread/); // 楽観更新で既読
    await expect(li.getByRole("button", { name: "既読にする" })).toHaveCount(0); // ボタンは未読時のみ

    // サーバー権威＝当該通知が既読（実結線の証跡・楽観だけでない）。
    const api = await page.request.get("/api/v1/notifications?limit=50").then((r) => r.json());
    const row = (api.data as Array<{ id: string; is_read: boolean }>).find((n) => n.id === id);
    expect(row?.is_read).toBe(true);
  } finally {
    psql(`DELETE FROM notifications WHERE id='${id}';`);
  }
});

// I-TC-155 SC-01 ダッシュボード「最近の通知」に通知日時（相対ラベル）を表示（ユーザー要望）。
// created_at=now の未読通知を直挿入し、当該行に `.notif-time` の相対ラベル（たった今/○分前/○時間前）が出ることを確認。
// 根拠＝doc/テスト/I_ダッシュボード.md I-TC-155・SC-01／相対ラベルの純ロジックは I-TC-156（time.test.ts）。
test("I-TC-155 dashboard recent notification shows a relative timestamp", async ({ page }) => {
  const id = randomUUID();
  const stamp = `日時付き通知${Date.now().toString().slice(-8)}`;
  psql(
    `INSERT INTO notifications (id, recipient_id, type, params, is_read, created_at) VALUES ` +
      `('${id}', (SELECT id FROM users WHERE login_id='${OWNER.loginId}'), 'mention', '{"actor_name":"${stamp}"}'::jsonb, false, now());`,
  );
  try {
    await login(page);
    await page.goto("/");
    const li = page.locator(".notif-list li").filter({ hasText: stamp });
    await expect(li).toHaveClass(/unread/);
    // 件名の横（.notif-head 内）に通知日時＝相対ラベルが出る。
    const time = li.locator(".notif-time");
    await expect(time).toHaveCount(1);
    await expect(time).toHaveText(/たった今|分前|時間前/); // now 挿入なので直近ラベル
  } finally {
    psql(`DELETE FROM notifications WHERE id='${id}';`);
  }
});
