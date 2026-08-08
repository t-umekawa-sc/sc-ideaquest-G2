// フォーム項目（ラベル＋必須マーク＋入力＋補足/エラー・デザイン標準 §4 .field）。
import type { ReactNode } from "react";

type Props = {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
};

export function Field({ id, label, required, hint, error, children }: Props) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
