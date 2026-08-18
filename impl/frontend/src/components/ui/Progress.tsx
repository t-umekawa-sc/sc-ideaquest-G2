// 処理中プログレス（デザイン標準 §13・mocks/shared.css より移植）。presentational（状態は呼び出し側が持つ）。
// - Spinner: コインが回るゲーム風スピナー（待機表示）
// - Progress: 確定（value 指定）/不確定（value 省略）バー。variant="xp" でゲーム風（ゴールド）
// - BlockOverlay: パネルを局所的に覆う NOW LOADING（CRTガラス）。親に position:relative（.iq-block）を付ける

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="iq-spinner">
      <span className="iq-spinner__coin">◆</span>
      {label && <span className="iq-spinner__label">{label}</span>}
    </span>
  );
}

export function Progress({
  value,
  label,
  variant,
  complete,
  doneLabel,
}: {
  value?: number; // 0..100。省略時は不確定バー
  label?: string;
  variant?: "xp"; // ゲーム風（ゴールドのグラデ＋流れる光沢）
  complete?: boolean; // 完了フラッシュ（doneLabel を表示）
  doneLabel?: string;
}) {
  const cls = ["progress", variant === "xp" ? "progress--xp" : "", value == null ? "progress--indeterminate" : "", complete ? "is-complete" : ""]
    .filter(Boolean)
    .join(" ");
  if (value == null) {
    return (
      <div className={cls}>
        <div className="progress__track" />
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cls}>
      {(label || true) && (
        <div className="progress__head">
          <span>{label}</span>
          <span className="progress__pct">{pct}%</span>
        </div>
      )}
      <div className="progress__track">
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {doneLabel && <div className="progress__done">{doneLabel}</div>}
    </div>
  );
}

export function BlockOverlay({ label = "NOW LOADING" }: { label?: string }) {
  return (
    <div className="iq-block__overlay">
      <span className="iq-loading-badge">
        {label} <span className="dots" />
      </span>
    </div>
  );
}
