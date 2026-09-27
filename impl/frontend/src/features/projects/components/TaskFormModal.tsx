"use client";

// タスク登録/編集の URL 付きモーダル本体（Intercept 側・§112）＝RouteModal＋TaskForm content。
import { RouteModal } from "@/components/ui";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { TaskForm } from "./TaskForm";

export function TaskFormModal({ projectId, taskId, parentId, dupId }: {
  projectId: string;
  taskId?: string;
  parentId?: string | null;
  dupId?: string;
}) {
  return (
    <RouteModal title={taskId ? "タスクを編集" : "タスクを登録"} size="md">
      {(close) => (
        <TaskForm
          projectId={projectId}
          taskId={taskId}
          parentId={parentId}
          dupId={dupId}
          onCancel={() => close()}
          onDone={() => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); close(); }}
        />
      )}
    </RouteModal>
  );
}
