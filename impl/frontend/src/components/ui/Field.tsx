// フォーム項目（ラベル＋必須マーク＋入力＋補足/エラー・デザイン標準 §4/§4.7 .field）。
// a11y＝入力↔補足/エラーを aria-describedby で結線（SR がフォーカス時に理由を読み上げ）。
// error 指定時は子入力へ aria-invalid=true を自動付与（§4b の「枠が赤」＝各画面で手付けせず一元化・§2.3 DRY）。
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

type Props = {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
};

export function Field({ id, label, required, hint, error, children }: Props) {
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = errorId ?? hintId;
  // 入力要素（単一の valid element 前提）に aria-describedby と（error 時は）aria-invalid を付与。
  // ※aria-invalid は error があるときだけ付ける＝error 無し時に子側の手付け aria-invalid を上書きしない。
  const extra: { "aria-describedby"?: string; "aria-invalid"?: boolean } = {};
  if (describedBy) {
    extra["aria-describedby"] = [
      (isValidElement(children) ? (children.props as { "aria-describedby"?: string })["aria-describedby"] : undefined),
      describedBy,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (error) extra["aria-invalid"] = true;
  const child =
    isValidElement(children) && (describedBy || error)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>, extra)
      : children;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="req">*</span>}
      </label>
      {child}
      {hint && !error && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
