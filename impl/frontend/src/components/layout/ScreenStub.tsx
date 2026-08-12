// 画面モック移植前のプロトタイプ・スタブ（フロントエンド実装フロー規約＝画面モック先行）。
// 画面の存在とタイトル・SC-ID・画面遷移図どおりの導線（links）だけを示す。実体は各画面群の移植で置き換える。
import Link from "next/link";

import { Card, CardTitle } from "@/components/ui";

type NavLink = { href: string; label: string };

export function ScreenStub({
  code,
  title,
  description,
  links,
}: {
  code: string;
  title: string;
  description?: string;
  links?: NavLink[];
}) {
  return (
    <Card>
      <div className="muted text-xs" style={{ fontWeight: 700, letterSpacing: ".04em" }}>{code}</div>
      <CardTitle>{title}</CardTitle>
      <p className="muted">{description ?? "この画面はモック移植予定です（プロトタイプ・スタブ）。"}</p>
      {links && links.length > 0 && (
        <nav aria-label="この画面からの導線" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="btn btn-outline btn-sm">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </Card>
  );
}
