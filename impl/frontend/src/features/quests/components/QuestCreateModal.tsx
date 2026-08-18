"use client";

// SC-11 クエスト作成の URL 付きモーダル本体（Intercept 側から使用）。ownerName は server ページが session から渡す。
import { RouteModal } from "@/components/ui";
import { QuestForm } from "./QuestForm";

export function QuestCreateModal({ ownerName }: { ownerName: string }) {
  return (
    <RouteModal title="クエストを作成" size="lg">
      {(close) => <QuestForm ownerName={ownerName} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
