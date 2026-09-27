"use client";

// SC-72 タスク登録・編集モーダル（FR-43・Q.2）。入力モーダル標準＋§4.7 検証（フロントエンド実装フロー規約 §2.1b）。
// 担当候補は開発メンバー（project_members）に限る。試作＝保存はデモ（トーストのみ・接続時に POST/PATCH へ）。
import { useState } from "react";

import { Field, FormFooterError, FormSummary, Modal, ModalBody, ModalFooter, useFormErrorNotice, useSnackbar } from "@/components/ui";
import type { FieldErrors } from "@/lib/forms/validation";

import type { ProjectMember, TaskKind, TaskNode, TaskStatus } from "../types";

// 保存ペイロード（試作のローカル反映用）。id 有り＝編集／無し＝新規（parentId 配下に作成）。
export type TaskSavePayload = { id?: string; parentId: string | null; kind: TaskKind; title: string; description: string; assigneeId: string; status: TaskStatus; dueDate: string };

const KIND_LABEL: Record<TaskKind, string> = { requirement: "要件", task: "作業タスク" };
const STATUS_LABEL: Record<string, string> = { todo: "未着手", doing: "進行中", done: "完了", blocked: "ブロック" };

// ツリーを親候補のフラットな選択肢に（自分自身・子孫は除外＝循環禁止の UX 補助）。
function flatten(nodes: TaskNode[], depth = 0, excludeId?: string): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const n of nodes) {
    if (n.id === excludeId) continue; // 自分と配下は親にできない（簡易＝自分のみ除外）
    out.push({ id: n.id, label: `${"　".repeat(depth)}${n.title}` });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1, excludeId));
  }
  return out;
}

export function TaskForm({ tasks, members, task, dupFrom, defaultParentId, onClose, onSaved }: {
  tasks: TaskNode[];
  members: ProjectMember[];
  task?: TaskNode | null;       // 指定で編集モード
  dupFrom?: TaskNode | null;    // 指定で複製（追加モードで値プリフィル＝別レコード新規・デザイン標準 §4.5 複製標準）
  defaultParentId?: string | null;
  onClose: () => void;
  onSaved?: (payload: TaskSavePayload) => void; // 試作＝ローカル反映（接続時は POST/PATCH の応答で置換）
}) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const isEdit = Boolean(task);
  const base = task ?? dupFrom ?? null; // 値のプリフィル元（編集＝task／複製＝dupFrom）。複製は追加モード（isEdit=false）。

  const [title, setTitle] = useState(base ? (isEdit ? base.title : `${base.title}（複製）`) : "");
  const [kind, setKind] = useState<TaskKind>((base?.kind as TaskKind) ?? "task");
  const [parentId, setParentId] = useState<string>((task?.parent_task_id ?? defaultParentId ?? "") || "");
  const [assignee, setAssignee] = useState<string>(base?.assignee?.user_id ?? "");
  const [status, setStatus] = useState<TaskStatus>((base?.status as TaskStatus) ?? "todo");
  const [dueDate, setDueDate] = useState<string>(base?.due_date ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const parentOptions = flatten(tasks, 0, task?.id);
  const noMembers = members.length === 0;

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!title.trim()) e.title = "タイトルを入力してください。";
    return e;
  }

  function save() {
    const fe = validate();
    setErrors(fe);
    const list = Object.values(fe).filter(Boolean);
    if (list.length) { notify(list); return; }
    setSaving(true);
    // 試作＝実 API は未接続（Q.2 POST/PATCH に差し替え）。done へ変更で完了報酬（Q.3）が付く旨をトーストで示す。
    const becameDone = status === "done" && task?.status !== "done";
    window.setTimeout(() => {
      setSaving(false);
      onSaved?.({ id: task?.id, parentId: parentId || null, kind, title: title.trim(), description: description.trim(), assigneeId: assignee, status, dueDate });
      snack({ type: "success", title: isEdit ? "タスクを更新しました" : "タスクを登録しました", msg: becameDone ? "完了により開発XP＋コインを獲得（接続時に付与）。" : undefined });
      onClose();
    }, 200);
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? "タスクを編集" : "タスクを登録"} size="md">
      <ModalBody>
        <FormSummary title="入力内容をご確認ください" errors={Object.values(errors).filter(Boolean)} innerRef={summaryRef} />
        <Field className="dialog-section is-quiet" id="t_title" label="タイトル" required error={errors.title}>
          <input id="t_title" className="input" value={title} onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: "" })); }} placeholder="例: 打刻画面 実装" />
        </Field>
        <Field className="dialog-section is-quiet" id="t_kind" label="粒度">
          <select id="t_kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
            {(Object.keys(KIND_LABEL) as TaskKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field className="dialog-section is-quiet" id="t_parent" label="親タスク" hint="未選択＝プロジェクト直下。同一プロジェクト内のみ。">
          <select id="t_parent" className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">（プロジェクト直下）</option>
            {parentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field className="dialog-section is-quiet" id="t_assignee" label="担当者" hint={noMembers ? "先に開発メンバーを追加してください（担当は開発メンバーに限ります）。" : "開発メンバーから選択（単一）。"}>
          <select id="t_assignee" className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={noMembers}>
            <option value="">（未割当）</option>
            {members.filter((m) => m.user).map((m) => <option key={m.user!.user_id} value={m.user!.user_id}>{m.user!.display_name}（{m.role === "lead" ? "リード" : "担当"}）</option>)}
          </select>
        </Field>
        <Field className="dialog-section is-quiet" id="t_status" label="状態">
          <select id="t_status" className="select" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field className="dialog-section is-quiet" id="t_due" label="期日">
          <input id="t_due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="t_desc" label="説明（任意）">
          <textarea id="t_desc" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="作業の内容・完了条件など" />
        </Field>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <FormFooterError show={Object.values(errors).some(Boolean)} />
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{isEdit ? "更新" : "登録"}</button>
      </ModalFooter>
    </Modal>
  );
}
