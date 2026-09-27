"use client";

// 開発メンバー選択ピッカー（FR-43・Q.1b）＝クエスト作成/編集の「参加グループ」＋「参加メンバー（パーティー）・権限」
// エディタ（QuestForm）を踏襲（フロントエンド実装フロー規約 §2.1c＝新規UIを作らない・.party/.candlist/.pmember クラス再利用）。
// 唯一の適応＝メンバーごとのコントロールをクエスト5権限→開発役割（lead/member）に差し替え。試作＝候補は会社ディレクトリのデモ。
import { useMemo } from "react";

import type { MultiselectOption } from "@/components/ui";

import type { ProjectRole, UserRef } from "../types";
import "@/features/quests/quests.css";

export type PickedMember = { user: UserRef; role: ProjectRole };

// 参加グループの選択肢（ProjectForm の「参加グループ」Field から共有・試作／接続時は B ディレクトリのグループへ）。
export const PROJECT_GROUP_OPTIONS: MultiselectOption[] = [
  { value: "g-dev", label: "開発部" },
  { value: "g-plan", label: "企画部" },
  { value: "g-qa", label: "QA部" },
];
const GROUPS = PROJECT_GROUP_OPTIONS;
const DIRECTORY: (UserRef & { group_ids: string[] })[] = [
  { user_id: "u-dev1", display_name: "田中（開発リード）", avatar_image_url: null, group_ids: ["g-dev"] },
  { user_id: "u-dev2", display_name: "佐藤（開発）", avatar_image_url: null, group_ids: ["g-dev"] },
  { user_id: "u-dev3", display_name: "山本（開発）", avatar_image_url: null, group_ids: ["g-dev"] },
  { user_id: "u-dev4", display_name: "中村（開発）", avatar_image_url: null, group_ids: ["g-dev", "g-qa"] },
  { user_id: "u-qa1", display_name: "小林（QA）", avatar_image_url: null, group_ids: ["g-qa"] },
  { user_id: "u-plan1", display_name: "鈴木（企画）", avatar_image_url: null, group_ids: ["g-plan"] },
];

const ROLE_LABEL: Record<ProjectRole, string> = { lead: "リード", member: "担当" };

export function ProjectPartyPicker({ groupIds, members, onMembers, candQuery, onCandQuery }: {
  groupIds: string[];
  members: PickedMember[];
  onMembers: (v: PickedMember[]) => void;
  candQuery: string;
  onCandQuery: (v: string) => void;
}) {
  const selectedIds = useMemo(() => new Set(members.map((m) => m.user.user_id)), [members]);

  // 候補＝参加グループで絞る（未選択＝全社）＋名前絞込＋追加済み除外（QuestForm と同じ考え方）。
  const candidates = DIRECTORY.filter((u) => {
    if (selectedIds.has(u.user_id)) return false;
    if (groupIds.length && !u.group_ids.some((g) => groupIds.includes(g))) return false;
    if (candQuery.trim() && !u.display_name.includes(candQuery.trim())) return false;
    return true;
  });

  function add(u: UserRef) { onMembers([...members, { user: u, role: "member" }]); }
  function remove(id: string) { onMembers(members.filter((m) => m.user.user_id !== id)); }
  function setRole(id: string, role: ProjectRole) { onMembers(members.map((m) => (m.user.user_id === id ? { ...m, role } : m))); }
  const groupNameById = Object.fromEntries(GROUPS.map((g) => [g.value, g.label]));

  return (
    <div className="party">
      {/* 参加グループ（候補の範囲）＝クエストの「参加グループ（アクセス条件）」踏襲 */}
      <div className="party__scope">
        <span className="party__scope-label">参加グループ（候補の範囲）:</span>
        {groupIds.length === 0 ? (
          <>
            <span className="party__scope-all">全社（未指定）</span>
            <span className="party__scope-note">＝会社全体が候補</span>
          </>
        ) : (
          <>
            {groupIds.map((id) => <span key={id} className="party__scope-chip">{groupNameById[id] ?? id}</span>)}
            <span className="party__scope-note">候補はこのグループの所属者に限定</span>
          </>
        )}
      </div>

      <div className="party__cols">
        {/* 候補追加（左カラム） */}
        <div className="party__col">
          <div className="party__head">
            <strong>メンバーを追加</strong>
            <span className="party__count">候補から選ぶ</span>
          </div>
          <div className="party__add">
            <input className="input" placeholder="名前で絞り込み…" value={candQuery} onChange={(e) => onCandQuery(e.target.value)} aria-label="候補を名前で絞り込み" />
            <div className="party__candmeta">候補（表示中）{candidates.length} 名</div>
            <div className="candlist">
              {candidates.map((c) => (
                <button key={c.user_id} className="cand" type="button" onClick={() => add(c)}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{c.display_name.trim().charAt(0) || "?"}</span></span>
                  <span className="cand__name">{c.display_name}</span>
                  <span className="cand__plus" aria-hidden>＋</span>
                </button>
              ))}
              {candidates.length === 0 && <span className="hint">{candQuery ? "一致する候補がいません。" : "追加できる候補がいません（全員追加済み、または該当者がいません）。"}</span>}
            </div>
            <div className="hint">追加すると既定は「担当（member）」。リードは選択中で切り替え。担当割当は開発メンバーに限ります。</div>
          </div>
        </div>

        {/* 選択中の開発メンバー（右カラム）＝役割コントロール */}
        <div className="party__col">
          <div className="party__head">
            <strong>選択中の開発メンバー</strong>
            <span className="party__count">{members.length} 名</span>
          </div>
          <div className="party__list">
            {members.length === 0 ? (
              <p className="hint" style={{ margin: 0, padding: "var(--space-3)" }}>まだ開発メンバーがいません。左の候補から追加してください。</p>
            ) : members.map((m) => (
              <div className="pmember" key={m.user.user_id}>
                <span className="avatar sm"><span className="avatar__img placeholder">{m.user.display_name.trim().charAt(0) || "?"}</span></span>
                <div className="pmember__main">
                  <div className="pmember__top">
                    <span className="pmember__name">{m.user.display_name}</span>
                  </div>
                  <div className="pmember__perms">
                    <select className="select select-sm" value={m.role} onChange={(e) => setRole(m.user.user_id, e.target.value as ProjectRole)} aria-label={`${m.user.display_name} の役割`}>
                      {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    <button type="button" className="pmember__remove btn btn-outline btn-danger btn-sm" onClick={() => remove(m.user.user_id)}>外す</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
