"use client";

// 開発メンバー選択ピッカー（FR-43・Q.1b）＝クエスト作成/編集の「参加メンバー（パーティー）・権限」エディタ
// （QuestForm の .party 2カラム）を忠実に踏襲（フロントエンド実装フロー規約 §2.1c＝新規UIを作らない）。
// 唯一の適応＝メンバーごとの「権限チップ」を開発役割（lead/member）の**排他ボタン**に差し替え。
// 参加グループは独立 Field にせず候補側の「グループで絞込」に内包（ユーザー要望 2026-09-27）。試作＝候補は会社ディレクトリのデモ。
import { useMemo, useState } from "react";

import { Multiselect } from "@/components/ui";
import type { MultiselectOption } from "@/components/ui";

import type { ProjectRole, UserRef } from "../types";
import "@/features/quests/quests.css";

export type PickedMember = { user: UserRef; role: ProjectRole };

// 参加グループの選択肢（試作／接続時は B ディレクトリのグループへ）。
export const PROJECT_GROUP_OPTIONS: MultiselectOption[] = [
  { value: "g-dev", label: "開発部" },
  { value: "g-plan", label: "企画部" },
  { value: "g-qa", label: "QA部" },
];
const GROUP_NAME: Record<string, string> = Object.fromEntries(PROJECT_GROUP_OPTIONS.map((g) => [g.value, g.label]));

// 会社ディレクトリ（試作・接続時は B のディレクトリ read＋グループ絞込へ）。
const DIRECTORY: (UserRef & { group_ids: string[] })[] = [
  { user_id: "u-dev1", display_name: "田中（開発リード）", avatar_image_url: null, group_ids: ["g-dev"] },
  { user_id: "u-dev2", display_name: "佐藤（開発）", avatar_image_url: null, group_ids: ["g-dev"] },
  { user_id: "u-dev3", display_name: "山本（開発）", avatar_image_url: null, group_ids: ["g-dev"] },
  { user_id: "u-dev4", display_name: "中村（開発）", avatar_image_url: null, group_ids: ["g-dev", "g-qa"] },
  { user_id: "u-qa1", display_name: "小林（QA）", avatar_image_url: null, group_ids: ["g-qa"] },
  { user_id: "u-plan1", display_name: "鈴木（企画）", avatar_image_url: null, group_ids: ["g-plan"] },
];
const groupsOf = (userId: string): string[] => DIRECTORY.find((u) => u.user_id === userId)?.group_ids ?? [];
const initialOf = (name: string) => name.trim().charAt(0) || "?";

const ROLES: [ProjectRole, string][] = [["lead", "リード"], ["member", "担当"]];

