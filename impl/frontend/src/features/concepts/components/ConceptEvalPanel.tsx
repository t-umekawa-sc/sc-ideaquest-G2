"use client";

// SC-62 コンセプト評価のフルページ・フォールバック（直アクセス/リロード時）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ConceptEvalView } from "./ConceptEvalView";

export function ConceptEvalPanel({ conceptId }: { conceptId: string }) {
  const router = useRouter();
  const back = () => router.push(`/concepts/${conceptId}`);
  return (
    <section aria-label="コンセプト評価">
      <Link className="backlink" href={`/concepts/${conceptId}`}>← コンセプト詳細へ戻る</Link>
      <h1 className="page-title">コンセプトを評価</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <ConceptEvalView conceptId={conceptId} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
