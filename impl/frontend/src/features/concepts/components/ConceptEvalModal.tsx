"use client";

// SC-62 コンセプト評価の URL 付きモーダル本体（Intercept 側から使用）。SC-61 の「評価する」からのソフト遷移で差し込む。
import { RouteModal } from "@/components/ui";

import { ConceptEvalView } from "./ConceptEvalView";

export function ConceptEvalModal({ conceptId }: { conceptId: string }) {
  return (
    <RouteModal title="コンセプトを評価" size="lg">
      {(close) => <ConceptEvalView conceptId={conceptId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
