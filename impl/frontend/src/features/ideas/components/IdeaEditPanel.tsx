"use client";

// SC-21 アイデア編集のフルページ・フォールバック（/ideas/[ideaId]/edit 直アクセス/リロード時）。
// 下書きカード等からのソフト遷移では @modal/(.)ideas/[ideaId]/edit のモーダルが差し込まれる（Intercept Routes）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/forms/validation";

import { IDEAS_CHANGED_EVENT } from "../api";
import { IdeaForm } from "./IdeaForm";

export function IdeaEditPanel({ ideaId, locale = "ja" }: { ideaId: string; locale?: Locale }) {
  const router = useRouter();
  const back = () => router.push(`/ideas/${ideaId}`);
  return (
    <main className="container" style={{ paddingBlock: "var(--space-6)" }}>
      <Link className="backlink backlink--float" href={`/ideas/${ideaId}`}>← アイデア詳細へ戻る</Link>
      <h1 style={{ marginBottom: "var(--space-4)" }}>アイデアを編集</h1>
      <IdeaForm
        mode="edit"
        ideaId={ideaId}
        locale={locale}
        onCancel={back}
        onDone={() => {
          window.dispatchEvent(new Event(IDEAS_CHANGED_EVENT));
          back();
        }}
      />
    </main>
  );
}
