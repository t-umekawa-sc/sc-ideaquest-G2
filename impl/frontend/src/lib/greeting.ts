// 時間帯→挨拶の純ロジック（#31・E 時間/環境）。表示（名前・日付・フェード）は DashboardView／CSS 側。
// 5〜10=朝／11〜17=昼／18〜4=夜。時刻は 0..23 に正規化・NaN は正午扱い。

export function greetingFor(hour: number): string {
  const h = Number.isFinite(hour) ? (((Math.floor(hour) % 24) + 24) % 24) : 12;
  if (h >= 5 && h <= 10) return "おはようございます";
  if (h >= 11 && h <= 17) return "こんにちは";
  return "こんばんは";
}
