"use client";

// SC-60 コンセプト登録の URL 付きモーダル本体（Intercept 側から使用）。
import { RouteModal } from "@/components/ui";

import { ConceptForm } from "./ConceptForm";

export function ConceptCreateModal({ questId }: { questId: string }) {
  return (
    <RouteModal title="コンセプトを登録" size="lg">
      {(close) => <ConceptForm mode="create" questId={questId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
