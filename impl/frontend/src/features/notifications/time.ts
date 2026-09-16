// 通知の相対時刻ラベル／グルーピング（SC-02 一覧・SC-01 ダッシュボードで共有・DRY）。
// now を引数化してテスト可能にする（既定＝現在時刻）。
export type NotifGroup = "today" | "yesterday" | "earlier";

export function groupOf(iso: string, now: Date = new Date()): NotifGroup {
  const d = new Date(iso);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startToday.getDate() - 1);
  if (d >= startToday) return "today";
  if (d >= startYesterday) return "yesterday";
  return "earlier";
}

// 相対ラベル＝たった今 / n分前 / n時間前（今日）／昨日 hh:mm ／ それ以前は M/D。
export function timeLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400 && groupOf(iso, now) === "today") return `${Math.floor(diff / 3600)}時間前`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (groupOf(iso, now) === "yesterday") return `昨日 ${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
