"use client";

// コンテストの作成/編集/複製フォーム（共有モーダル・DRY＝コーディング規約 §2.3）。
// 一覧(SC-53 ContestListView)と詳細(SC-54 ContestDetailView)の両方から同じ編集を開くため抽出
// （詳細ヘッダーの操作統一＝デザイン標準 §4.14）。業務計算はしない（§4.1・create/updateContest を呼ぶだけ）。
import { useEffect, useState } from "react";

import { Button, Combobox, Field, Modal, useSnackbar } from "@/components/ui";
import { createContest, getContest, updateContest } from "../api";
import { CONTEST_MODE_LABEL } from "../types";

export type ContestFormMode = "create" | "edit" | "duplicate";

export function ContestFormModal({
  open,
  mode,
  contestId,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: ContestFormMode;
  contestId?: string | null;   // edit/duplicate のプリフィル元（create は未指定）
  onClose: () => void;
  onSaved: () => void;         // 保存成功後（呼び元が一覧/詳細を再取得）
}) {
  const snack = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState("");
  const [description, setDescription] = useState("");
  const [cmode, setCmode] = useState("bounded");
  const [status, setStatus] = useState("draft");
  const [startsAt, setStartsAt] = useState("");   // YYYY-MM-DD（会期型の開始日）
  const [endsAt, setEndsAt] = useState("");       // YYYY-MM-DD（会期型の締切）
  const [autoArchiveDays, setAutoArchiveDays] = useState(""); // 常設型の自動お蔵入り日数
  const [autoApprove, setAutoApprove] = useState(false);
  const [themeErr, setThemeErr] = useState<string | null>(null);

  // open のたびに初期化＝create は空、edit/duplicate は詳細を取得してプリフィル（取得失敗は空のまま）。
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setThemeErr(null); setSaving(false);
    if (mode === "create" || !contestId) {
      setTheme(""); setDescription(""); setCmode("bounded"); setStatus("draft");
      setStartsAt(""); setEndsAt(""); setAutoArchiveDays(""); setAutoApprove(false);
      return;
    }
    // edit/duplicate：まず空にしてから詳細で埋める。
    setTheme(""); setDescription(""); setStatus("draft");
    setStartsAt(""); setEndsAt(""); setAutoArchiveDays(""); setAutoApprove(false);
    void getContest(contestId).then((detail) => {
      if (!alive || !detail) return;
      setTheme(detail.theme ?? "");
      setDescription(detail.description ?? "");
      setCmode(detail.mode ?? "bounded");
      setStartsAt((detail.starts_at ?? "").slice(0, 10));
      setEndsAt((detail.ends_at ?? "").slice(0, 10));
      setAutoArchiveDays(detail.auto_archive_days != null ? String(detail.auto_archive_days) : "");
      setAutoApprove(detail.auto_approve ?? false);
      if (mode === "edit") setStatus(detail.status);
    });
    return () => { alive = false; };
  }, [open, mode, contestId]);

  async function submit() {
    if (!theme.trim()) { setThemeErr("テーマを入力してください。"); return; }
    if (cmode !== "rolling" && startsAt && endsAt && startsAt > endsAt) {
      setThemeErr("締切は開始日以降にしてください。"); return;
    }
    setThemeErr(null);
    setSaving(true);
    const toIso = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : null);
    const period = cmode === "rolling"
      ? { auto_archive_days: autoArchiveDays ? Number(autoArchiveDays) : null }
      : { starts_at: toIso(startsAt), ends_at: toIso(endsAt) };
    try {
      if (mode === "edit" && contestId) {
        const updated = await updateContest(contestId, { theme: theme.trim(), description: description.trim() || null, auto_approve: autoApprove, ...period });
        if (!updated) { snack({ type: "error", title: "更新に失敗しました（権限が必要な場合があります）" }); return; }
        snack({ type: "success", title: "コンテストを更新しました" });
      } else {
        const created = await createContest({ theme: theme.trim(), description: description.trim() || null, mode: cmode, status, auto_approve: autoApprove, ...period });
        if (!created) { snack({ type: "error", title: "作成に失敗しました（権限が必要な場合があります）" }); return; }
        snack({ type: "success", title: "コンテストを作成しました" });
      }
      onClose();
      onSaved();
    } catch {
      snack({ type: "error", title: mode === "edit" ? "更新に失敗しました" : "作成に失敗しました" });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  const title = mode === "edit" ? "コンテストを編集" : mode === "duplicate" ? "コンテストを複製" : "コンテストを作成";
  const submitLabel = mode === "edit" ? "保存する" : "作成する";

  return (
    <Modal open={open} title={title} size="md" onClose={onClose}>
      <div className="modal__body">
        <Field id="ct-theme" label="テーマ" required error={themeErr}>
          <input className="input" id="ct-theme" value={theme} onChange={(e) => setTheme(e.target.value)}
                 placeholder="例）業務改善アイデア大募集 2027" />
        </Field>
        <Field id="ct-desc" label="説明">
          <textarea className="input" id="ct-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder="コンテストの趣旨・応募要領など（任意）" />
        </Field>
        {mode !== "edit" && (
          <Field id="ct-mode" label="種別">
            <Combobox id="ct-mode" ariaLabel="種別" value={cmode} onChange={setCmode}
              options={[{ value: "bounded", label: CONTEST_MODE_LABEL.bounded }, { value: "rolling", label: CONTEST_MODE_LABEL.rolling }]} />
          </Field>
        )}
        {cmode === "rolling" ? (
          <Field id="ct-archive" label="自動お蔵入り日数">
            <input className="input" id="ct-archive" type="number" min={1} value={autoArchiveDays}
                   onChange={(e) => setAutoArchiveDays(e.target.value)} placeholder="例）90（経過アイデアを自動でお蔵入り）" />
          </Field>
        ) : (
          <div className="row-2">
            <Field id="ct-starts" label="開始日">
              <input className="input" id="ct-starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field id="ct-ends" label="締切">
              <input className="input" id="ct-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>
        )}
        {mode !== "edit" && (
          <Field id="ct-status" label="公開">
            <Combobox id="ct-status" ariaLabel="公開" value={status} onChange={setStatus}
              options={[{ value: "draft", label: "準備中（下書き）" }, { value: "open", label: "すぐ公募を開始" }]} />
          </Field>
        )}
        <Field id="ct-approve" label="参加の受付">
          <label className="checkbox">
            <input type="checkbox" id="ct-approve" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
            <span>誰でも参加可（自動承認）<span className="muted text-xs">　／　OFF＝管理者の承認制</span></span>
          </label>
        </Field>
      </div>
      <div className="modal__footer">
        <button className="btn btn-outline dialog-close-left" type="button" onClick={onClose} disabled={saving}>キャンセル</button>
        <Button variant="primary" onClick={submit} loading={saving}>{submitLabel}</Button>
      </div>
    </Modal>
  );
}
