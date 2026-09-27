"use client";

// 導入・価値実現（deployment）だけを編集する小ダイアログ（FR-43・Q.5／SC-71 導入タブ）。
// プロジェクト全体の編集（ProjectForm）とは別＝ローンチ状態/導入計画/KPI 実測のみを PATCH /projects/{id}（deployment）。
import { useState } from "react";

import { Field, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";

import { patchProject } from "../api";
import type { DeploymentMeta } from "../types";

export function ProjectDeploymentModal({ projectId, deployment, onClose, onSaved }: {
  projectId: string;
  deployment: DeploymentMeta;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const snack = useSnackbar();
  const [launchStatus, setLaunchStatus] = useState(deployment.launch_status ?? "");
  const [plan, setPlan] = useState(deployment.plan ?? "");
  const [kpi, setKpi] = useState(deployment.kpi ?? "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);
  const requestClose = () => setOpen(false);

  async function save() {
    setSaving(true);
    const dep: Record<string, string> = {};
    if (launchStatus.trim()) dep.launch_status = launchStatus.trim();
    if (plan.trim()) dep.plan = plan.trim();
    if (kpi.trim()) dep.kpi = kpi.trim();
    try {
      await patchProject(projectId, { deployment: dep });
      snack({ type: "success", title: "導入・価値実現を更新しました" });
      onSaved?.();
      requestClose();
    } catch {
      setSaving(false);
      snack({ type: "error", title: "更新できませんでした", msg: "権限（起票者/owner）と入力をご確認ください。" });
    }
  }

  return (
    <Modal open={open} onClose={requestClose} onClosed={onClose} title="導入・価値実現を編集" size="md">
      <ModalBody>
        <Field className="dialog-section is-quiet" id="d_launch" label="ローンチ状態（任意）">
          <input id="d_launch" className="input" value={launchStatus} onChange={(e) => setLaunchStatus(e.target.value)} placeholder="例: 未着手 / 検証中 / 本番リリース済" />
        </Field>
        <Field className="dialog-section is-quiet" id="d_plan" label="導入計画（任意）">
          <textarea id="d_plan" className="textarea" rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="導入の進め方・対象・スケジュール" />
        </Field>
        <Field className="dialog-section is-quiet" id="d_kpi" label="KPI 実測（任意）">
          <textarea id="d_kpi" className="textarea" rows={3} value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="価値実現の指標と実測（例: 問合せ削減率 目標30%）" />
        </Field>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={requestClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>保存する</button>
      </ModalFooter>
    </Modal>
  );
}
