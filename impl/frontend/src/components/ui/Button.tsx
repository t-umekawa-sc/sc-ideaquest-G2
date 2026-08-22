// 業務層ボタン（デザイン標準 §4・shared.css .btn を出力）。ゲーム層 .btn-pixel は別途。
// loading=true で処理中表現（§13）＝.btn.is-loading＋先頭に .iq-dot-spin スピナー＋自動 disabled＋aria-busy。
// フォーム送信/単一アクション（POST/PATCH/DELETE）押下中の標準（§13 使い分け）。
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "outline" | "danger" | "default";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  block?: boolean;
  loading?: boolean; // 通信処理中＝スピナー表示＋操作不可
  children?: ReactNode;
};

export function Button({ variant = "default", size = "md", block, loading = false, className, disabled, children, ...rest }: Props) {
  const classes = ["btn"];
  if (variant !== "default") classes.push(`btn-${variant}`);
  if (size === "sm") classes.push("btn-sm");
  if (block) classes.push("btn-block");
  if (loading) classes.push("is-loading");
  if (className) classes.push(className);
  return (
    <button className={classes.join(" ")} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="iq-dot-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
