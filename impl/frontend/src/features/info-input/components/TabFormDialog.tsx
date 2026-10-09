"use client";

// タブの追加/編集ダイアログ（D4・N.5c）＝「＋ タブ」＝追加／各タブの ⋮「編集」＝改名。
// 入力検証はデザイン標準 §4.7（保存ボタンは常に押せる・空は Field エラー＋上部サマリ）。
// 無変更保存はダイアログ標準（§4.7 通知・line147）＝API を呼ばず info「変更はありません」で閉じる。
import { useState } from "react";

import { Field, FormSummary, Modal, ModalBody, ModalFooter, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { createInfoTabApi, updateInfoTabApi } from "../api";
import type { InfoTab } from "../types";

export function TabFormDialog({ mode, tab, onClose, onSaved }: {
  mode: "add" | "edit"; tab?: InfoTab; onClose: () => void; onSaved: () => void;
}) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const [name, setName] = useState(tab?.name ?? "");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setNameErr(null);
    const n = name.trim();
    if (!n) {  // §4.7＝押下時に検証（ボタンは常に押せる）＝空なら Field エラー＋上部サマリへ
      setNameErr("タブ名を入力してください");
      notify(["タブ名を入力してください"]);
      return;
    }
    // 無変更保存の標準（編集・line147）＝API を呼ばず info で応答（版/通知を増やさない）。
    if (mode === "edit" && tab && n === tab.name) {
      snack({ type: "info", title: "変更はありません" });
      onClose();
      return;
    }
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
      // 予約語/同名はサーバー検証＝Field エラー＋上部サマリで案内（§4.7）。
      const m = "予約語（すべて・カメリオ連携）や既存と同名は使えません。";
      setNameErr(m);
      notify([m]);
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={mode === "add" ? "タブを追加" : "タブ名を編集"} size="sm">
      <ModalBody>
        <FormSummary title="入力内容をご確認ください" errors={nameErr ? [nameErr] : []} innerRef={summaryRef} />
        <Field className="dialog-section is-quiet" id="tab-name" label="タブ名" required error={nameErr}>
          <input className="input" id="tab-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="例: 競合動向" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
        </Field>
        <p className="muted text-sm" style={{ marginTop: "var(--space-2)" }}>
          タブは分類であり閲覧制限ではありません。「すべて」「カメリオ連携」は予約語のため使えません。
        </p>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {mode === "add" ? "追加する" : "保存する"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
