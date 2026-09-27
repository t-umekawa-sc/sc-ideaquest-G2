"use client";

// プロジェクト作成/編集のフルページ本体（直アクセス/リロード時のフォールバック・§112）。Modal シェルの代わりに .modal__panel。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { ProjectForm, type ProjectPrefill } from "./ProjectForm";

export function ProjectFormPanel({ mode, projectId, conceptId, conceptTitle, prefill, ownerName }: {
  mode: "create" | "edit";
  projectId?: string;
  conceptId?: string | null;
  conceptTitle?: string | null;
  prefill?: ProjectPrefill;
  ownerName: string;
}) {
  const router = useRouter();
  const back = mode === "edit" && projectId ? `/projects/${projectId}` : "/projects";
  const done = (to?: string) => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); router.push(to ?? back); };
  return (
    <section aria-label={mode === "edit" ? "プロジェクト編集" : "プロジェクト作成"}>
      <Link className="backlink" href={back}>← 戻る</Link>
      <h1 className="page-title">{mode === "edit" ? "プロジェクトを編集" : "プロジェクトを作成"}</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 900, margin: "var(--space-4) auto 0" }}>
        <ProjectForm
          mode={mode}
          projectId={projectId}
          conceptId={conceptId}
          conceptTitle={conceptTitle}
          prefill={prefill}
          ownerName={ownerName}
          onCancel={() => router.push(back)}
          onDone={done}
        />
      </div>
    </section>
  );
}
