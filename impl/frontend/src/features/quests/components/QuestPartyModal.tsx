"use client";

// SC-12「パーティー・権限を編集」の URL 付きモーダル本体（Intercept 側から使用）。
// 参加メンバー＋権限だけを編集し C.3 PUT /party で保存（内容フィールドは出さない＝QuestForm partyOnly）。
// プリフィルは QuestForm が GET /quests/{id} で取得。onDone で QUESTS_CHANGED_EVENT＝詳細/一覧が再取得。
import { RouteModal } from "@/components/ui";
import type { Locale } from "@/lib/forms/validation";
import { QUESTS_CHANGED_EVENT } from "../api";
import { QuestForm } from "./QuestForm";

export function QuestPartyModal({
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
    <RouteModal title="パーティー・権限を編集" size="xl">
      {(close) => (
        <QuestForm
          mode="edit"
          partyOnly
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
