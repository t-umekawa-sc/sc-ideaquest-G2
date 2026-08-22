"use client";

// SC-21 アイデア登録のフルページ本体（直アクセス/リロード時のフォールバック）。正＝mocks/SC-21_アイデア登録編集.html。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { IdeaForm } from "./IdeaForm";

export function IdeaCreatePanel({ questId }: { questId: string }) {
  const router = useRouter();
  const back = () => router.push(`/quests/${questId}`);
  return (
    <section aria-label="アイデア登録">
      <Link className="backlink" href={`/quests/${questId}`}>
        ← クエスト詳細へ戻る
      </Link>
      <h1 className="page-title">アイデアを登録</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <IdeaForm mode="create" questId={questId} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
