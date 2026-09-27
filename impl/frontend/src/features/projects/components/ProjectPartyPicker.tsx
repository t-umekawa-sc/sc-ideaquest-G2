"use client";

// 開発メンバー選択ピッカー（FR-43・Q.1b）＝クエスト「参加メンバー（パーティー）・権限」エディタ（.party 2カラム）を踏襲。
// 候補は**実データ＝会社ディレクトリ**（quest_group_directory／quest-group-candidates を再利用）。役割は開発役割（lead/member）。
// 参加グループ（アクセス条件）は上位 Field で controlled（groupFilter）＝候補スコープ＋グループ外マーキング。
import { useEffect, useMemo, useState } from "react";

import { listQuestGroupCandidates } from "@/features/quests/api";
import type { QuestCandidate } from "@/features/quests/api";

import type { ProjectRole, UserRef } from "../types";
import "@/features/quests/quests.css";

// PickedMember に group_ids を持たせ、参加グループ絞込時の「グループ外」判定に使う（候補から追加時に付与）。
export type PickedMember = { user: UserRef; role: ProjectRole; groupIds?: string[] };

const initialOf = (name: string) => name.trim().charAt(0) || "?";
const ROLES: [ProjectRole, string][] = [["lead", "リード"], ["member", "担当"]];
const PAGE = 50;

