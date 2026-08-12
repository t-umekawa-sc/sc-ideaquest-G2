import { expect, test, type Page } from "@playwright/test";

// K プロフィール編集（doc/テスト/K_プロフィール.md §2・API設計 K.1/K.2）。
// ヘッダーメニュー名に依存するテスト（sc-00 の ACME-01 ユーザー）を壊さないよう、本人編集は OPS 管理者で検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

// K-TC-006: 自分のプロフィール（表示名）を編集→保存→GET /me で永続。
test("K-TC-006 edit own profile persists", async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
  await expect(page.locator("#p_name")).toBeVisible(); // GET /me が読み込めている

  const newName = `プロフ_${Date.now().toString().slice(-8)}`;
  await page.locator("#p_name").fill(newName);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("保存しました。")).toBeVisible();

  await page.reload();
  await expect(page.locator("#p_name")).toHaveValue(newName); // GET /me が更新値を返す
});

// K-TC-009: PW変更の error-path（確認不一致＝クライアント／現在PW不一致＝403 reauth_failed）。
// 共有 OPS の資格情報を壊さないため成功パスは踏まない（happy path は backend K-TC-007 が担保）。
test("K-TC-009 password change error paths (no mutation)", async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  // 確認用が不一致＝クライアント側で弾く（サーバーに送らない）
  await page.locator("#cur_pw").fill("Passw0rd!");
  await page.locator("#new_pw").fill("NewPassw0rd1");
  await page.locator("#confirm_pw").fill("Different1");
  await page.getByRole("button", { name: /パスワードを変更/ }).click();
  await expect(page.getByText("新しいパスワードと確認用が一致しません。")).toBeVisible();
  // 現在PW不一致＝403 reauth_failed（変更されない＝ログイン維持）
  await page.locator("#confirm_pw").fill("NewPassw0rd1");
  await page.locator("#cur_pw").fill("WRONGpw1");
  await page.getByRole("button", { name: /パスワードを変更/ }).click();
  await expect(page.getByText("現在のパスワードが正しくありません。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible(); // 変更なし＝画面維持
});

// K-TC-009(email): メール変更の error-path＋要求成功の文言（ダブルオプトイン・ADR-0008）。
// 要求成功（202）は OPS の email/PW を変えず pending_email を立てるだけ＝確定は踏まないので共有資格情報は壊れない。
// 確定（confirm）の happy は backend K-TC-010 が担保。
test("K-TC-009 email change request paths (double opt-in)", async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  // 現在PW不一致＝403 reauth_failed（未反映）
  await page.locator("#new_email").fill(`e2e-${Date.now()}@ops.example`);
  await page.locator("#email_cur_pw").fill("WRONGpw1");
  await page.getByRole("button", { name: "確認メールを送信" }).click();
  await expect(page.getByText("現在のパスワードが正しくありません。")).toBeVisible();
  // 正しいPW＝202＝「確認メールを送信しました」の文言（この時点では未反映＝確定は新メールのリンク）
  await page.locator("#new_email").fill(`e2e-${Date.now()}@ops.example`);
  await page.locator("#email_cur_pw").fill(OPS.password);
  await page.getByRole("button", { name: "確認メールを送信" }).click();
  await expect(page.getByText(/確認メールを .* に送信しました/)).toBeVisible();
});
