"use client";

// プロジェクト作成/メタ入力ダイアログ（FR-43・Q.1）。SC-61「開発を始める」＝コンセプトから初期値／
// SC-70「＋ プロジェクトを作成」＝コンセプト無し（単純タスク管理）で共有。§4.7 検証（§2.1b）。
// 試作＝作成はデモ（トースト＋onCreated）。作成後は遷移せずダイアログを閉じる（ユーザー要望）。
import { useState } from "react";

import { Field, FormFooterError, FormSummary, Modal, ModalBody, ModalFooter, Multiselect, useFormErrorNotice, useSnackbar } from "@/components/ui";
import type { FieldErrors } from "@/lib/forms/validation";

import { PROJECT_GROUP_OPTIONS, ProjectPartyPicker, type PickedMember } from "./ProjectPartyPicker";

export type ProjectPrefill = { title?: string; description?: string; launch_status?: string; plan?: string; kpi?: string };

export function ProjectForm({ prefill, conceptId, conceptTitle, onClose, onCreated }: {
  prefill?: ProjectPrefill;
  conceptId?: string | null;   // 由来コンセプト（無ければコンセプト非依存＝単純タスク管理）
  conceptTitle?: string | null;
  onClose: () => void;
  onCreated?: (projectId: string) => void;
}) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();

  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [launchStatus, setLaunchStatus] = useState(prefill?.launch_status ?? "");
  const [plan, setPlan] = useState(prefill?.plan ?? "");
  const [kpi, setKpi] = useState(prefill?.kpi ?? "");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [devMembers, setDevMembers] = useState<PickedMember[]>([]);
  const [candQuery, setCandQuery] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!title.trim()) e.title = "プロジェクト名を入力してください。";
    return e;
  }

  function create() {
    const fe = validate();
    setErrors(fe);
    const list = Object.values(fe).filter(Boolean);
    if (list.length) { notify(list); return; }
    setSaving(true);
    // 試作＝実 API 未接続（接続時＝conceptId 有り: POST /concepts/{id}/project／無し: POST /projects）。
    window.setTimeout(() => {
      setSaving(false);
      const memberNote = devMembers.length ? `／開発メンバー ${devMembers.length} 名` : "";
      snack({ type: "success", title: "プロジェクトを作成しました", msg: (conceptId ? "コンセプトからソリューション開発を起票しました。" : "コンセプト非依存の単純タスク管理プロジェクトを作成しました。") + memberNote });
      onCreated?.("p-new");
      onClose();
    }, 200);
  }

  return (
    <Modal open onClose={onClose} title="プロジェクトを作成" size="md">
      <ModalBody>
        <FormSummary title="入力内容をご確認ください" errors={Object.values(errors).filter(Boolean)} innerRef={summaryRef} />
        {conceptId ? (
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
        <Field className="dialog-section is-quiet" id="p_launch" label="ローンチ状態（任意）">
          <input id="p_launch" className="input" value={launchStatus} onChange={(e) => setLaunchStatus(e.target.value)} placeholder="例: 未着手 / 検証中 / 本番リリース済" />
        </Field>
        <Field className="dialog-section is-quiet" id="p_plan" label="導入計画（任意）">
          <textarea id="p_plan" className="textarea" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="導入の進め方・対象・スケジュール" />
        </Field>
        <Field className="dialog-section is-quiet" id="p_kpi" label="KPI 実測（任意）">
          <textarea id="p_kpi" className="textarea" rows={2} value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="価値実現の指標と実測（例: 問合せ削減率 目標30%）" />
        </Field>

        {/* 参加グループ（アクセス条件）＝クエスト作成の同 Field を踏襲（独立 Field＝Multiselect＋hint・§2.1c）。 */}
        <Field className="dialog-section is-quiet" id="p_groups" label="参加グループ（アクセス条件・任意）" hint="会社のグループを複数選択できます。未選択（0件）なら全社が候補になります。開発メンバー候補の範囲を絞るために使います。">
          <Multiselect
            id="p_groups"
            options={PROJECT_GROUP_OPTIONS}
            value={groupIds}
            onChange={setGroupIds}
            placeholder="グループを検索…（未選択なら全社）"
            ariaLabel="参加グループ（アクセス条件）"
            emptyText="該当するグループがありません"
          />
        </Field>

        {/* 参加メンバー（開発メンバー）・役割＝クエスト作成の同セクションを踏襲（.party＝スコープ表示＋候補追加＋選択中一覧・§2.1c）。 */}
        <Field className="dialog-section is-quiet" id="p_party" label="参加メンバー（開発メンバー）・役割">
          <ProjectPartyPicker
            groupIds={groupIds}
            members={devMembers}
            onMembers={setDevMembers}
            candQuery={candQuery}
            onCandQuery={setCandQuery}
          />
        </Field>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <FormFooterError show={Object.values(errors).some(Boolean)} />
        <button type="button" className="btn btn-primary" disabled={saving} onClick={create}>プロジェクトを作成</button>
      </ModalFooter>
    </Modal>
  );
}
