"use client";

// タブの追加/編集ダイアログ（D4・N.5c）＝「＋ タブ」＝追加／各タブの ⋮「編集」＝改名。
// 検証（予約語「すべて」「カメリオ連携」・同名）はサーバーが強制＝失敗は snackbar で通知。アーカイブは ⋮ メニュー側で確認して実行。
import { useState } from "react";

import { Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
import { createInfoTabApi, updateInfoTabApi } from "../api";
import type { InfoTab } from "../types";

export function TabFormDialog({ mode, tab, onClose, onSaved }: {
  mode: "add" | "edit"; tab?: InfoTab; onClose: () => void; onSaved: () => void;
}) {
  const snack = useSnackbar();
  const [name, setName] = useState(tab?.name ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      if (mode === "add") {
        await createInfoTabApi({ name: n });
        snack({ type: "success", title: "タブを追加しました", msg: `「${n}」を追加しました。` });
      } else if (tab) {
        await updateInfoTabApi(tab.id, { name: n });
        snack({ type: "success", title: "名称を変更しました", msg: `「${n}」に変更しました。` });
      }
      onSaved();
    } catch {
      snack({ type: "error", title: mode === "add" ? "追加できませんでした" : "変更できませんでした",
        msg: "予約語（すべて・カメリオ連携）や既存と同名は使えません。" });
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={mode === "add" ? "タブを追加" : "タブ名を編集"} size="sm">
      <ModalBody>
        <label className="field">
          <span className="field__label">タブ名</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="例: 競合動向" autoFocus aria-label="タブ名"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
        </label>
        <p className="muted text-sm" style={{ marginTop: "var(--space-2)" }}>
          タブは分類であり閲覧制限ではありません。「すべて」「カメリオ連携」は予約語のため使えません。
        </p>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>
          {mode === "add" ? "追加する" : "保存する"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
