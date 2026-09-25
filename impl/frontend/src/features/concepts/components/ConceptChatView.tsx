"use client";

// コンセプト議論チャット（フルページ・FR-42・P.6）＝スコープ（総合/グループ/前提スレッド）単位。
// アイデアチャットと**完全同一（フル機能パリティ）**＝共有コンポーネント IdeaChatView を concept-scope source で駆動
// （reactions/魔法/メンション/引用/ピン/添付/未読/リアルタイムまで同一）。正＝doc/画面設計/screens/SC-61 §4.3-4.8・§5.45。
import { IdeaChatView } from "@/features/chat";
import { conceptScopeSource } from "@/features/chat/source";

export function ConceptChatView({ conceptId, scopeId }: { conceptId: string; scopeId: string }) {
  return <IdeaChatView source={conceptScopeSource(conceptId, scopeId)} />;
}
