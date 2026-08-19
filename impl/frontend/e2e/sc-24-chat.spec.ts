import { expect, test, type Page } from "@playwright/test";

// SC-24 アイデアチャット＝送信・引用リンクの回帰 e2e（デモ fixtures・チャット backend 未接続）。
// 根拠＝doc/画面設計/screens/SC-24_アイデアチャット.md・mocks/SC-24_アイデアチャット.html／フロントエンド実装フロー規約 §3・§8。
// 担保範囲＝送信＝スレッドへ自分の投稿が追記される（（あなた）表示）／引用返信＝引用文が引用元への
// アンカーリンク（href="#<msgid>"）になり、クリックで引用元に msg--flash ハイライトが付く（handoff §3-1）。
// 送信/引用はクライアント state のみ（backend 非依存）のため red-green §5.1 は接続時に適用。OPS でログインして検証。
const OPS = { company: "OPS", loginId: "admin@ops.example", password: "Passw0rd!" };

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#company_code").fill(OPS.company);
  await page.locator("#login_id").fill(OPS.loginId);
  await page.locator("#password").fill(OPS.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ようこそ")).toBeVisible();
}

async function gotoChat(page: Page) {
  await login(page);
  await page.goto("/ideas/i1/chat"); // ideaId はデモ fixtures では未使用（任意値）
  await expect(page.getByText("💬 夜間配送の集約による積載率改善")).toBeVisible();
  await expect(page.locator(".chat-thread .msg")).toHaveCount(5); // 初期メッセージ 5件
}

// 送信＝コンポーザーに入力→送信で自分の投稿が末尾に追記される。
test("sending a message appends my post to the thread", async ({ page }) => {
  await gotoChat(page);

  await page.locator(".composer__box").fill("テスト投稿です");
  const send = page.getByRole("button", { name: "送信", exact: true });
  await expect(send).toBeEnabled(); // 入力ありで送信可
  await send.click();

  await expect(page.locator(".chat-thread .msg")).toHaveCount(6);
  const last = page.locator(".chat-thread .msg").last();
  await expect(last.locator(".msg__text")).toHaveText("テスト投稿です");
  await expect(last.locator(".msg__me")).toHaveText("（あなた）"); // 自分の投稿
});

// 引用返信＝引用元（m2）を引用して送信→引用文が #m2 アンカー、クリックで m2 に msg--flash。
test("quoting links to source message and flashes it on click", async ({ page }) => {
  await gotoChat(page);

  const m2 = page.locator("#m2"); // 鈴木 花子の投稿
  await m2.hover(); // ホバーアクション（display:none→表示）を出す
  await m2.getByRole("button", { name: "引用返信" }).click();

  await page.locator(".composer__box").fill("引用して返信します");
  await page.getByRole("button", { name: "送信", exact: true }).click();

  const quote = page.locator(".chat-thread .msg").last().locator(".msg__quote");
  await expect(quote).toHaveAttribute("href", "#m2"); // 引用元へのアンカー

  await quote.click();
  await expect(page.locator("#m2")).toHaveClass(/msg--flash/); // 引用元がハイライト
});
