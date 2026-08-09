import { expect, test, type APIRequestContext } from "@playwright/test";

// SC-00 状態C（MFA 認証コード入力）のハッピーパス（画面配線の疎通）。
// ACME-02（mfa_required=true）で login→OTP メール→状態C 入力→ダッシュボード到達。
// backend の詳細分岐は pytest（A-TC-060〜070）が正。ここは実ブラウザで縦に通ることだけ薄く確認する。
const MFA = { company: "ACME-02", loginId: "mfa@acme2.example", password: "Passw0rd!" };
const MAILHOG = process.env.MAILHOG_URL ?? "http://mailhog:8025";

async function clearMailbox(request: APIRequestContext) {
  await request.delete(`${MAILHOG}/api/v1/messages`);
}

// 直近メールから OTP（6桁）を取り出す（本文は base64 or quoted-printable）。
async function fetchOtp(request: APIRequestContext): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILHOG}/api/v2/messages`);
    const data = await res.json();
    for (const item of data.items ?? []) {
      const raw: string = item?.Content?.Body ?? "";
      let text = raw;
      try {
        const dec = Buffer.from(raw, "base64").toString("utf-8");
        if (dec.includes("認証コード")) text = dec;
      } catch {
        /* raw のまま使う */
      }
      const m = text.match(/認証コード[:：]\s*([0-9]{6})/) ?? text.match(/\b([0-9]{6})\b/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("OTP email not received in MailHog");
}

test("SC-00 状態C: MFA会社で login→OTP→認証コード入力→ダッシュボード", async ({ page, request }) => {
  await clearMailbox(request);

  await page.goto("/login");
  await page.locator("#company_code").fill(MFA.company);
  await page.locator("#login_id").fill(MFA.loginId);
  await page.locator("#password").fill(MFA.password);
  await page.getByRole("button", { name: "ログイン" }).click();

  // 状態Cへ切替（マスク済み宛先＋コード入力欄）
  await expect(page.getByRole("heading", { name: "認証コードの入力" })).toBeVisible();
  await expect(page.locator("#otp_code")).toBeVisible();

  const otp = await fetchOtp(request);
  await page.locator("#otp_code").fill(otp);
  await page.getByRole("button", { name: "認証してログイン" }).click();

  // ダッシュボード（保護ページ）到達
  await expect(page.getByText("ようこそ")).toBeVisible();
});
