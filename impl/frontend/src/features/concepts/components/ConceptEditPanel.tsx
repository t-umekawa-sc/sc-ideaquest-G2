"use client";

// SC-60 コンセプト編集のフルページ・フォールバック（直アクセス/リロード時）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ConceptForm } from "./ConceptForm";

export function ConceptEditPanel({ conceptId }: { conceptId: string }) {
  const router = useRouter();
  const back = () => router.push(`/concepts/${conceptId}`);
  return (
    <section aria-label="コンセプト編集">
      <Link className="backlink" href={`/concepts/${conceptId}`}>← コンセプト詳細へ戻る</Link>
      <h1 className="page-title">コンセプトを編集</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <ConceptForm mode="edit" conceptId={conceptId} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
