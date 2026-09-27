"use client";

// 開発メンバー管理のフルページ・フォールバック（直アクセス/リロード時・§112）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { ProjectMembersForm } from "./ProjectMembersForm";

export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const back = `/projects/${projectId}`;
  return (
    <section aria-label="開発メンバーを管理">
      <Link className="backlink" href={back}>← プロジェクト詳細へ戻る</Link>
      <h1 className="page-title">開発メンバーを管理</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 900, margin: "var(--space-4) auto 0" }}>
        <ProjectMembersForm
          projectId={projectId}
          onCancel={() => router.push(back)}
          onDone={() => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); router.push(back); }}
        />
      </div>
    </section>
  );
}
