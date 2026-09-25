"use client";

// 成果物→情報の「＋ 関連情報を追加」逆向きピッカー（FR-41・双方向）。既存情報を検索して選び、
// 設定した種別で当該クエスト/アイデアへ関連付け（POST /info-links・新規EPなし）。追加は会社内 active 全員。
// 体裁は情報側「対象を選ぶ」と統一（🔍情報を絞り込み → 🏷️設定する種別 → 📋絞り込み結果）。
import { useEffect, useState } from "react";

import { Modal, ModalBody, ModalFooter, useConfirm, useSnackbar } from "@/components/ui";
import { addLinkApi, INFO_CHANGED_EVENT, searchInfoItems } from "../api";
import { IMPACT_CLASS_LABEL, LINK_KIND_LABEL } from "../labels";
import type { InfoCard, InfoLinkKind } from "../types";
import "../info-input.css";

export function AddRelatedInfoDialog({ open, onClose, targetType, targetId, existingInfoIds, onAdded }: {
  open: boolean; onClose: () => void;
  targetType: "quests" | "ideas" | "concepts"; targetId: string;
  existingInfoIds: Set<string>; onAdded: () => void;
}) {
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [q, setQ] = useState("");
  const [cards, setCards] = useState<InfoCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<InfoLinkKind>("related");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setSel(new Set()); setKind("related"); setQ(""); } }, [open]);

  // 情報検索（GET /info-items・q）＝デバウンス。既に関連付け済み（existingInfoIds）は除外。
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      searchInfoItems(q, ac.signal)
        .then((xs) => setCards(xs.filter((c) => !existingInfoIds.has(c.id))))
        .catch(() => { /* 中断/失敗は無視 */ })
        .finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [open, q, existingInfoIds]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const commit = async () => {
    if (sel.size === 0) return;
    if (kind === "refuting" && !(await confirm({
      title: "反証として設定", variant: "danger",
      msg: "反証は「根底を揺さぶる」シグナルです。対象の作成者・評価者・クエスト管理者へ通知が飛びます。反証として関連付けますか？",
    }))) return;
    setBusy(true);
    try {
      for (const infoId of sel) await addLinkApi(infoId, targetType, targetId, kind);
      window.dispatchEvent(new Event(INFO_CHANGED_EVENT)); // パネル/情報側を再取得（双方向整合）
      snack({ type: "success", title: `関連情報を ${sel.size} 件追加しました` });
      onAdded();
      onClose();
    } catch { snack({ type: "error", title: "関連付けに失敗しました", msg: "時間をおいて再試行してください。" }); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="＋ 関連情報を追加" size="lg">
      <ModalBody>
        <div className="pick-filters">
          <div className="pick-filters__title">🔍 情報を絞り込み</div>
          <div className="pick-filter-row">
            <span className="pick-filter-lbl">検索</span>
            <div className="dt-search">
              <span className="dt-search__ic" aria-hidden="true">🔍</span>
              <input className="input" type="search" placeholder="情報のタイトル・本文で検索…" aria-label="情報を検索" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        </div>

        <hr className="pick-divider" />
        <div className="pick-kindsel">
          <div className="pick-kindsel__title">🏷️ 設定する種別</div>
          <div className="pick-filter-row">
            <span className="pick-filter-lbl">種別</span>
            <select className="select pick-kindsel__select" value={kind} onChange={(e) => setKind(e.target.value as InfoLinkKind)} aria-label="関連付ける種別">
              {Object.entries(LINK_KIND_LABEL).map(([v, lab]) => <option key={v} value={v}>{lab[0]}</option>)}
            </select>
          </div>
          <span className="hint">選んだ情報をこの{targetType === "quests" ? "クエスト" : "アイデア"}に、この種別で関連付けます（「反証」は対象の作成者＋評価者へ通知＋要再評価）。</span>
        </div>

        <hr className="pick-divider" />
        <div className="pick-results-title">📋 絞り込み結果</div>
        <div className="pick-count-row">
          <span className="pick-count">{loading ? "検索中…" : `該当 ${cards.length} 件 ・ 選択 ${sel.size} 件`}</span>
        </div>
        {cards.length === 0 && !loading ? (
          <div className="pick-empty">該当する情報がありません（既に関連付け済みは除外）。新規登録は情報インプット（SC-50）から。</div>
        ) : (
          <ul className="pick-list" role="listbox" aria-label="情報候補">
            {cards.map((c) => {
              const on = sel.has(c.id);
              return (
                <li key={c.id} className={`pick-row${on ? " is-sel" : ""}`} role="option" aria-selected={on} onClick={() => toggle(c.id)}>
                  <input type="checkbox" className="pick-row__check" checked={on} readOnly aria-label="選択" />
                  <div className="pick-row__body">
                    <div className="pick-row__title"><span className="pick-row__title-t">{c.title}</span></div>
                    <div className="pick-row__ctx">
                      {[c.impact_class ? IMPACT_CLASS_LABEL[c.impact_class]?.[0] : null, c.created_by?.display_name, c.created_at ? `作成 ${c.created_at}` : null].filter(Boolean).join("・")}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={sel.size === 0 || busy} onClick={commit}>
          選択を確定{sel.size ? `（${sel.size}件）` : ""}
        </button>
      </ModalFooter>
    </Modal>
  );
}
