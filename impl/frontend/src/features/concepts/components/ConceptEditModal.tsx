"use client";

// SC-60 コンセプト編集の URL 付きモーダル本体（Intercept 側から使用）。
import { RouteModal } from "@/components/ui";

import { ConceptForm } from "./ConceptForm";

export function ConceptEditModal({ conceptId }: { conceptId: string }) {
  return (
    <RouteModal title="コンセプトを編集" size="lg">
      {(close) => <ConceptForm mode="edit" conceptId={conceptId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
