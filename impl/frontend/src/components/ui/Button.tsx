// 業務層ボタン（デザイン標準 §4・shared.css .btn を出力）。ゲーム層 .btn-pixel は別途。
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "danger" | "default";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  block?: boolean;
};

export function Button({ variant = "default", size = "md", block, className, ...rest }: Props) {
  const classes = ["btn"];
  if (variant !== "default") classes.push(`btn-${variant}`);
  if (size === "sm") classes.push("btn-sm");
  if (block) classes.push("btn-block");
  if (className) classes.push(className);
  return <button className={classes.join(" ")} {...rest} />;
}
