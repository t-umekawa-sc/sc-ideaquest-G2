"use client";

// SC-12「パーティー・権限を編集」のフルページ本体（直アクセス/リロード時のフォールバック）。
// 一覧/詳細からのソフト遷移では @modal/(.)quests/[questId]/party のモーダルが差し込まれる（Intercept Routes）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/forms/validation";
import { QUESTS_CHANGED_EVENT } from "../api";
import { QuestForm } from "./QuestForm";

export function QuestPartyPanel({
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
  const back = `/quests/${questId}`;
  const cancel = () => router.push(back);
  const done = () => {
    window.dispatchEvent(new Event(QUESTS_CHANGED_EVENT));
    router.push(back);
  };
  return (
    <section aria-label="パーティー・権限を編集">
      <Link className="backlink" href={back}>← クエスト詳細へ戻る</Link>
      <h1 className="page-title">パーティー・権限を編集</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 960, margin: "var(--space-4) auto 0" }}>
        <QuestForm mode="edit" partyOnly questId={questId} ownerName={ownerName} ownerUserId={ownerUserId} locale={locale} onDone={done} onCancel={cancel} />
      </div>
    </section>
  );
}
