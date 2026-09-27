"use client";

// SC-60 コンセプト登録のフルページ・フォールバック（直アクセス/リロード時）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ConceptForm } from "./ConceptForm";

export function ConceptCreatePanel({ questId }: { questId: string }) {
  const router = useRouter();
  // 作成成功は to=/concepts/{id} を受けて詳細へ。キャンセル/戻るは to 無し＝クエスト詳細へ。
  const back = (to?: string) => router.push(to ?? `/quests/${questId}`);
  return (
    <section aria-label="コンセプト登録">
      <Link className="backlink" href={`/quests/${questId}`}>← クエスト詳細へ戻る</Link>
      <h1 className="page-title">コンセプトを登録</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <ConceptForm mode="create" questId={questId} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
