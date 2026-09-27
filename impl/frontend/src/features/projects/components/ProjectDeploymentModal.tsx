"use client";

// 導入・価値実現 編集の URL 付きモーダル本体（Intercept 側・§112）＝RouteModal＋ProjectDeploymentForm content。
import { RouteModal } from "@/components/ui";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { ProjectDeploymentForm } from "./ProjectDeploymentForm";

export function ProjectDeploymentModal({ projectId }: { projectId: string }) {
  return (
    <RouteModal title="導入・価値実現を編集" size="md">
      {(close) => (
        <ProjectDeploymentForm
          projectId={projectId}
          onCancel={() => close()}
          onDone={() => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); close(); }}
        />
      )}
    </RouteModal>
  );
}