export function ProjectPartyPicker({ members, onMembers, ownerName, ownerLabel = "あなた・作成者", groupFilter: groupFilterProp, onGroupFilter }: {
  members: PickedMember[];
  onMembers: (v: PickedMember[]) => void;
  ownerName: string;      // 作成者＝所有者（固定・外せない・常にリード）＝QuestForm の owner 行を踏襲（§2.1c）
  ownerLabel?: string;    // バッジ文言（作成時「あなた・作成者」／編集時「作成者」）
  // 参加グループ（アクセス条件）を上位 Field で持つ場合は controlled（候補側の内蔵コンボは隠す）。
  groupFilter?: string[];
  onGroupFilter?: (v: string[]) => void;
}) {
  const controlledGroup = groupFilterProp !== undefined;
  const [groupFilterState, setGroupFilterState] = useState<string[]>([]);
  const groupFilter = controlledGroup ? groupFilterProp! : groupFilterState;
  const setGroupFilter = controlledGroup ? (onGroupFilter ?? (() => {})) : setGroupFilterState;
  const [candQuery, setCandQuery] = useState("");
  const [selQuery, setSelQuery] = useState("");
  const [outOnly, setOutOnly] = useState(false);

  const selectedIds = useMemo(() => new Set(members.map((m) => m.user.user_id)), [members]);

  // 候補＝グループで絞る（未選択＝全社）＋名前絞込＋追加済み除外。
  const candidates = DIRECTORY.filter((u) => {
    if (selectedIds.has(u.user_id)) return false;
    if (groupFilter.length && !u.group_ids.some((g) => groupFilter.includes(g))) return false;
    if (candQuery.trim() && !u.display_name.includes(candQuery.trim())) return false;
    return true;
  });

  // 選択中＝グループ外（＝グループ絞込を指定した時、そのグループに属さない）を判定。
  const isOut = (m: PickedMember) => groupFilter.length > 0 && !groupsOf(m.user.user_id).some((g) => groupFilter.includes(g));
  const filteredSelected = members.filter((m) => {
    if (selQuery.trim() && !m.user.display_name.includes(selQuery.trim())) return false;
    if (outOnly && !isOut(m)) return false;
    return true;
  });
  const outCount = members.filter(isOut).length;

  function add(u: UserRef) { onMembers([...members, { user: u, role: "member" }]); }
  function addAllShown() { onMembers([...members, ...candidates.map((c) => ({ user: c as UserRef, role: "member" as ProjectRole }))]); }
  function remove(id: string) { onMembers(members.filter((m) => m.user.user_id !== id)); }
  function setRole(id: string, role: ProjectRole) { onMembers(members.map((m) => (m.user.user_id === id ? { ...m, role } : m))); }
  function bulkRemove() {
    const ids = new Set(filteredSelected.map((m) => m.user.user_id));
    onMembers(members.filter((m) => !ids.has(m.user.user_id)));
  }

  return (
    <div className="party">
      <div className="party__cols">
        {/* 候補追加（左カラム）＝グループで絞込＋名前絞込＋表示中を全員追加＋候補リスト */}
        <div className="party__col">
          <div className="party__head">
            <strong>メンバーを追加</strong>
            <span className="party__count">候補から選ぶ</span>
          </div>
          <div className="party__add">
            {/* 参加グループを上位 Field で持つ場合（controlled）は候補側の内蔵コンボを出さない（重複回避）。 */}
            {!controlledGroup && (
              <div style={{ marginBottom: "var(--space-2)" }}>
                <Multiselect id="pp_cand_group" options={PROJECT_GROUP_OPTIONS} value={groupFilter} onChange={setGroupFilter} placeholder="グループで絞込…（未選択＝全社）" ariaLabel="候補をグループで絞り込み" emptyText="該当するグループがありません" />
              </div>
            )}
            <input className="input" placeholder="名前で絞り込み…" value={candQuery} onChange={(e) => setCandQuery(e.target.value)} aria-label="候補を名前で絞り込み" />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
              <button type="button" className="btn btn-sm btn-outline" disabled={candidates.length === 0} onClick={addAllShown}>表示中を全員追加（{candidates.length}）</button>
            </div>
            <div className="party__candmeta">候補（表示中）{candidates.length} 名</div>
            <div className="candlist">
              {candidates.map((c) => (
                <button key={c.user_id} className="cand" type="button" onClick={() => add(c)}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{initialOf(c.display_name)}</span></span>
                  <span className="cand__name">{c.display_name}</span>
                  {c.group_ids.length > 0 && <span className="pmember__depts">{c.group_ids.map((g) => <span key={g} className="badge badge-muted">{GROUP_NAME[g] ?? g}</span>)}</span>}
                  <span className="cand__plus" aria-hidden>＋</span>
                </button>
              ))}
              {candidates.length === 0 && <span className="hint">{candQuery ? "一致する候補がいません。" : "追加できる候補がいません（全員追加済み、または該当者がいません）。"}</span>}
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
            {/* 作成者＝所有者（固定・外せない・常にリード）＝QuestForm の owner 行を踏襲（§2.1c）。 */}
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
              const gids = groupsOf(m.user.user_id);
              const out = isOut(m);
              return (
                <div className="pmember" key={m.user.user_id} data-out-of-scope={out ? "1" : undefined} style={out ? { opacity: 0.62 } : undefined}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{initialOf(m.user.display_name)}</span></span>
                  <div className="pmember__main">
                    <div className="pmember__top">
                      <span className="pmember__name">{m.user.display_name}</span>
                      {out && <span className="badge badge-danger" title="選択中のグループに属していません">グループ外・失効中</span>}
                    </div>
                    {gids.length > 0 && <div className="pmember__depts">{gids.map((g) => <span key={g} className="badge badge-muted">{GROUP_NAME[g] ?? g}</span>)}</div>}
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
    </div>
  );
}
