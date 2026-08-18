"use client";

// SC-11 クエスト作成のフルページ本体（直アクセス/リロード時のフォールバック）。ownerName は server ページが渡す。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { QuestForm } from "./QuestForm";

export function QuestCreatePanel({ ownerName }: { ownerName: string }) {
  const router = useRouter();
  const back = () => router.push("/quests");
  return (
    <section aria-label="クエスト作成">
      <Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link>
      <h1 className="page-title">クエスト作成</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <QuestForm ownerName={ownerName} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
