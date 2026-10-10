"use client";

// タブ移動ダイアログ（1件・D4・N.5c）＝情報を別タブへ移動（curator＋登録者・権限はサーバー再検証）。
// 移動先に「すべて」（system）を選べる＝ユーザータブから外して既定の箱へ戻す（タグ解除相当）。
import { useState } from "react";

import { Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
import { moveInfoItemTabApi } from "../api";
import type { InfoTab } from "../types";

// 一覧（InfoCard）からも詳細（InfoDetail）からも開けるよう、使うフィールドだけを要求する最小型。
type MoveTarget = { id: string; title: string; tab_id?: string | null };

export function MoveTabDialog({ item, tabs, onClose, onMoved }: {
  item: MoveTarget; tabs: InfoTab[]; onClose: () => void; onMoved: () => void;
}) {
  const snack = useSnackbar();
  const [tabId, setTabId] = useState<string>(item.tab_id ?? "");
  const [busy, setBusy] = useState(false);
  const choices = tabs.filter((t) => t.status === "active");

  async function move() {
    if (!tabId) return;
    setBusy(true);
    try {
      await moveInfoItemTabApi(item.id, tabId);
      snack({ type: "success", title: "移動しました", msg: `「${item.title}」を移動しました。` });
      onMoved();
    } catch {
      snack({ type: "error", title: "移動できませんでした", msg: "自分が登録した情報のみ移動できます（情報判定権限があれば任意）。" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="タブを移動" size="sm">
      <ModalBody>
        <p className="muted text-sm" style={{ marginTop: 0 }}>「{item.title}」の所属タブを選んでください。</p>
        <label className="field">
          <span className="field__label">移動先タブ</span>
          <select className="input" value={tabId} onChange={(e) => setTabId(e.target.value)} aria-label="移動先タブ">
            {choices.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.is_system ? "（既定）" : ""}</option>
            ))}
          </select>
        </label>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" onClick={move} disabled={busy || !tabId}>移動する</button>
      </ModalFooter>
    </Modal>
  );
}
