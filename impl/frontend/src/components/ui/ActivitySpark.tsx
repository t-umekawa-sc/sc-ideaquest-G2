// 活発度スパーク（共有）＝日次件数の棒グラフ。SC-22 アイデア詳細（議論の活発度）と SC-13 発見カタログ（クエスト横断活動）で共有。
// データ形状はドメイン非依存＝{ date, count }[]。任意 markers（◆＝更新日など）・末尾 recentCount 本を強調。CSS は styles/components.css（globals 経由で全ルート有効）。
import { useMemo } from "react";

export type ActivityDaily = { date: string; count: number };

export function ActivitySpark({
  daily,
  markers = [],
  label = "議論の活発度",
  recentCount = 3,
  legend,
  emptyText,
}: {
  daily: ActivityDaily[];
  markers?: string[];
  label?: string;
  recentCount?: number;
  legend?: string;
  emptyText?: string;
}) {
  const markerSet = useMemo(() => new Set(markers), [markers]);
  const bars = useMemo(() => {
    const max = Math.max(1, ...daily.map((d) => d.count));
    return daily.map((d, i) => ({
      date: d.date,
      h: Math.round((d.count / max) * 100),
      update: markerSet.has(d.date),
      recent: i >= daily.length - recentCount,
    }));
  }, [daily, markerSet, recentCount]);

  if (bars.length === 0) {
    // 空データ＝emptyText 指定時のみ枠を出す（未指定は何も描かない＝SC-22 の従来挙動を保持）。
    return emptyText ? (
      <div className="activity" aria-label={label}>
        <div className="activity__head"><span className="activity__label">{label}</span></div>
        <p className="muted text-xs" style={{ margin: 0 }}>{emptyText}</p>
      </div>
    ) : null;
  }

  return (
    <div className="activity" aria-label={label}>
      <div className="activity__head">
        <span className="activity__label">{label}</span>
      </div>
      <div className="spark" role="img" aria-label={`直近${bars.length}日の日次件数の棒グラフ`}>
        {bars.map((b, i) => (
          <span
            key={i}
            className={["spark__bar", b.update ? "has-update" : "", b.recent ? "is-recent" : ""].filter(Boolean).join(" ")}
            style={{ height: `${Math.max(6, b.h)}%` }}
            title={b.update ? `${b.date}（更新）` : b.date}
          />
        ))}
      </div>
      {legend ? <div className="activity__legend">{legend}</div> : null}
    </div>
  );
}
