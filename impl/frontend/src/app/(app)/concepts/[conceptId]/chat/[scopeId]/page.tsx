// SC-61 議論チャット（フルページ・P.6）＝コンセプトのスコープ（総合/グループ/前提）別チャット。
import { redirect } from "next/navigation";

import { ConceptChatView } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptChatFullPage({ params }: { params: Promise<{ conceptId: string; scopeId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { conceptId, scopeId } = await params;
  return <ConceptChatView conceptId={conceptId} scopeId={scopeId} />;
}
