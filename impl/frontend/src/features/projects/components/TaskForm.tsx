"use client";

// SC-72 タスク登録・編集フォーム本体（FR-43・Q.2）＝**モーダル content のみ**（Modal シェルは RouteModal/Panel が提供）。
// projectId でタスクツリー（親候補）＋開発メンバー（担当候補）を取得し、実 API（createTask/patchTask）で保存。
// mode: create（+parentId で子追加 / +dupId で複製プリフィル）/ edit（taskId）。§4.7 検証（§2.1b）。
import { useEffect, useMemo, useState } from "react";

import { Field, FormFooterError, FormSummary, ModalBody, ModalFooter, useFormErrorNotice, useSnackbar } from "@/components/ui";
import type { FieldErrors } from "@/lib/forms/validation";

import { createTask, listProjectMembers, listProjectTasks, patchTask } from "../api";
import type { ProjectMember, TaskKind, TaskNode, TaskStatus } from "../types";

const KIND_LABEL: Record<TaskKind, string> = { requirement: "要件", task: "作業タスク" };
const STATUS_LABEL: Record<string, string> = { todo: "未着手", doing: "進行中", done: "完了", blocked: "ブロック" };

function flatten(nodes: TaskNode[], depth = 0, excludeId?: string): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const n of nodes) {
    if (n.id === excludeId) continue; // 自分は親にできない（簡易＝自分のみ除外）
    out.push({ id: n.id, label: `${"　".repeat(depth)}${n.title}` });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1, excludeId));
  }
  return out;
}
function findNode(nodes: TaskNode[], id: string): TaskNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = n.children?.length ? findNode(n.children, id) : null;
    if (c) return c;
  }
  return null;
}

export function TaskForm({ projectId, taskId, parentId: parentIdProp, dupId, onDone, onCancel }: {
  projectId: string;
  taskId?: string;              // 指定で編集モード
  parentId?: string | null;    // 子タスク追加時の親
  dupId?: string;              // 複製元（追加モードで値プリフィル）
  onDone: () => void;
  onCancel: () => void;
}) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const isEdit = Boolean(taskId);

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("task");
  const [parentId, setParentId] = useState<string>(parentIdProp ?? "");
  const [assignee, setAssignee] = useState<string>("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [dueDate, setDueDate] = useState<string>("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [prevStatus, setPrevStatus] = useState<TaskStatus>("todo");

  useEffect(() => {
    let alive = true;
    void Promise.all([listProjectTasks(projectId), listProjectMembers(projectId)]).then(([tree, m]) => {
      if (!alive) return;
      setTasks(tree); setMembers(m.members);
      const src = taskId ? findNode(tree, taskId) : dupId ? findNode(tree, dupId) : null;
      if (src) {
        setTitle(isEdit ? src.title : `${src.title}（複製）`);
        setKind((src.kind as TaskKind) ?? "task");
        setParentId((isEdit ? src.parent_task_id : parentIdProp ?? src.parent_task_id) ?? "");
        setAssignee(src.assignee?.user_id ?? "");
        setStatus((src.status as TaskStatus) ?? "todo");
        setPrevStatus((src.status as TaskStatus) ?? "todo");
        setDueDate(src.due_date ?? "");
        setDescription(src.description ?? "");
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId, taskId, dupId, parentIdProp, isEdit]);

  const parentOptions = useMemo(() => flatten(tasks, 0, taskId), [tasks, taskId]);
  const noMembers = members.length === 0;

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!title.trim()) e.title = "タイトルを入力してください。";
    return e;
  }

  async function save() {
    const fe = validate();
    setErrors(fe);
    const list = Object.values(fe).filter(Boolean);
    if (list.length) { notify(list); return; }
    setSaving(true);
    const becameDone = status === "done" && prevStatus !== "done";
    try {
      if (isEdit && taskId) {
        await patchTask(taskId, { kind, title: title.trim(), description: description.trim() || null, assignee_account_id: assignee || null, status, due_date: dueDate || null, parent_task_id: parentId || null });
      } else {
        await createTask(projectId, { parent_task_id: parentId || null, kind, title: title.trim(), description: description.trim() || null, assignee_account_id: assignee || null, status, due_date: dueDate || null, sort_order: 999 });
      }
      snack({ type: "success", title: isEdit ? "タスクを更新しました" : "タスクを登録しました", msg: becameDone ? "完了により開発XP＋コインを獲得しました。" : undefined });
      onDone();
    } catch {
      setSaving(false);
      snack({ type: "error", title: "保存できませんでした", msg: "入力・権限をご確認ください。" });
    }
  }

  if (loading) return <ModalBody><p className="muted">読み込み中…</p></ModalBody>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
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
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onCancel}>キャンセル</button>
        <FormFooterError show={Object.values(errors).some(Boolean)} />
        <button type="submit" className="btn btn-primary" disabled={saving}>{isEdit ? "更新" : "登録"}</button>
      </ModalFooter>
    </form>
  );
}
