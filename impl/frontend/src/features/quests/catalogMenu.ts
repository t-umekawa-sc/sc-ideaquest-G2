// SC-13 発見カタログの行アクション（⋮メニュー）の選定＝状態（my_state）＋管理者フラグから純粋に決める。
// コンポーネントから分離して単体テスト可能にする（DFT 再発防止＝member/owner でも管理者おすすめトグルを出す）。
// 正＝API設計 C.9.1（PUT /quests/{id}/recommended は company_account_admin・発見可能クエストに限る）。

export type CatalogMenuKey = "detail" | "goto" | "follow" | "unfollow" | "withdraw" | "request" | "recommend";

// 管理者お勧めトグル（recommend）は my_state に関わらず常に出す（カタログに載る＝発見可能＝候補母集団なので、
// member/owner〔参加中〕や following でも設定/解除できる＝backend can_discover_quest も member を除外しない）。
export function catalogRowMenuKeys(r: { my_state: string }, isAdmin: boolean): CatalogMenuKey[] {
  const keys: CatalogMenuKey[] = ["detail"];
  if (r.my_state === "member") {
    keys.push("goto");
  } else {
    keys.push(r.my_state === "following" ? "unfollow" : "follow");
    if (r.my_state === "pending") keys.push("withdraw");
    else if (r.my_state !== "rejected") keys.push("request");
  }
  if (isAdmin) keys.push("recommend");
  return keys;
}
