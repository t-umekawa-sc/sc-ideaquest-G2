// 業務層カード（クリーンな不透明面・デザイン標準 §4）。
import type { HTMLAttributes } from "react";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["card", className].filter(Boolean).join(" ")} {...rest} />;
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={["card-title", className].filter(Boolean).join(" ")} {...rest} />;
}