export function ProjectPartyPicker({ members, onMembers, ownerName, ownerLabel = "あなた・作成者", ownerUserId, groupFilter, onGroupFilter, allGroupIds = [], groupNameById = {} }: {
  members: PickedMember[];
  onMembers: (v: PickedMember[]) => void;
  ownerName: string;      // 作成者＝所有者（固定・外せない・常にリード）
  ownerLabel?: string;
  ownerUserId?: string;   // 候補から除外（作成者は別途固定行）
  // 参加グループ（アクセス条件）を上位 Field で持つ（controlled）。allGroupIds＝未選択時の候補スコープ（全社）。
  groupFilter?: string[];
  onGroupFilter?: (v: string[]) => void;
  allGroupIds?: string[];
  groupNameById?: Record<string, string>;
}) {
  const controlledGroup = groupFilter !== undefined;
  const [groupFilterState] = useState<string[]>([]);
  const groups = controlledGroup ? groupFilter! : groupFilterState;

  const [candQuery, setCandQuery] = useState("");
  const [selQuery, setSelQuery] = useState("");
  const [outOnly, setOutOnly] = useState(false);
  const [candidates, setCandidates] = useState<QuestCandidate[]>([]);
  const [loadingCands, setLoadingCands] = useState(false);

  const selectedIds = useMemo(() => new Set(members.map((m) => m.user.user_id)), [members]);
  const excludeIds = useMemo(() => [...members.map((m) => m.user.user_id), ...(ownerUserId ? [ownerUserId] : [])], [members, ownerUserId]);

  // 候補＝実 API（横断候補）。参加グループ未選択なら全社（allGroupIds）を対象に。名前絞込＝サーバー q。
  useEffect(() => {
    const scope = groups.length ? groups : allGroupIds;
    if (scope.length === 0) { setCandidates([]); return; }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setLoadingCands(true);
      listQuestGroupCandidates(scope, { q: candQuery.trim() || undefined, exclude_user_ids: excludeIds, limit: PAGE })
        .then((r) => setCandidates(r?.data ?? []))
        .catch(() => { /* 中断/失敗は無視 */ })
        .finally(() => setLoadingCands(false));
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [groups, allGroupIds, candQuery, excludeIds]);

  // group_ids が判っているメンバー（候補から追加）だけ判定＝取得済みメンバー（groupIds 不明）は誤って「グループ外」にしない。
  const isOut = (m: PickedMember) => groups.length > 0 && m.groupIds !== undefined && !m.groupIds.some((g) => groups.includes(g));
  const filteredSelected = members.filter((m) => {
    if (selQuery.trim() && !m.user.display_name.includes(selQuery.trim())) return false;
    if (outOnly && !isOut(m)) return false;
    return true;
  });
  const outCount = members.filter(isOut).length;

  function add(c: QuestCandidate) { onMembers([...members, { user: { user_id: c.user_id, display_name: c.display_name, avatar_image_url: c.avatar_image_url ?? null }, role: "member", groupIds: c.group_ids }]); }
  function addAllShown() { onMembers([...members, ...candidates.map((c) => ({ user: { user_id: c.user_id, display_name: c.display_name, avatar_image_url: c.avatar_image_url ?? null }, role: "member" as ProjectRole, groupIds: c.group_ids }))]); }
  function remove(id: string) { onMembers(members.filter((m) => m.user.user_id !== id)); }
  function setRole(id: string, role: ProjectRole) { onMembers(members.map((m) => (m.user.user_id === id ? { ...m, role } : m))); }
  function bulkRemove() {
    const ids = new Set(filteredSelected.map((m) => m.user.user_id));
    onMembers(members.filter((m) => !ids.has(m.user.user_id)));
  }
  const groupLabels = (ids: string[]) => ids.map((g) => groupNameById[g]).filter(Boolean);

  return (
    <div className="party">
      <div className="party__cols">
        {/* 候補追加（左カラム）＝名前絞込＋表示中を全員追加＋候補リスト（グループは上位 Field で絞る）。 */}
        <div className="party__col">
          <div className="party__head">
            <strong>メンバーを追加</strong>
            <span className="party__count">候補から選ぶ</span>
          </div>
          <div className="party__add">
            <input className="input" placeholder="名前で絞り込み…" value={candQuery} onChange={(e) => setCandQuery(e.target.value)} aria-label="候補を名前で絞り込み" />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
              <button type="button" className="btn btn-sm btn-outline" disabled={candidates.length === 0} onClick={addAllShown}>表示中を全員追加（{candidates.length}）</button>
            </div>
            <div className="party__candmeta">候補（表示中）{loadingCands ? "…" : candidates.length} 名{candidates.length >= PAGE ? "（先頭のみ・グループ/名前で絞込）" : ""}</div>
            <div className="candlist">
              {candidates.map((c) => (
                <button key={c.user_id} className="cand" type="button" onClick={() => add(c)}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{initialOf(c.display_name)}</span></span>
                  <span className="cand__name">{c.display_name}</span>
                  {groupLabels(c.group_ids).length > 0 && <span className="pmember__depts">{groupLabels(c.group_ids).map((g) => <span key={g} className="badge badge-muted">{g}</span>)}</span>}
                  <span className="cand__plus" aria-hidden>＋</span>
                </button>
              ))}
              {candidates.length === 0 && !loadingCands && <span className="hint">{candQuery ? "一致する候補がいません。" : "追加できる候補がいません（全員追加済み、または該当者がいません）。"}</span>}
            </div>
            <div className="hint">追加すると既定は「担当」。リードは選択中で切り替え。担当割当は開発メンバーに限ります。</div>
          </div>
        </div>

        {/* 選択中（右カラム）＝名前絞込＋グループ外のみ＋すべて外す＋役割ボタン */}
        <div className="party__col">
          <div className="party__head">
            <strong>選択中の開発メンバー</strong>
            <span className="party__count">{members.length + 1} 名</span>
          </div>
          {members.length > 0 && (
            <div className="party__add" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <input className="input" placeholder="選択中を絞り込み（名前）" value={selQuery} onChange={(e) => setSelQuery(e.target.value)} aria-label="選択中のメンバーを名前で絞り込み" />
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <button type="button" className={`btn btn-sm ${outOnly ? "btn-danger" : "btn-outline"}`} aria-pressed={outOnly} disabled={outCount === 0} onClick={() => setOutOnly((v) => !v)}>グループ外・失効中のみ{outCount > 0 ? `（${outCount}）` : ""}</button>
                <button type="button" className="btn btn-sm btn-danger" disabled={filteredSelected.length === 0} onClick={bulkRemove}>
                  {selQuery.trim() || outOnly ? `絞り込み対象をまとめて外す（${filteredSelected.length}）` : `すべて外す（${filteredSelected.length}）`}
                </button>
              </div>
            </div>
          )}
          <div className="party__list">
            {/* 作成者＝所有者（固定・外せない・常にリード）＝QuestForm の owner 行を踏襲。 */}
            <div className="pmember">
              <span className="avatar sm"><span className="avatar__img placeholder">{initialOf(ownerName)}</span></span>
              <div className="pmember__main">
                <div className="pmember__top">
                  <span className="pmember__name">{ownerName}</span>
                  <span className="badge badge-muted">{ownerLabel}</span>
                </div>
                <div className="pmember__perms">
                  <span className="perm perm-owner is-on" aria-disabled="true" title="作成者は既定で所有者・開発リード（剥奪不可）">所有者</span>
                  <span className="perm is-on" aria-disabled="true">リード</span>
                </div>
              </div>
            </div>
            {members.length === 0 ? (
              <p className="hint" style={{ margin: 0, padding: "var(--space-3)" }}>ほかに開発メンバーはいません。左の候補から追加できます。</p>
            ) : filteredSelected.map((m) => {
              const gids = m.groupIds ?? [];
              const out = isOut(m);
              return (
                <div className="pmember" key={m.user.user_id} data-out-of-scope={out ? "1" : undefined} style={out ? { opacity: 0.62 } : undefined}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{initialOf(m.user.display_name)}</span></span>
                  <div className="pmember__main">
                    <div className="pmember__top">
                      <span className="pmember__name">{m.user.display_name}</span>
                      {out && <span className="badge badge-danger" title="選択中のグループに属していません">グループ外・失効中</span>}
                    </div>
                    {groupLabels(gids).length > 0 && <div className="pmember__depts">{groupLabels(gids).map((g) => <span key={g} className="badge badge-muted">{g}</span>)}</div>}
                    <div className="pmember__perms">
                      {ROLES.map(([r, label]) => (
                        <span key={r} role="button" tabIndex={0} className={`perm${m.role === r ? " is-on" : ""}`}
                          onClick={() => setRole(m.user.user_id, r)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRole(m.user.user_id, r); } }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="pmember__remove" aria-label={`${m.user.display_name} を外す`} onClick={() => remove(m.user.user_id)}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {onGroupFilter && null /* グループ選択は上位 Field（ProjectForm）が保持＝controlled */}
    </div>
  );
}
