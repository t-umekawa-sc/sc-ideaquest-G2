// 投票可否の事前判定（D.5・SC-22）。サーバー `_guard_votable` と一致させる:
//  - クエスト completed＝投票不可（凍結・フォロー新規も不可＝別判定）
//  - 締切翌日以降＝投票不可（サーバー: quest.deadline < date.today() で 409。締切当日は可）
// 事前無効化は UX（理由提示）であり、最終権威はサーバー 409（タイムゾーン境界の差はサーバーが吸収）。
// deadline は "YYYY-MM-DD"（date）。同フォーマットの辞書順比較＝日付順比較。

export type VoteCloseReason = "completed" | "deadline" | null;

export function isVotingClosed(
  quest: { status: string; deadline?: string | null },
  todayISO: string, // ローカル日 "YYYY-MM-DD"
): { closed: boolean; reason: VoteCloseReason } {
  if (quest.status === "completed") return { closed: true, reason: "completed" };
  if (quest.deadline && quest.deadline < todayISO) return { closed: true, reason: "deadline" };
  return { closed: false, reason: null };
}

// ローカル日を "YYYY-MM-DD" で得る（sv-SE ロケールは ISO 日付形式）。
export function todayISODate(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE");
}
