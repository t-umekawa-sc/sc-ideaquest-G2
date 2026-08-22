"use client";

// SC-21 アイデア登録の URL 付きモーダル本体（Intercept 側から使用）。正＝mocks/SC-21_アイデア登録編集.html。
import { RouteModal } from "@/components/ui";

import { IdeaForm } from "./IdeaForm";

export function IdeaCreateModal({ questId }: { questId: string }) {
  return (
    <RouteModal title="アイデアを登録" size="lg">
      {(close) => <IdeaForm mode="create" questId={questId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
