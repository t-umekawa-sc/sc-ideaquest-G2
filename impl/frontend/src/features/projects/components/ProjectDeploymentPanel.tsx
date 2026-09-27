"use client";

// 導入・価値実現 編集のフルページ・フォールバック（直アクセス/リロード時・§112）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { ProjectDeploymentForm } from "./ProjectDeploymentForm";

export function ProjectDeploymentPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const back = `/projects/${projectId}`;
  return (
    <section aria-label="導入・価値実現を編集">
      <Link className="backlink" href={back}>← プロジェクト詳細へ戻る</Link>
      <h1 className="page-title">導入・価値実現を編集</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 640, margin: "var(--space-4) auto 0" }}>
        <ProjectDeploymentForm
          projectId={projectId}
          onCancel={() => router.push(back)}
          onDone={() => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); router.push(back); }}
        />
      </div>
    </section>
  );
}
