// SC-50 全文検索＝一致箇所を必ず表示（DFT-N-003）。台帳＝N §3.4（N-TC-215）。
// 全文検索は title＋本文（body_text）を対象に一致する。結果は要約だけでなく「一致箇所の抜粋」を出し、
// 要約に出ない箇所（例＝『コメ』が本文の『コメント』に一致）でもハイライトで該当箇所が見えること。
import { expect, test } from "@playwright/test";

const CREDS = { company: "ACME-01", loginId: "user@acme.example", password: "Passw0rd!" };
const KEYWORD = "ゾルタンネスビット"; // 要約（先頭抜粋）に出ないよう本文末尾にだけ置く特徴語
const TITLE = `検索ハイライトテスト ${Date.now()}`;

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(CREDS.company);
  await page.locator("#login_id").fill(CREDS.loginId);
  await page.locator("#password").fill(CREDS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.locator(".app-header")).toBeVisible();
}

async function csrf(page: import("@playwright/test").Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "iq_csrf")?.value ?? "";
}

test("N-TC-215: 全文検索結果で一致箇所のハイライトが必ず出る（本文一致・DFT-N-003）", async ({ page }) => {
  await login(page);
  // 要約に出ない語を本文末尾に持つ情報を作成（API＝長い本文を確実に投入）。
  const filler = "これは全文検索の一致抜粋を確認するためのダミー本文の説明文です。要約の先頭抜粋に特徴語を含めないよう十分に長くしてあります。検索対象はタイトルと本文で要約ではありません。";
  const body = `<p>${filler}末尾の一文にだけ特徴語${KEYWORD}が登場します。</p>`;
  const res = await page.request.post("/api/v1/info-items", {
    headers: { "X-CSRF-Token": await csrf(page), "Content-Type": "application/json" },
    data: { title: TITLE, body_html: body },
  });
  expect(res.ok()).toBeTruthy();
  const id = ((await res.json()) as { id: string }).id;

  try {
    await page.goto("/info-items");
    // 全文検索タブへ切り替え → キーワード入力。
    await page.getByText("🔍 全文検索", { exact: false }).click();
    await page.locator("input.ft-q").fill(KEYWORD);

    // ヒットカード（本テストの情報）を特定し、「一致」抜粋にハイライト（mark.keyword）が出る。
    const card = page.locator(".ft-result", { hasText: TITLE });
    await expect(card).toBeVisible();
    const mark = card.locator(".ft-result__snippet mark.keyword", { hasText: KEYWORD });
    await expect(mark.first()).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/info-items/${id}`, { headers: { "X-CSRF-Token": await csrf(page) } });
  }
});
