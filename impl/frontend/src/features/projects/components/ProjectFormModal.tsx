"use client";

// プロジェクト作成/編集の URL 付きモーダル本体（Intercept 側・§112）＝クエストと同方式（RouteModal＋ProjectForm content）。
import { RouteModal } from "@/components/ui";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { ProjectForm, type ProjectPrefill } from "./ProjectForm";

export function ProjectFormModal({ mode, projectId, conceptId, conceptTitle, prefill, ownerName, ownerUserId }: {
  mode: "create" | "edit";
  projectId?: string;
  conceptId?: string | null;
  conceptTitle?: string | null;
  prefill?: ProjectPrefill;
  ownerName: string;
  ownerUserId?: string;
}) {
  return (
    <RouteModal title={mode === "edit" ? "プロジェクトを編集" : "プロジェクトを作成"} size="xl">
      {(close) => (
        <ProjectForm
          mode={mode}
          projectId={projectId}
          conceptId={conceptId}
          conceptTitle={conceptTitle}
          prefill={prefill}
          ownerName={ownerName}
          ownerUserId={ownerUserId}
          onCancel={close}
          onDone={(to) => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); close(to); }}
        />
      )}
    </RouteModal>
  );
}
