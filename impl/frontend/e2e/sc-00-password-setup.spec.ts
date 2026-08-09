import { expect, test, type APIRequestContext } from "@playwright/test";

// SC-00 状態D→メール→状態B のハッピーパス（画面配線の疎通）。
// backend の詳細分岐は pytest（A-TC-030〜051）が正。ここは実ブラウザで縦に通ることだけ薄く確認する。
//
// 注意: complete の new_password は seed と同一（Passw0rd!）にする。こうすると全セッション破棄と
// トークン消費は起きるが、他テストが使うログイン資格情報（Passw0rd!）は保たれる（共有状態を壊さない）。
const SEED = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
// e2e は frontend コンテナ内で実行＝MailHog はサービス名で解決。ホスト実行時は env で上書き。
const MAILHOG = process.env.MAILHOG_URL ?? "http://mailhog:8025";

async function clearMailbox(request: APIRequestContext) {
  await request.delete(`${MAILHOG}/api/v1/messages`);
}

// 直近メールから password-setup のリンクトークンを取り出す（本文は base64＝handoff §5）。
async function fetchResetToken(request: APIRequestContext): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILHOG}/api/v2/messages`);
    const data = await res.json();
    for (const item of data.items ?? []) {
      const raw: string = item?.Content?.Body ?? "";
      const decoded = Buffer.from(raw, "base64").toString("utf-8");
      const m =
        decoded.match(/password-setup\?token=([A-Za-z0-9_\-]+)/) ??
        raw.match(/password-setup\?token=([A-Za-z0-9_\-]+)/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("reset link email not received in MailHog");
}

test("SC-00 状態D→メール→状態B: 再設定リクエスト〜新PW設定〜ログイン画面", async ({ page, request }) => {
  await clearMailbox(request);

  // 状態A → 「パスワードをお忘れですか？」→ 状態D
  await page.goto("/login");
  await page.getByRole("link", { name: "パスワードをお忘れですか？" }).click();
  await expect(page).toHaveURL(/\/password-reset$/);

  // 状態D: 会社コード＋ログインID → 送信 → 常に同一の確認メッセージ
  await page.locator("#company_code").fill(SEED.company);
  await page.locator("#login_id").fill(SEED.loginId);
  await page.getByRole("button", { name: "再設定リンクを送信" }).click();
  await expect(page.getByText("該当するアカウントがあれば")).toBeVisible();

  // メール受信 → リンクのトークン取得 → 状態B を開く
  const token = await fetchResetToken(request);
  await page.goto(`/password-setup?token=${token}`);

  // verify 成功で設定フォームが出る
  await expect(page.locator("#new_password")).toBeVisible();

  // 新PW設定（seed と同じ値＝共有資格情報を保つ）→ complete → 完了表示
  await page.locator("#new_password").fill(SEED.password);
  await page.locator("#confirm_password").fill(SEED.password);
  await page.getByRole("button", { name: "パスワードを設定してはじめる" }).click();
  await expect(page.getByText("パスワードを設定しました")).toBeVisible();

  // ログイン画面へ戻れる
  await page.getByRole("link", { name: "ログインへ" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#company_code")).toBeVisible();
});
