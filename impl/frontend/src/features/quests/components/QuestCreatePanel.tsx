"use client";

// SC-11 クエスト作成のフルページ本体（直アクセス/リロード時のフォールバック）。owner/locale は server ページが渡す。
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/forms/validation";
import { QUESTS_CHANGED_EVENT } from "../api";
import { QuestForm } from "./QuestForm";

export function QuestCreatePanel({
  ownerName,
  ownerUserId,
  locale,
}: {
  ownerName: string;
  ownerUserId: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const cancel = () => router.push("/quests");
  const done = () => {
    window.dispatchEvent(new Event(QUESTS_CHANGED_EVENT)); // 一覧へ戻ったとき最新を取り直す
    router.push("/quests");
  };
  return (
    <section aria-label="クエスト作成">
      <Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link>
      <h1 className="page-title">クエスト作成</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <QuestForm ownerName={ownerName} ownerUserId={ownerUserId} locale={locale} onDone={done} onCancel={cancel} />
      </div>
    </section>
  );
}
