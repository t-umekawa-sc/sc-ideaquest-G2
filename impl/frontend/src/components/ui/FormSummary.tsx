// 入力検証エラーの上部サマリ（デザイン標準 §4.7・.form-summary）。インライン（.field__error）と併用。
// role="alert" で読み上げ。**フォーカスは移動しない**（§4.7・エラー項目へ自動フォーカスしない）。
// innerRef＝送信失敗時にこの要素へスクロール（フォーカスは奪わない）するための参照（useFormErrorNotice）。
import type { ReactNode, Ref } from "react";

type Props = {
  title?: string;
  errors: string[];
  children?: ReactNode;
  innerRef?: Ref<HTMLDivElement>;
};

export function FormSummary({ title, errors, children, innerRef }: Props) {
  if (errors.length === 0 && !children) return null;
  return (
    <div className="form-summary" role="alert" ref={innerRef} tabIndex={-1}>
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
