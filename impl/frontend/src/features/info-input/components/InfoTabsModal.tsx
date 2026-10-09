"use client";

// タブ管理モーダル（admin/curator・D4・N.5c）＝タブの追加／名称変更／アーカイブ。
// 検証（予約語「すべて」「カメリオ連携」・同名・配下非空アーカイブ）はサーバーが強制＝失敗は snackbar で通知。
// 並べ替え（ドラッグ）は後続（MVP は追加/改名/アーカイブ）。「すべて」(system) は改名/アーカイブ不可＝操作を出さない。
import { useState } from "react";

import { Modal, ModalBody, ModalFooter, useConfirm, useSnackbar } from "@/components/ui";
import { createInfoTabApi, updateInfoTabApi } from "../api";
import type { InfoTab } from "../types";

export function InfoTabsModal({ tabs, onClose, onChanged }: {
  tabs: InfoTab[]; onClose: () => void; onChanged: () => void;
}) {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [newName, setNewName] = useState("");
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(tabs.map((t) => [t.id, t.name])));
  const [busy, setBusy] = useState(false);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createInfoTabApi({ name });
      snack({ type: "success", title: "タブを追加しました", msg: `「${name}」を追加しました。` });
      setNewName("");
      onChanged();
    } catch {
      snack({ type: "error", title: "追加できませんでした", msg: "予約語（すべて・カメリオ連携）や既存と同名は使えません。" });
    } finally { setBusy(false); }
  }

  async function rename(t: InfoTab) {
    const name = (names[t.id] ?? "").trim();
    if (!name || name === t.name) return;
    setBusy(true);
    try {
      await updateInfoTabApi(t.id, { name });
      snack({ type: "success", title: "名称を変更しました", msg: `「${name}」に変更しました。` });
      onChanged();
    } catch {
      snack({ type: "error", title: "変更できませんでした", msg: "予約語や既存と同名は使えません。" });
    } finally { setBusy(false); }
  }

  async function archive(t: InfoTab) {
    const ok = await confirm({ title: "タブをアーカイブ", msg: `「${t.name}」をアーカイブしますか？（配下に情報があるときは先に移動が必要です）` });
    if (!ok) return;
    setBusy(true);
    try {
      await updateInfoTabApi(t.id, { status: "archived" });
      snack({ type: "success", title: "アーカイブしました", msg: `「${t.name}」をアーカイブしました。` });
      onChanged();
    } catch {
      snack({ type: "error", title: "アーカイブできませんでした", msg: "配下に情報があるタブはアーカイブできません。先に別タブへ移動してください。" });
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="タブを管理" size="md">
      <ModalBody>
        <p className="muted text-sm" style={{ marginTop: 0 }}>
          会社の情報タブを管理します。「すべて」は既定の受け皿（改名/アーカイブ不可）。タブは分類であり閲覧制限ではありません。
        </p>
        <div className="info-tabmgr">
          {tabs.map((t) => (
            <div key={t.id} className="info-tabmgr__row">
              {t.is_system ? (
                <span className="info-tabmgr__sys">{t.name}<span className="info-subtab__n">{t.count}</span>（既定）</span>
              ) : (
                <>
                  <input className="input" value={names[t.id] ?? t.name}
                    onChange={(e) => setNames((m) => ({ ...m, [t.id]: e.target.value }))}
                    onBlur={() => rename(t)} aria-label={`タブ名（${t.name}）`} />
                  <span className="info-subtab__n">{t.count}</span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => archive(t)}>アーカイブ</button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="info-tabmgr__add">
          <input className="input" placeholder="新しいタブ名（例: 競合動向）" value={newName}
            onChange={(e) => setNewName(e.target.value)} aria-label="新しいタブ名" />
          <button type="button" className="btn btn-primary" disabled={busy || !newName.trim()} onClick={add}>＋ 追加</button>
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>閉じる</button>
      </ModalFooter>
    </Modal>
  );
}
