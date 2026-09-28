"use client";

// プロジェクト作成/編集のフルページ本体（直アクセス/リロード時のフォールバック・§112）。Modal シェルの代わりに .modal__panel。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PROJECTS_CHANGED_EVENT } from "../api";
import { ProjectForm, type ProjectPrefill } from "./ProjectForm";

export function ProjectFormPanel({ mode, projectId, conceptId, conceptTitle, prefill, ownerName, ownerUserId }: {
  mode: "create" | "edit";
  projectId?: string;
  conceptId?: string | null;
  conceptTitle?: string | null;
  prefill?: ProjectPrefill;
  ownerName: string;
  ownerUserId?: string;
}) {
  const router = useRouter();
  // 登録系ダイアログ標準（デザイン標準 §4.1）＝作成後は詳細へ遷移せず呼び元へ戻る。フルページ版の呼び元＝
  // 作成は一覧（/projects）／編集は対象詳細（/projects/{id}）。
  const back = mode === "edit" && projectId ? `/projects/${projectId}` : "/projects";
  const done = () => { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); router.push(back); };
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
          ownerUserId={ownerUserId}
          onCancel={() => router.push(back)}
          onDone={done}
        />
      </div>
    </section>
  );
}
