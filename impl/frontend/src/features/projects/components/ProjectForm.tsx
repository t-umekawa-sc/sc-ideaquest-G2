"use client";

// プロジェクト作成/編集フォーム本体（FR-43・Q.1）＝**モーダル content のみ**（Modal シェルは RouteModal/Panel が提供）。
// クエスト（QuestForm）と同じ URL 付きモーダル方式（Parallel＋Intercept・§112）に統一。
// 作成: conceptId 有り POST /concepts/{id}/project／無し POST /projects。編集: projectId で詳細＋メンバーを取得し PATCH。
import { useEffect, useState } from "react";

import { Field, FormFooterError, FormSummary, ModalBody, ModalFooter, Multiselect, useFormErrorNotice, useSnackbar } from "@/components/ui";
import type { FieldErrors } from "@/lib/forms/validation";
import { ApiError } from "@/lib/api/client";

import { addProjectMember, createProject, createProjectFromConcept, getProject, listProjectMembers, patchProject, patchProjectMember, removeProjectMember } from "../api";
import type { ProjectRole, ProjectStatus } from "../types";
import { ProjectPartyPicker, PROJECT_GROUP_OPTIONS, type PickedMember } from "./ProjectPartyPicker";

export type ProjectPrefill = { title?: string; description?: string; launch_status?: string; plan?: string; kpi?: string };

const STATUS_LABEL: Record<ProjectStatus, string> = { planning: "計画中", in_progress: "進行中", on_hold: "保留", done: "完了" };

