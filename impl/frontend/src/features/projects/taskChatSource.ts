// タスクチャットの source（FR-43・Q.4）＝共有 IdeaChatView をホスト非依存で駆動（§5.14b・§2.1c）。
// アイデア/コンセプトと同一 UI/機能。試作＝デモデータ（接続時は chat_thread owner_type='task' の実 EP へ）。
import type { ChatListResponse, ChatMessage } from "@/features/chat/api";
import type { ChatCtx, ChatSource } from "@/features/chat/source";

import { getProject, listProjectTasks, listTaskChat } from "./api";
import type { TaskNode } from "./types";

const ME = "u-dev2"; // 現在ユーザー（試作＝GET /me）。自分の発言を右寄せ表示にするため。

function findTask(nodes: TaskNode[], id: string): TaskNode | null {
  for (const n of nodes) { if (n.id === id) return n; const c = findTask(n.children, id); if (c) return c; }
  return null;
}

export function demoTaskSource(projectId: string, taskId: string): ChatSource {
  return {
    loadCtx: async (): Promise<ChatCtx | null> => {
      const [project, tasks] = await Promise.all([getProject(projectId), listProjectTasks(projectId)]);
      if (!project) return null;
      const task = findTask(tasks, taskId);
      return {
        title: task?.title ?? "タスク",
        questTitle: project.title,
        questCategory: null,
        color: "#4f46e5",
        iconUrl: null,
        questId: project.quest?.id ?? "demo",
        completed: false,
        canComment: true,
        canPin: true,
        backHref: `/projects/${projectId}`,
      };
    },
    loadChat: async (): Promise<ChatListResponse> => {
      const msgs = await listTaskChat(taskId);
      const data: ChatMessage[] = msgs.map((m) => ({
        id: m.id,
        is_deleted: false,
        is_mine: m.author.user_id === ME,
        created_at: m.at,
        deleted_at: null,
        author: { id: m.author.user_id, name: m.author.display_name, avatar: m.author.avatar_image_url ?? null, level: null },
        body: m.body,
        is_edited: false,
        is_pinned: false,
        quotes: [],
        attachments: [],
        mentions: [],
        reactions: {},
      }));
      return {
        chat_group_id: null,
        thread_id: `task-${taskId}`,
        data,
        page_info: { next_cursor: null, has_next: false },
        unread: { first_unread_message_id: null, unread_count: 0 },
      };
    },
    post: async () => null, // 試作＝送信は未接続（接続時に thread 単位 EP へ）
    markRead: async () => undefined,
  };
}
