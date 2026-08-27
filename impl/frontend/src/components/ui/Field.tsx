// フォーム項目（ラベル＋必須マーク＋入力＋補足/エラー・デザイン標準 §4/§4.7 .field）。
// a11y＝入力↔補足/エラーを aria-describedby で結線（SR がフォーカス時に理由を読み上げ）。
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
  // 入力要素（単一の valid element 前提）に aria-describedby を付与（既存指定があれば結合）。
  const child =
    isValidElement(children) && describedBy
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby": [
            (children.props as { "aria-describedby"?: string })["aria-describedby"],
            describedBy,
          ]
            .filter(Boolean)
            .join(" "),
        })
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