export function ProjectForm({ mode = "create", projectId, prefill, conceptId, conceptTitle, ownerName, onDone, onCancel }: {
  mode?: "create" | "edit";
  projectId?: string;              // 編集時＝対象プロジェクト（詳細/メンバーを本体で取得）
  prefill?: ProjectPrefill;
  conceptId?: string | null;       // 由来コンセプト（無ければコンセプト非依存＝単純タスク管理）
  conceptTitle?: string | null;
  ownerName: string;               // 作成者/所有者の氏名（パーティーの固定 owner 行）
  onDone: (to?: string) => void;   // 成功（作成/更新）後の閉じ（RouteModal の close／Panel の遷移）
  onCancel: (to?: string) => void; // キャンセル
}) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const isEdit = mode === "edit";

  const [loading, setLoading] = useState(isEdit);
  const [title, setTitle] = useState(prefill?.title ?? (conceptId && conceptTitle ? `${conceptTitle} 開発` : ""));
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [launchStatus, setLaunchStatus] = useState(prefill?.launch_status ?? "");
  const [plan, setPlan] = useState(prefill?.plan ?? "");
  const [kpi, setKpi] = useState(prefill?.kpi ?? "");
  const [devMembers, setDevMembers] = useState<PickedMember[]>([]);
  const [initialMembers, setInitialMembers] = useState<PickedMember[]>([]);  // 編集時の差分計算基準
  const [accessGroups, setAccessGroups] = useState<string[]>([]);  // 参加グループ（アクセス条件）＝候補スコープ（試作・未永続）
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // 編集時＝詳細＋開発メンバーを取得してフォーム初期値に（保存時に差分で add/patch/remove）。
  useEffect(() => {
    if (!isEdit || !projectId) return;
    let alive = true;
    void Promise.all([getProject(projectId), listProjectMembers(projectId)]).then(([p, m]) => {
      if (!alive || !p) { if (alive) setLoading(false); return; }
      const dep = (p.deployment ?? {}) as Record<string, string>;
      setTitle(p.title); setDescription(p.description ?? "");
      setStatus((p.status as ProjectStatus) ?? "planning");
      setLaunchStatus(dep.launch_status ?? ""); setPlan(dep.plan ?? ""); setKpi(dep.kpi ?? "");
      const picked = m.members.filter((x) => x.user).map((x) => ({ user: x.user!, role: x.role as ProjectRole }));
      setDevMembers(picked); setInitialMembers(picked);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [isEdit, projectId]);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!title.trim()) e.title = "プロジェクト名を入力してください。";
    return e;
  }

  function buildDeployment(): Record<string, string> {
    const deployment: Record<string, string> = {};
    if (launchStatus.trim()) deployment.launch_status = launchStatus.trim();
    if (plan.trim()) deployment.plan = plan.trim();
    if (kpi.trim()) deployment.kpi = kpi.trim();
    return deployment;
  }

  async function save() {
    const fe = validate();
    setErrors(fe);
    const list = Object.values(fe).filter(Boolean);
    if (list.length) { notify(list); return; }
    setSaving(true);
    const deployment = buildDeployment();
    try {
      if (isEdit && projectId) {
        await patchProject(projectId, { title: title.trim(), description: description.trim() || null, status, deployment });
        const before = new Map(initialMembers.map((m) => [m.user.user_id, m.role]));
        const after = new Map(devMembers.map((m) => [m.user.user_id, m.role]));
        for (const [uid] of before) if (!after.has(uid)) await removeProjectMember(projectId, uid);
        for (const [uid, role] of after) {
          if (!before.has(uid)) await addProjectMember(projectId, uid, role);
          else if (before.get(uid) !== role) await patchProjectMember(projectId, uid, role);
        }
        snack({ type: "success", title: "プロジェクトを更新しました" });
        onDone();
        return;
      }
      const members = devMembers.map((m) => ({ user_id: m.user.user_id, role: m.role }));
      const created = conceptId
        ? await createProjectFromConcept(conceptId, { title: title.trim(), description: description.trim() || null, deployment, members })
        : await createProject({ title: title.trim(), description: description.trim() || null, deployment, members });
      const memberNote = devMembers.length ? `／開発メンバー ${devMembers.length} 名` : "";
      snack({ type: "success", title: "プロジェクトを作成しました", msg: (conceptId ? "コンセプトからソリューション開発を起票しました。" : "単純タスク管理プロジェクトを作成しました。") + memberNote });
      onDone(created ? `/projects/${created.id}` : undefined);
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.status === 409) snack({ type: "error", title: "保存できませんでした", msg: "このコンセプトのプロジェクトは既に存在するか、go 判定ではありません。" });
      else if (e instanceof ApiError && e.status === 403) snack({ type: "error", title: "権限がありません", msg: isEdit ? "編集は起票者/owner のみです。" : "起票は owner/クエスト管理者のみです。" });
      else snack({ type: "error", title: "保存できませんでした", msg: "入力内容をご確認ください。" });
    }
  }

  if (loading) return <ModalBody><p className="muted">読み込み中…</p></ModalBody>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <ModalBody>
        <FormSummary title="入力内容をご確認ください" errors={Object.values(errors).filter(Boolean)} innerRef={summaryRef} />
        {isEdit ? (
          <p className="role-note" style={{ marginTop: 0 }}>プロジェクトの基本情報・状態・導入メタ・開発メンバーを編集します。</p>
        ) : conceptId ? (
          <p className="role-note" style={{ marginTop: 0 }}>コンセプト「<strong>{conceptTitle}</strong>」から開発（ソリューション）を起票します。内容を初期値にしています（編集可）。</p>
        ) : (
          <p className="role-note" style={{ marginTop: 0 }}>コンセプトに紐づかない<strong>単純なタスク管理</strong>プロジェクトを作成します。</p>
        )}
        <Field className="dialog-section is-quiet" id="p_title" label="プロジェクト名" required error={errors.title}>
          <input id="p_title" className="input" value={title} onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: "" })); }} placeholder="例: スマート勤怠アシスタント 開発" />
        </Field>
        <Field className="dialog-section is-quiet" id="p_desc" label="概要（任意）">
          <textarea id="p_desc" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="このプロジェクトで何をやるか" />
        </Field>
        {isEdit && (
          <Field className="dialog-section is-quiet" id="p_status" label="状態">
            <select id="p_status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
        )}
        <Field className="dialog-section is-quiet" id="p_launch" label="ローンチ状態（任意）">
          <input id="p_launch" className="input" value={launchStatus} onChange={(e) => setLaunchStatus(e.target.value)} placeholder="例: 未着手 / 検証中 / 本番リリース済" />
        </Field>
        <Field className="dialog-section is-quiet" id="p_plan" label="導入計画（任意）">
          <textarea id="p_plan" className="textarea" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="導入の進め方・対象・スケジュール" />
        </Field>
        <Field className="dialog-section is-quiet" id="p_kpi" label="KPI 実測（任意）">
          <textarea id="p_kpi" className="textarea" rows={2} value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="価値実現の指標と実測（例: 問合せ削減率 目標30%）" />
        </Field>

        {/* 参加グループ（アクセス条件・任意）＝QuestForm と同構成（候補スコープ＋グループ外マーキング）。試作＝会社グループのデモ・未永続。 */}
        <Field className="dialog-section is-quiet" id="p_groups" label="参加グループ（アクセス条件・任意）">
          <Multiselect id="p_groups" options={PROJECT_GROUP_OPTIONS} value={accessGroups} onChange={setAccessGroups} placeholder="グループを選択…（未選択＝全社が候補）" ariaLabel="参加グループ" emptyText="該当するグループがありません" />
          <span className="hint">選んだグループの所属者を候補・アクセス範囲にします（未選択なら全社）。開発メンバーは下で追加します。</span>
        </Field>

        {/* 参加メンバー（開発メンバー）・役割＝クエスト作成の同セクションを踏襲。作成者は固定 owner 行・グループは上位 Field で controlled。 */}
        <Field className="dialog-section is-quiet" id="p_party" label="参加メンバー（開発メンバー）・役割">
          <ProjectPartyPicker members={devMembers} onMembers={setDevMembers} ownerName={ownerName} ownerLabel={isEdit ? "作成者" : "あなた・作成者"} groupFilter={accessGroups} onGroupFilter={setAccessGroups} />
        </Field>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={() => onCancel()}>キャンセル</button>
        <FormFooterError show={Object.values(errors).some(Boolean)} />
        <button type="submit" className="btn btn-primary" disabled={saving}>{isEdit ? "保存する" : "プロジェクトを作成"}</button>
      </ModalFooter>
    </form>
  );
}
