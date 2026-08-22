// 入力検証エラーの上部サマリ（デザイン標準 §4.7・.form-summary）。インライン（.field__error）と併用。
// role="alert" で読み上げ。**フォーカスは移動しない**（§4.7・エラー項目へ自動フォーカスしない）。
import type { ReactNode } from "react";

type Props = {
  title?: string;
  errors: string[];
  children?: ReactNode;
};

export function FormSummary({ title, errors, children }: Props) {
  if (errors.length === 0 && !children) return null;
  return (
    <div className="form-summary" role="alert">
      {title && <strong>{title}</strong>}
      {errors.length > 0 && (
        <ul>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}
