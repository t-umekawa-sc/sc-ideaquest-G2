"use client";

// 開発メンバー管理の URL 付きモーダル本体（Intercept 側・§112）＝RouteModal＋ProjectMembersForm content。
import { RouteModal } from "@/components/ui";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { ProjectMembersForm } from "./ProjectMembersForm";

export function ProjectMembersModal({ projectId }: { projectId: string }) {
  return (
    <RouteModal title="開発メンバーを管理" size="xl">
      {(close) => (
        <ProjectMembersForm
          projectId={projectId}
          onCancel={() => close()}
          onDone={() => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); close(); }}
        />
      )}
    </RouteModal>
  );
}
