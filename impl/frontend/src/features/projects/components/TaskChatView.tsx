"use client";

// タスクチャット（フルページ・FR-43・Q.4）＝共有 IdeaChatView をタスク source で駆動＝アイデア/コンセプトと同一 UI。
// クライアントラッパ（source の関数を Server→Client へ直接渡せないため・ConceptChatView と同型）。正＝SC-71 §4.4。
import { IdeaChatView } from "@/features/chat";

import { demoTaskSource } from "../taskChatSource";

export function TaskChatView({ projectId, taskId }: { projectId: string; taskId: string }) {
  return <IdeaChatView source={demoTaskSource(projectId, taskId)} />;
}
