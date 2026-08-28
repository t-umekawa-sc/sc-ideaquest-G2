// 締切の切迫度（#24 ゲーム感・横断）。クエスト締切（"YYYY-MM-DD"）と当日から段階を決める純ロジック。
// 表示（バッジ色/脈動・SC-01/10/11/12 の ⏳ 締切）は各画面／design-system.css 側。

export type DeadlineLevel = "none" | "safe" | "soon" | "urgent" | "over";

/** ローカル日 "YYYY-MM-DD"（sv-SE ロケール＝ISO 日付形式）。 */
export function todayISO(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE");
}

/**
 * 締切→切迫度と残日数。締切なし/不正は none。過去は over（days<0）／当日〜2日=urgent／3〜7日=soon／8日以上=safe。
 * 比較は UTC 深夜固定でズレを排除（同フォーマットの差分＝暦日数）。
 */
export function deadlineUrgency(
  deadlineISO: string | null | undefined,
  today: string,
): { level: DeadlineLevel; days: number | null } {
  if (!deadlineISO) return { level: "none", days: null };
  const dl = Date.parse(`${deadlineISO}T00:00:00Z`);
  const td = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(dl) || Number.isNaN(td)) return { level: "none", days: null };
  const days = Math.round((dl - td) / 86400000);
  if (days < 0) return { level: "over", days };
  if (days <= 2) return { level: "urgent", days };
  if (days <= 7) return { level: "soon", days };
  return { level: "safe", days };
}

/** 残日数→短い表示。null=""／負=締切超過／0=今日締切／正=残りN日。 */
export function deadlineCountdown(days: number | null): string {
  if (days == null) return "";
  if (days < 0) return "締切超過";
  if (days === 0) return "今日締切";
  return `残り${days}日`;
}
