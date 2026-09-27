"use client";

// 導入・価値実現（deployment）編集フォーム本体（FR-43・Q.5／SC-71）＝**モーダル content のみ**。
// projectId で現在の deployment を取得し、ローンチ状態/導入計画/KPI のみを PATCH /projects/{id}（deployment）。
import { useEffect, useState } from "react";

import { Field, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";

import { getProject, patchProject } from "../api";

export function ProjectDeploymentForm({ projectId, onDone, onCancel }: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const snack = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [launchStatus, setLaunchStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [kpi, setKpi] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getProject(projectId).then((p) => {
      if (!alive) return;
      const dep = (p?.deployment ?? {}) as Record<string, string>;
      setLaunchStatus(dep.launch_status ?? ""); setPlan(dep.plan ?? ""); setKpi(dep.kpi ?? "");
      setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId]);

  async function save() {
    setSaving(true);
    const dep: Record<string, string> = {};
    if (launchStatus.trim()) dep.launch_status = launchStatus.trim();
    if (plan.trim()) dep.plan = plan.trim();
    if (kpi.trim()) dep.kpi = kpi.trim();
    try {
      await patchProject(projectId, { deployment: dep });
      snack({ type: "success", title: "導入・価値実現を更新しました" });
      onDone();
    } catch {
      setSaving(false);
      snack({ type: "error", title: "更新できませんでした", msg: "権限（起票者/owner）と入力をご確認ください。" });
    }
  }

  if (loading) return <ModalBody><p className="muted">読み込み中…</p></ModalBody>;

  return (
    <>
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
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onCancel}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>保存する</button>
      </ModalFooter>
    </>
  );
}
