"use client";

// SC-11 クエスト編集の URL 付きモーダル本体（Intercept 側から使用・論点1）。
// プリフィルは QuestForm が GET /quests/{id} で取得する。owner/locale は編集者 session（作成者表示は取得値で上書き）。
import { RouteModal } from "@/components/ui";
import type { Locale } from "@/lib/forms/validation";
import { QUESTS_CHANGED_EVENT } from "../api";
import { QuestForm } from "./QuestForm";

export function QuestEditModal({
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
  return (
    <RouteModal title="クエストを編集" size="lg">
      {(close) => (
        <QuestForm
          mode="edit"
          questId={questId}
          ownerName={ownerName}
          ownerUserId={ownerUserId}
          locale={locale}
          onCancel={close}
          onDone={() => {
            window.dispatchEvent(new Event(QUESTS_CHANGED_EVENT));
            close();
          }}
        />
      )}
    </RouteModal>
  );
}
