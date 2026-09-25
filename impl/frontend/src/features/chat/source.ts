// チャットの source 抽象（§5.45・フル機能パリティ）＝チャット中核ビュー（ChatView/IdeaChatView）を
// ホスト非依存で駆動する。アイデア（idea）とコンセプト議論スコープ（concept-scope）で同一 UI/機能を共有。
// 正＝doc/API設計/E_チャット…・P_コンセプト.md P.6。業務計算はしない（§4.1）。
import { getConcept } from "@/features/concepts/api";
import { getIdea } from "@/features/ideas/api";
import { getQuest } from "@/features/quests/api";

import {
  getChat,
  getScopeChat,
  markRead,
  markScopeRead,
  postMessage,
  postScopeMessage,
  type ChatListResponse,
  type ChatMessage,
} from "./api";

const SCOPE_KIND_LABEL: Record<string, string> = { overall: "総合ルーム", group: "グループ", assumption: "前提スレッド" };

// チャット画面の共通コンテキスト（ホストの差を吸収した表示・権限・遷移の正規化）。
export type ChatCtx = {
  title: string;          // 見出し（アイデア名／コンセプト名・スコープ名）
  questTitle: string;     // クエスト名（サブ見出し）
  questCategory?: string | null;
  color: string;          // アイコン色（クエスト色）
  iconUrl?: string | null;
  questId: string;        // @メンション候補の取得に使う
  completed: boolean;     // クエスト完了＝投稿凍結（UI 事前無効化）
  canComment: boolean;    // コメント権限（投稿可否の素）
  canPin: boolean;        // owner/quest_admin（ピン留め）
  backHref: string;       // 「戻る」先
};

export type ChatPostInput = { body?: string; quotedMessageIds?: string[]; mentions?: string[]; files?: File[] };

export type ChatSource = {
  loadCtx: () => Promise<ChatCtx | null>;
  loadChat: (params?: { limit?: number; before?: string; after?: string }) => Promise<ChatListResponse | null>;
  post: (input: ChatPostInput) => Promise<ChatMessage | null>;
  markRead: (lastReadMessageId: string) => Promise<unknown>;
};

// アイデアチャット source（SC-24）。
export function ideaSource(ideaId: string): ChatSource {
  return {
    loadCtx: async () => {
      const d = await getIdea(ideaId);
      if (!d) return null;
      return {
        title: d.title,
        questTitle: d.quest.title,
        questCategory: d.quest.categories?.[0] ?? null,
        color: d.quest.color ?? "#3B82F6",
        iconUrl: d.icon_image_url,
        questId: d.quest.id,
        completed: d.quest?.status === "completed",
        canComment: d.my_permissions?.includes("comment") ?? false,
        canPin: (d.my_permissions?.includes("owner") || d.my_permissions?.includes("quest_admin")) ?? false,
        backHref: `/ideas/${ideaId}`,
      };
    },
    loadChat: (params) => getChat(ideaId, params),
    post: (input) => postMessage(ideaId, input),
    markRead: (lastReadMessageId) => markRead(ideaId, lastReadMessageId),
  };
}

// コンセプト議論スコープ source（SC-61・総合/グループ/前提スレッド）。アイデアと同一中核を再利用。
export function conceptScopeSource(conceptId: string, scopeId: string): ChatSource {
  return {
    loadCtx: async () => {
      const c = await getConcept(conceptId);
      if (!c) return null;
      const q = await getQuest(c.quest_id).catch(() => null);
      const scope = c.chat_scopes?.find((s) => s.scope_id === scopeId);
      const scopeName = scope ? (scope.label || SCOPE_KIND_LABEL[scope.kind] || "議論") : "議論";
      return {
        title: `${c.title} ・ ${scopeName}`,
        questTitle: q?.title ?? "",
        questCategory: null,
        color: q?.color ?? "#3B82F6",
        iconUrl: null,
        questId: c.quest_id,
        completed: q?.status === "completed",
        canComment: c.my_permissions?.includes("comment") ?? false,
        canPin: (c.my_permissions?.includes("owner") || c.my_permissions?.includes("quest_admin")) ?? false,
        backHref: `/concepts/${conceptId}`,
      };
    },
    loadChat: (params) => getScopeChat(scopeId, params),
    post: (input) => postScopeMessage(scopeId, input),
    markRead: (lastReadMessageId) => markScopeRead(scopeId, lastReadMessageId),
  };
}
