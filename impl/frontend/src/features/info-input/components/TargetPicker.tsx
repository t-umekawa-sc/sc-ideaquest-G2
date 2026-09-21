"use client";

// 関連リンクの対象ピッカー（共通・登録/詳細で共用）。種類/期限/タイトルで絞込＋文脈メタ付き候補カード＋
// もっと見る（cursor）＋複数選択（絞込を変えても保持）。見本＝doc/画面設計/mocks/style-guide.html「10d」。
// backend は ideas/quests のみ対応（concepts/前提はコンセプト段で追加＝コンセプト設計書 §4 の実装漏れ防止）。
import { useEffect, useState } from "react";

import { Modal, ModalBody, ModalFooter } from "@/components/ui";
import { fetchLinkCandidates } from "../api";
import { LINK_TARGET_LABEL } from "../labels";
import type { InfoLinkCandidate, InfoLinkTarget } from "../types";
import "../info-input.css";

const TYPES: { v: InfoLinkTarget; label: string }[] = [
  { v: "ideas", label: LINK_TARGET_LABEL.ideas },
  { v: "quests", label: LINK_TARGET_LABEL.quests },
];
const PAGE = 10;
const uid = (c: InfoLinkCandidate) => `${c.target_type}:${c.target_id}`;
const openHref = (c: InfoLinkCandidate) =>
  c.target_type === "ideas" ? `/ideas/${c.target_id}` : c.target_type === "quests" ? `/quests/${c.target_id}` : "#";

export function TargetPicker({ open, onClose, onConfirm }: {
  open: boolean; onClose: () => void; onConfirm: (selected: InfoLinkCandidate[]) => void;
}) {
  const [types, setTypes] = useState<InfoLinkTarget[]>(["ideas", "quests"]);
  const [q, setQ] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [cands, setCands] = useState<InfoLinkCandidate[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Map<string, InfoLinkCandidate>>(new Map());

  // 開くたびに選択をリセット。
  useEffect(() => { if (open) setSel(new Map()); }, [open]);

  // 絞込/検索が変わったら先頭ページから取り直し（デバウンス）。選択(sel)は保持する。
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetchLinkCandidates({ types, q, dueFrom: dueFrom || undefined, dueTo: dueTo || undefined, limit: PAGE }, ac.signal)
        .then((r) => { setCands(r.candidates); setNextCursor(r.nextCursor); })
        .catch(() => { /* 中断/失敗は無視（次の入力で再取得） */ })
        .finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [open, types, q, dueFrom, dueTo]);

  const loadMore = () => {
    if (!nextCursor) return;
    setLoading(true);
    fetchLinkCandidates({ types, q, dueFrom: dueFrom || undefined, dueTo: dueTo || undefined, limit: PAGE, cursor: nextCursor })
      .then((r) => { setCands((prev) => [...prev, ...r.candidates]); setNextCursor(r.nextCursor); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const toggleType = (v: InfoLinkTarget) =>
    setTypes((ts) => (ts.includes(v) ? ts.filter((x) => x !== v) : [...ts, v]));
  const toggleSel = (c: InfoLinkCandidate) =>
    setSel((m) => { const n = new Map(m); const k = uid(c); if (n.has(k)) n.delete(k); else n.set(k, c); return n; });

  return (
    <Modal open={open} onClose={onClose} title="対象を選ぶ" size="lg">
      <ModalBody>
        <div className="pick-filters">
          <div className="pick-filters__title">🔍 絞り込み</div>
          <div className="pick-filter-row">
            <span className="pick-filter-lbl">種類</span>
            <div className="pick-checks">
              {TYPES.map((t) => (
                <label key={t.v} className="checkbox">
                  <input type="checkbox" checked={types.includes(t.v)} onChange={() => toggleType(t.v)} /><span>{t.label}</span>
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
              <span className="hint">クエスト＝期限日／アイデア＝タイムリミット（未設定は範囲指定時に除外）</span>
            </div>
          </div>
        </div>

        <div className="pick-count-row">
          <span className="pick-count">{loading ? "検索中…" : `該当 ${cands.length}${nextCursor ? "+" : ""} 件 ・ 選択 ${sel.size} 件`}</span>
        </div>
        {cands.length === 0 && !loading ? (
          <div className="pick-empty">該当する対象がありません。絞り込みを調整してください。</div>
        ) : (
          <ul className="pick-list" role="listbox" aria-label="対象候補">
            {cands.map((c) => {
              const on = sel.has(uid(c));
              const ctx = c.target_type === "ideas"
                ? [c.quest_title ? `📜${c.quest_title}` : null, c.owner_name, c.status, c.created_at ? `作成 ${c.created_at}` : null].filter(Boolean).join("・")
                : [c.owner_name, c.status, c.created_at ? `作成 ${c.created_at}` : null].filter(Boolean).join("・");
              return (
                <li key={uid(c)} className={`pick-row${on ? " is-sel" : ""}`} role="option" aria-selected={on} onClick={() => toggleSel(c)}>
                  <input type="checkbox" className="pick-row__check" checked={on} readOnly aria-label="選択" />
                  <div className="pick-row__body">
                    <div className="pick-row__title">
                      <span className="badge badge-muted lk-type">{LINK_TARGET_LABEL[c.target_type]}</span>
                      <span className="pick-row__title-t">{c.title}</span>
                      {c.due ? <span className="badge badge-muted pick-row__due">⏳ {c.due}</span> : null}
                    </div>
                    {ctx ? <div className="pick-row__ctx">{ctx}</div> : null}
                  </div>
                  <a className="pick-row__open" href={openHref(c)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>🔍 開く</a>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor ? (
          <div className="pick-more-wrap">
            <button type="button" className="btn btn-outline btn-sm" onClick={loadMore} disabled={loading}>もっと見る</button>
          </div>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={sel.size === 0} onClick={() => onConfirm(Array.from(sel.values()))}>
          選択を確定{sel.size ? `（${sel.size}件）` : ""}
        </button>
      </ModalFooter>
    </Modal>
  );
}
