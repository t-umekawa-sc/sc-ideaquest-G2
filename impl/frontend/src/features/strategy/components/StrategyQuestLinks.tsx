"use client";

// 経営資料←→クエストの紐づけ（R.1b・§5.56）。情報詳細の「関連リンク」と同型＝一覧（チップ）＋「＋ クエストを紐づける」→
// 検索ピッカー（全社の有効クエスト）→ 追加／各チップ ✕ で解除。変更は当該クエストの版履歴に記録（backend）。
import { useCallback, useEffect, useState } from "react";

import { Modal, useSnackbar } from "@/components/ui";

import { addStrategyQuests, fetchQuestCandidates, fetchStrategyQuests, removeStrategyQuest } from "../api";
import type { QuestLinkItem } from "../types";
import "@/features/info-input/info-input.css"; // 関連リンク/ピッカーの共通UI（link-*/pick-*）を流用（同一UI）
import "../strategy.css";

export function StrategyQuestLinks({ docId }: { docId: string }) {
  const snack = useSnackbar();
  const [linked, setLinked] = useState<QuestLinkItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<QuestLinkItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchStrategyQuests(docId, ac.signal).then(setLinked).catch(() => {});
    return () => ac.abort();
  }, [docId]);

  // ピッカーを開いたら候補を検索（q 変化で再検索）。
  useEffect(() => {
    if (!pickerOpen) return;
    const ac = new AbortController();
    fetchQuestCandidates(q, ac.signal).then(setCandidates).catch(() => {});
    return () => ac.abort();
  }, [pickerOpen, q]);

  const linkedIds = new Set(linked.map((x) => x.id));

  const remove = useCallback(async (questId: string) => {
    const next = await removeStrategyQuest(docId, questId).catch(() => null);
    if (next) { setLinked(next); snack({ type: "success", title: "紐づけを解除しました" }); }
  }, [docId, snack]);

  const confirmAdd = useCallback(async () => {
    if (!selected.size) { setPickerOpen(false); return; }
    setBusy(true);
    const next = await addStrategyQuests(docId, [...selected]).catch(() => null);
    setBusy(false);
    if (next) {
      setLinked(next);
      snack({ type: "success", title: "クエストを紐づけました" });
    }
    setSelected(new Set());
    setPickerOpen(false);
  }, [docId, selected, snack]);

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="field dialog-section is-quiet">
      <div className="dialog-label">紐づくクエスト</div>
      {linked.length ? (
        <ul className="link-list">
          {linked.map((qt) => (
            <li key={qt.id} className="link-item">
              <span className="link-item__title">{qt.title}</span>
              <span className="badge badge-muted">{qt.status === "completed" ? "完了" : qt.status === "draft" ? "下書き" : "募集中"}</span>
              <button type="button" className="link-item__rm" aria-label={`${qt.title} の紐づけを解除`} title="解除" onClick={() => void remove(qt.id)}>✕</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="hint">紐づくクエストはまだありません。下から追加できます（このクエストの配下アイデアに整合率が付きます）。</div>
      )}
      <div className="link-add">
        <button className="btn btn-outline" type="button" onClick={() => { setSelected(new Set()); setQ(""); setPickerOpen(true); }}>🔍 クエストを選ぶ…</button>
      </div>
      <div className="hint">この経営資料を適用するクエストを選びます。配下アイデアの「方針との関連度」を算出する対象になります（変更はクエストの版履歴に記録）。</div>

      {pickerOpen && (() => {
        const shown = candidates.filter((c) => !linkedIds.has(c.id));
        const statusLabel = (s: string) => (s === "completed" ? "完了" : s === "draft" ? "下書き" : "募集中");
        return (
          <Modal open={pickerOpen} title="クエストを選ぶ" size="md" onClose={() => setPickerOpen(false)}>
            <div className="modal__body">
              {/* 絞り込み＝タイトルのみ（対象はクエスト固定＝種類フィルタ不要／設定する種別も不要）。 */}
              <div className="pick-filters">
                <div className="pick-filters__title">🔍 絞り込み</div>
                <div className="pick-filter-row">
                  <span className="pick-filter-lbl">タイトル</span>
                  <div className="dt-search">
                    <span className="dt-search__ic" aria-hidden="true">🔍</span>
                    <input className="input" type="search" placeholder="タイトルで検索…" aria-label="タイトル検索" value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                </div>
              </div>

              <hr className="pick-divider" />
              <div className="pick-results-title">📋 絞り込み結果</div>
              <div className="pick-count-row">
                <span className="pick-count">該当 {shown.length} 件 ・ 選択 {selected.size} 件</span>
              </div>
              {shown.length === 0 ? (
                <div className="pick-empty">該当するクエストがありません。絞り込みを調整してください。</div>
              ) : (
                <ul className="pick-list" role="listbox" aria-label="クエスト候補">
                  {shown.map((c) => {
                    const on = selected.has(c.id);
                    return (
                      <li key={c.id} className={`pick-row${on ? " is-sel" : ""}`} role="option" aria-selected={on} onClick={() => toggle(c.id)}>
                        <input type="checkbox" className="pick-row__check" checked={on} readOnly aria-label="選択" />
                        <div className="pick-row__body">
                          <div className="pick-row__title">
                            <span className="badge badge-muted lk-type">クエスト</span>
                            <span className="pick-row__title-t">{c.title}</span>
                          </div>
                          <div className="pick-row__ctx">{statusLabel(c.status)}</div>
                        </div>
                        <a className="pick-row__open" href={`/quests/${c.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>🔍 開く</a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="modal__footer">
              <button className="btn btn-outline" type="button" onClick={() => setPickerOpen(false)}>キャンセル</button>
              <button className="btn btn-primary" type="button" onClick={() => void confirmAdd()} disabled={busy || !selected.size}>
                {busy ? "追加中…" : "選択を確定"}
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
