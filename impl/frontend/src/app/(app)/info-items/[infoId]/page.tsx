// 情報の詳細（暫定・次の実装増分で SC-52 詳細モーダル/フルページに置換）。
import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/session";

export default async function InfoDetailPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <main className="container" style={{ paddingBlock: "var(--space-6)" }}>
      <Link className="backlink" href="/info-items">← 情報インプットへ戻る</Link>
      <p className="muted" style={{ marginTop: "var(--space-4)" }}>詳細ダイアログ（SC-52）は次の実装増分で作成します。モック＝<code>doc/画面設計/mocks/SC-50_情報インプット.html</code>。</p>
    </main>
  );
}
