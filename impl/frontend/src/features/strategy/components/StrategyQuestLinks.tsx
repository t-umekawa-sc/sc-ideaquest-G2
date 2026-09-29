"use client";

// 経営資料←→クエストの紐づけ（R.1b・§5.56）。情報詳細の「関連リンク」と同型＝一覧（チップ）＋「＋ クエストを紐づける」→
// 検索ピッカー（全社の有効クエスト）→ 追加／各チップ ✕ で解除。変更は当該クエストの版履歴に記録（backend）。
import { useCallback, useEffect, useState } from "react";

import { Modal, useSnackbar } from "@/components/ui";

import { addStrategyQuests, fetchQuestCandidates, fetchStrategyQuests, removeStrategyQuest } from "../api";
import type { QuestLinkItem } from "../types";

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
    <div className="dialog-section is-quiet">
      <div className="field__labelrow">
        <label>紐づくクエスト</label>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => { setSelected(new Set()); setQ(""); setPickerOpen(true); }}>
          ＋ クエストを紐づける
        </button>
      </div>
      <p className="hint">この経営資料を適用するクエストを選びます。配下アイデアの「方針との関連度」を算出する対象になります（変更はクエストの版履歴に記録）。</p>
      {linked.length ? (
        <div className="tagselect__chips">
          {linked.map((qt) => (
            <span key={qt.id} className="tagselect__chip">{qt.title}
              <button type="button" aria-label={`${qt.title} の紐づけを解除`} onClick={() => void remove(qt.id)}>✕</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="hint">まだ紐づくクエストはありません。</p>
      )}

      {pickerOpen && (
        <Modal open={pickerOpen} title="クエストを紐づける" size="md" onClose={() => setPickerOpen(false)}>
          <div className="modal__body">
            <div className="dt-search" style={{ marginBottom: "var(--space-3)" }}>
              <span className="dt-search__ic" aria-hidden="true">🔍</span>
              <input className="input" type="search" placeholder="クエスト名で検索…" aria-label="クエスト名検索" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ul className="strategy-picklist">
              {candidates.filter((c) => !linkedIds.has(c.id)).map((c) => (
                <li key={c.id}>
                  <label className="checkbox">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    {c.title}
                  </label>
                </li>
              ))}
              {candidates.filter((c) => !linkedIds.has(c.id)).length === 0 && (
                <li className="hint">該当するクエストがありません。</li>
              )}
            </ul>
          </div>
          <div className="modal__footer">
            <button className="btn btn-outline" type="button" onClick={() => setPickerOpen(false)}>キャンセル</button>
            <button className="btn btn-primary" type="button" onClick={() => void confirmAdd()} disabled={busy || !selected.size}>
              {busy ? "追加中…" : `追加する（${selected.size}）`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
