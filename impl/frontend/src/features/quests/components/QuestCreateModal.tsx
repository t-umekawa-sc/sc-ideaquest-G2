"use client";

// SC-11 クエスト作成の URL 付きモーダル本体（Intercept 側から使用）。owner/locale は server ページが session から渡す。
import { RouteModal } from "@/components/ui";
import type { Locale } from "@/lib/forms/validation";
import { QUESTS_CHANGED_EVENT } from "../api";
import { QuestForm } from "./QuestForm";

export function QuestCreateModal({
  ownerName,
  ownerUserId,
  locale,
}: {
  ownerName: string;
  ownerUserId: string | null;
  locale: Locale;
}) {
  return (
    <RouteModal title="クエストを作成" size="lg">
      {(close) => (
        <QuestForm
          ownerName={ownerName}
          ownerUserId={ownerUserId}
          locale={locale}
          onCancel={close}
          onDone={() => {
            // 一覧（別ルート）へ「作成された」ことを通知してから閉じる（跨ルート更新）。
            window.dispatchEvent(new Event(QUESTS_CHANGED_EVENT));
            close();
          }}
        />
      )}
    </RouteModal>
  );
}
