"use client";

// 経営資料←→クエストの紐づけ（R.1b・§5.56）。情報詳細の「関連リンク」/「対象を選ぶ」と同一UI。
// controlled＝value/onChange。編集(docId有)＝API即時反映／登録(docId無)＝ローカルにステージ（保存後に親が一括POST）。
import { useCallback, useEffect, useState } from "react";

import { Modal, useSnackbar } from "@/components/ui";

import { addStrategyQuests, fetchQuestCandidates, fetchStrategyQuests, removeStrategyQuest } from "../api";
import { QUEST_STATUS_LABEL, questStatusLabel } from "../types";
import type { QuestLinkItem } from "../types";
import "@/features/info-input/info-input.css"; // link-*/pick-* を流用（情報と同一UI）
import "../strategy.css";

const STATUS_OPTS: [string, string][] = Object.entries(QUEST_STATUS_LABEL);

export function StrategyQuestLinks({ docId, value, onChange }: {
  docId?: string; value: QuestLinkItem[]; onChange: (next: QuestLinkItem[]) => void;
}) {
  const snack = useSnackbar();
  const isEdit = Boolean(docId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [candidates, setCandidates] = useState<QuestLinkItem[]>([]);
  const [selected, setSelected] = useState<Map<string, QuestLinkItem>>(new Map());
  const [busy, setBusy] = useState(false);

  // 編集＝サーバーから現在の紐づけをロード。
  useEffect(() => {
    if (!docId) return;
    const ac = new AbortController();
    fetchStrategyQuests(docId, ac.signal).then(onChange).catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // ピッカーの候補検索（絞り込み変化で再検索）。
  useEffect(() => {
    if (!pickerOpen) return;
    const ac = new AbortController();
    fetchQuestCandidates({ q, statuses: [...statuses], deadlineFrom: dueFrom, deadlineTo: dueTo }, ac.signal)
      .then(setCandidates).catch(() => {});
    return () => ac.abort();
  }, [pickerOpen, q, statuses, dueFrom, dueTo]);

  const linkedIds = new Set(value.map((x) => x.id));

  const remove = useCallback(async (questId: string) => {
    if (isEdit && docId) {
      const next = await removeStrategyQuest(docId, questId).catch(() => null);
      if (next) { onChange(next); snack({ type: "success", title: "紐づけを解除しました" }); }
    } else {
      onChange(value.filter((x) => x.id !== questId));
    }
  }, [isEdit, docId, value, onChange, snack]);

  const confirmAdd = useCallback(async () => {
    if (!selected.size) { setPickerOpen(false); return; }
    const items = [...selected.values()];
    if (isEdit && docId) {
      setBusy(true);
      const next = await addStrategyQuests(docId, items.map((x) => x.id)).catch(() => null);
      setBusy(false);
      if (next) { onChange(next); snack({ type: "success", title: "クエストを紐づけました" }); }
    } else {
      const merged = [...value];
      for (const it of items) if (!merged.some((m) => m.id === it.id)) merged.push(it);
      onChange(merged);
    }
    setSelected(new Map());
    setPickerOpen(false);
  }, [isEdit, docId, selected, value, onChange, snack]);

  const toggleSel = (c: QuestLinkItem) =>
    setSelected((m) => { const n = new Map(m); n.has(c.id) ? n.delete(c.id) : n.set(c.id, c); return n; });
  const toggleStatus = (s: string) =>
    setStatuses((st) => { const n = new Set(st); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const openPicker = () => { setSelected(new Map()); setQ(""); setStatuses(new Set()); setDueFrom(""); setDueTo(""); setPickerOpen(true); };

  return (
    <div className="field dialog-section is-quiet">
      <label>紐づくクエスト</label>
      {value.length ? (
        <ul className="link-list">
          {value.map((qt) => (
            <li key={qt.id} className="link-item">
              <span className="link-item__title">{qt.title}</span>
              <span className="badge badge-muted">{questStatusLabel(qt.status)}</span>
              <button type="button" className="link-item__rm" aria-label={`${qt.title} の紐づけを解除`} title="解除" onClick={() => void remove(qt.id)}>✕</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="hint">紐づくクエストはまだありません。下から追加できます（このクエストの配下アイデアに整合率が付きます）。</div>
      )}
      <div className="link-add">
        <button className="btn btn-outline" type="button" onClick={openPicker}>🔍 クエストを選ぶ…</button>
      </div>
      <div className="hint">この経営資料を適用するクエストを選びます。配下アイデアの「方針との関連度」を算出する対象になります（変更はクエストの版履歴に記録）。</div>

      {pickerOpen && (() => {
        const shown = candidates.filter((c) => !linkedIds.has(c.id));
        return (
          <Modal open={pickerOpen} title="クエストを選ぶ" size="md" onClose={() => setPickerOpen(false)}>
            <div className="modal__body">
              <div className="pick-filters">
                <div className="pick-filters__title">🔍 絞り込み</div>
                <div className="pick-filter-row">
                  <span className="pick-filter-lbl">ステータス</span>
                  <div className="pick-checks">
                    {STATUS_OPTS.map(([v, label]) => (
                      <label key={v} className="checkbox">
                        <input type="checkbox" checked={statuses.has(v)} onChange={() => toggleStatus(v)} /><span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="pick-filter-row">
                  <span className="pick-filter-lbl">タイトル</span>
                  <div className="dt-search">
                    <span className="dt-search__ic" aria-hidden="true">🔍</span>
                    <input className="input" type="search" placeholder="タイトルで検索…" aria-label="タイトル検索" value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                </div>
                <div className="pick-filter-row">
                  <span className="pick-filter-lbl">期限</span>
                  <div className="pick-daterange">
                    <div className="pick-daterange__inputs">
                      <input className="input" type="date" aria-label="期限（以降）" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
                      <span className="pick-daterange__sep">〜</span>
                      <input className="input" type="date" aria-label="期限（以前）" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
                    </div>
                    <span className="hint">クエストの期限日で絞り込み（未設定は範囲指定時に除外）</span>
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
                    const ctx = [c.owner_name, questStatusLabel(c.status), c.created_at ? `作成 ${c.created_at.slice(0, 10)}` : null].filter(Boolean).join("・");
                    return (
                      <li key={c.id} className={`pick-row${on ? " is-sel" : ""}`} role="option" aria-selected={on} onClick={() => toggleSel(c)}>
                        <input type="checkbox" className="pick-row__check" checked={on} readOnly aria-label="選択" />
                        <div className="pick-row__body">
                          <div className="pick-row__title">
                            <span className="pick-row__title-t">{c.title}</span>
                            {c.deadline ? <span className="badge badge-muted pick-row__due">⏳ {c.deadline}</span> : null}
                          </div>
                          {ctx ? <div className="pick-row__ctx">{ctx}</div> : null}
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
