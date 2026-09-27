"use client";

// タスク登録/編集のフルページ・フォールバック（直アクセス/リロード時・§112）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { TaskForm } from "./TaskForm";

export function TaskFormPanel({ projectId, taskId, parentId, dupId }: {
  projectId: string;
  taskId?: string;
  parentId?: string | null;
  dupId?: string;
}) {
  const router = useRouter();
  const back = `/projects/${projectId}`;
  return (
    <section aria-label={taskId ? "タスク編集" : "タスク登録"}>
      <Link className="backlink" href={back}>← プロジェクト詳細へ戻る</Link>
      <h1 className="page-title">{taskId ? "タスクを編集" : "タスクを登録"}</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <TaskForm
          projectId={projectId}
          taskId={taskId}
          parentId={parentId}
          dupId={dupId}
          onCancel={() => router.push(back)}
          onDone={() => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); router.push(back); }}
        />
      </div>
    </section>
  );
}
