// タスクチャットの source（FR-43・Q.4）＝共有 IdeaChatView をホスト非依存で駆動（§5.14b・§2.1c）。
// アイデア/コンセプトと同一 UI/機能。実 API（/tasks/{id}/chat 系＝chat_thread owner_type='task'）へ結線。
import { getTaskChat, markTaskRead, postTaskMessage } from "@/features/chat/api";
import type { ChatCtx, ChatSource } from "@/features/chat/source";

import { getProject, listProjectTasks } from "./api";
import type { TaskNode } from "./types";

function findTask(nodes: TaskNode[], id: string): TaskNode | null {
  for (const n of nodes) { if (n.id === id) return n; const c = findTask(n.children ?? [], id); if (c) return c; }
  return null;
}

export function taskChatSource(projectId: string, taskId: string): ChatSource {
  return {
    loadCtx: async (): Promise<ChatCtx | null> => {
      const [project, tasks] = await Promise.all([getProject(projectId), listProjectTasks(projectId)]);
      if (!project) return null;
      const task = findTask(tasks, taskId);
      const canManage = project.my_permissions?.can_manage_tasks ?? false;
      return {
        title: task?.title ?? "タスク",
        questTitle: project.title,
        questCategory: null,
        color: "#4f46e5",
        iconUrl: null,
        questId: project.quest?.id ?? "",
        completed: false, // 実行段はクエスト完了で凍結しない（Q.0）
        canComment: true, // アクセス可＝コメント可（二層メンバーシップ・backend 側で最終判定）
        canPin: canManage,
        backHref: `/projects/${projectId}`,
      };
    },
    loadChat: (params) => getTaskChat(taskId, params),
    post: (input) => postTaskMessage(taskId, input),
    markRead: (lastReadMessageId) => markTaskRead(taskId, lastReadMessageId),
  };
}
