// SC-01 ダッシュボード（プロトタイプ・ハブ）。画面遷移図どおり全画面へ導線を張るクリッカブル・ハブ。
// 本実装（2カラムのゲーム層ヒーロー＋週間ランキング＋各パネル）はダッシュボード群の移植で置き換える。
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardTitle } from "@/components/ui";
import { getServerSession } from "@/lib/session";

type NavItem = { href: string; code: string; title: string; desc: string };

const CORE: NavItem[] = [
  { href: "/quests", code: "SC-10", title: "クエスト一覧", desc: "参加中クエストとアイデア" },
  { href: "/notifications", code: "SC-02", title: "通知一覧", desc: "メンション・コメント等" },
];
const GAME: NavItem[] = [
  { href: "/shop", code: "SC-30", title: "ショップ", desc: "コインで装備を購入" },
  { href: "/avatar", code: "SC-31", title: "アバター / 着せ替え", desc: "3Dアバターの着せ替え" },
  { href: "/spells", code: "SC-32", title: "魔法 / スキル", desc: "SPで魔法を解放" },
  { href: "/achievements", code: "SC-40", title: "実績 / バッジ", desc: "達成した実績・バッジ" },
  { href: "/ranking", code: "SC-41", title: "ランキング", desc: "全社のXP/レベル順位" },
];

function NavGrid({ items }: { items: NavItem[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--space-4)" }}>
      {items.map((it) => (
        <Link key={it.href} href={it.href} className="card card-accent" style={{ display: "block", color: "inherit" }}>
          <div className="muted text-xs" style={{ fontWeight: 700, letterSpacing: ".04em" }}>{it.code}</div>
          <div style={{ fontWeight: 600, margin: "2px 0 4px" }}>{it.title}</div>
          <div className="muted text-sm">{it.desc}</div>
        </Link>
      ))}
    </div>
  );
}

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const admin: NavItem[] = [];
  if (session.system_role === "system_admin") {
    admin.push({ href: "/admin/companies", code: "SC-91", title: "システム管理（会社）", desc: "会社一覧・作成" });
  }
  if (session.system_role === "company_account_admin") {
    admin.push({ href: "/admin/accounts", code: "SC-93", title: "アカウント管理（自社）", desc: "自社アカウントの管理" });
  }
  if (session.is_qg_admin) {
    admin.push({ href: "/admin/quest-groups", code: "SC-90", title: "クエストグループ管理", desc: "参加追加・除外" });
  }

  return (
    <div className="stack">
      <Card>
        <CardTitle>ようこそ、{session.user.display_name} さん</CardTitle>
        <p className="muted">
          会社: {session.company_code}（ダッシュボードはプロトタイプ・ハブです。各画面はモック移植で順次実装します）
        </p>
      </Card>

      <section aria-label="コア業務">
        <h2>クエスト・通知</h2>
        <NavGrid items={CORE} />
      </section>

      <section aria-label="ゲーム">
        <h2>ゲーム</h2>
        <NavGrid items={GAME} />
      </section>

      {admin.length > 0 && (
        <section aria-label="管理">
          <h2>管理</h2>
          <NavGrid items={admin} />
        </section>
      )}
    </div>
  );
}
