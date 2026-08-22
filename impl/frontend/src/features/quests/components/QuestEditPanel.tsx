"use client";

// SC-11 クエスト編集のフルページ本体（直アクセス/リロード時のフォールバック・論点1）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/forms/validation";
import { QUESTS_CHANGED_EVENT } from "../api";
import { QuestForm } from "./QuestForm";

export function QuestEditPanel({
  questId,
  ownerName,
  ownerUserId,
  locale,
}: {
  questId: string;
  ownerName: string;
  ownerUserId: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const cancel = () => router.push("/quests");
  const done = () => {
    window.dispatchEvent(new Event(QUESTS_CHANGED_EVENT));
    router.push("/quests");
  };
  return (
    <section aria-label="クエスト編集">
      <Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link>
      <h1 className="page-title">クエスト編集</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <QuestForm mode="edit" questId={questId} ownerName={ownerName} ownerUserId={ownerUserId} locale={locale} onDone={done} onCancel={cancel} />
      </div>
    </section>
  );
}
