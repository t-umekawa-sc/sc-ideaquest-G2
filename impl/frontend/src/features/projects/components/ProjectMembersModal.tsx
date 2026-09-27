"use client";

// 開発メンバー管理（FR-43・Q.1b）＝SC-12「パーティー・権限を編集」エディタ（QuestForm partyOnly）を踏襲
// （候補追加＋選択中一覧・フロントエンド実装フロー規約 §2.1c）。唯一の適応＝メンバーごとのコントロールを
// クエスト5権限チェック→開発役割（lead/member）に差し替え。試作＝保存はデモ（トーストのみ）。
import { useMemo, useState } from "react";

import { Avatar, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";

import type { ProjectMember, ProjectRole, UserRef } from "../types";

// 会社ディレクトリ候補（試作・接続時は B のディレクトリ read を流用）。
const DEMO_DIRECTORY: UserRef[] = [
  { user_id: "u-dev3", display_name: "山本（開発）", avatar_image_url: null },
  { user_id: "u-dev4", display_name: "中村（開発）", avatar_image_url: null },
  { user_id: "u-dev5", display_name: "小林（QA）", avatar_image_url: null },
];

const ROLE_LABEL: Record<ProjectRole, string> = { lead: "リード", member: "担当" };

export function ProjectMembersModal({ members, innovation, onClose }: {
  members: ProjectMember[];
  innovation: UserRef[];
  onClose: () => void;
}) {
  const snack = useSnackbar();
  const [rows, setRows] = useState<ProjectMember[]>(members);
  const [query, setQuery] = useState("");

  const selectedIds = useMemo(() => new Set(rows.map((r) => r.user.user_id)), [rows]);
  const candidates = DEMO_DIRECTORY.filter((u) => !selectedIds.has(u.user_id) && (!query.trim() || u.display_name.includes(query.trim())));

  function add(u: UserRef) { setRows((r) => [...r, { user: u, role: "member", added_at: "" }]); }
  function remove(id: string) { setRows((r) => r.filter((x) => x.user.user_id !== id)); }
  function setRole(id: string, role: ProjectRole) { setRows((r) => r.map((x) => (x.user.user_id === id ? { ...x, role } : x))); }
  function saveMembers() { snack({ type: "success", title: "開発メンバーを更新しました", msg: "（試作＝接続時に POST/PATCH/DELETE /projects/{id}/members）" }); onClose(); }

  return (
    <Modal open onClose={onClose} title="開発メンバーを管理" size="lg">
      <ModalBody>
        <p className="role-note" style={{ marginTop: 0 }}>開発領域の担当者（会社内の任意ユーザー）。<strong>イノベーション担当（クエストパーティー）は参照＋チャット発言を継続</strong>できます。担当割当は開発メンバーに限ります。</p>

        <div className="pmembers-editor">
          {/* 候補追加（クエストのパーティーエディタ踏襲＝左＝候補から選ぶ） */}
          <div className="pmembers-col">
            <div className="party__count">候補から選ぶ</div>
            <input className="input" placeholder="名前で絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="候補を名前で絞り込み" />
            <ul className="pmember-list" style={{ marginTop: 8 }}>
              {candidates.length === 0 ? <li className="hint">追加できる候補がいません。</li> : candidates.map((u) => (
                <li key={u.user_id} className="pmember">
                  <Avatar name={u.display_name} imageUrl={u.avatar_image_url} size="sm" noTooltip />
                  <span className="pmember__name">{u.display_name}</span>
                  <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => add(u)}>＋ 追加</button>
                </li>
              ))}
            </ul>
            <p className="hint">追加すると既定は「担当（member）」。リードは個別に切り替え。</p>
          </div>

          {/* 選択中の開発メンバー（踏襲＝右＝選択中一覧・役割コントロール） */}
          <div className="pmembers-col">
            <strong>開発メンバー</strong>
            <ul className="pmember-list" style={{ marginTop: 8 }}>
              {rows.length === 0 ? <li className="hint">まだ開発メンバーがいません。</li> : rows.map((m) => (
                <li key={m.user.user_id} className="pmember">
                  <Avatar name={m.user.display_name} imageUrl={m.user.avatar_image_url} size="sm" noTooltip />
                  <span className="pmember__name">{m.user.display_name}</span>
                  <span className="pmember__perms">
                    <select className="select select-sm" value={m.role} onChange={(e) => setRole(m.user.user_id, e.target.value as ProjectRole)} aria-label={`${m.user.display_name} の役割`}>
                      {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    <button type="button" className="btn btn-outline btn-danger btn-sm" onClick={() => remove(m.user.user_id)}>外す</button>
                  </span>
                </li>
              ))}
            </ul>

            <strong style={{ marginTop: 12, display: "block" }}>イノベーション担当（参照＋口出し可）</strong>
            <ul className="pmember-list" style={{ marginTop: 8 }}>
              {innovation.map((u) => (
                <li key={u.user_id} className="pmember pmember--readonly">
                  <Avatar name={u.display_name} imageUrl={u.avatar_image_url} size="sm" noTooltip />
                  <span className="pmember__name">{u.display_name}</span>
                  <span className="badge badge-muted" style={{ marginLeft: "auto" }}>イノベーション</span>
                </li>
              ))}
            </ul>
            <p className="hint">＝由来クエストのパーティー。開発メンバーでなくても参照・チャット発言が可能。</p>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" onClick={saveMembers}>保存</button>
      </ModalFooter>
    </Modal>
  );
}
