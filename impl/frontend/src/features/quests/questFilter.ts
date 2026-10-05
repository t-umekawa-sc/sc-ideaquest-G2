// SC-10 クエスト一覧の絞り込みスイッチ（§6・ダッシュボードから「自分のクエスト」移設）の純ロジック。
// 自分とクエストの関係を my_state/is_owner から決定し、スイッチ選択で表示を絞る。業務計算なし（§4.1）。

export type QuestRelation = "owner" | "member" | "draft" | "pending" | "following";
// スイッチの選択肢（draft は owner に畳むので含めない・§6）。
export type QuestFilter = "all" | "owner" | "member" | "pending" | "following";

// my_state（draft/member〔一覧〕 ・ owner/pending/following/none〔カタログ〕）＋is_owner から関係を決定。
// 優先＝draft > owner > pending > following > member（draft は必ず自作・owner は is_owner か my_state=owner）。
export function questRelation(myState: string | null | undefined, isOwner: boolean): QuestRelation {
  if (myState === "draft") return "draft";
  if (isOwner || myState === "owner") return "owner";
  if (myState === "pending") return "pending";
  if (myState === "following") return "following";
  return "member";
}

// スイッチの一致判定。all=全件・owner=自作（下書き含む）・それ以外は関係一致。
export function matchQuestFilter(relation: QuestRelation, filter: QuestFilter): boolean {
  if (filter === "all") return true;
  if (filter === "owner") return relation === "owner" || relation === "draft";
  return relation === filter;
}
