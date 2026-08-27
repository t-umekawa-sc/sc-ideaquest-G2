"use client";

// SC-25 評価の URL 付きモーダル本体（Intercept 側から使用・デザイン標準の URL モーダル標準）。
// SC-22 からのソフト遷移で /ideas/[ideaId]/eval をこのモーダルに差し込む。直アクセス/リロードは
// (app)/ideas/[ideaId]/eval のフルページ（EvaluationView が onClose 無しで chrome を出す）。
import { RouteModal } from "@/components/ui";

import { EvaluationView } from "./EvaluationView";

export function EvaluationModal({ ideaId }: { ideaId: string }) {
  return (
    <RouteModal title="アイデアを評価" size="lg">
      {(close) => <EvaluationView ideaId={ideaId} onClose={close} />}
    </RouteModal>
  );
}
