"use client";

// 開発メンバー管理（FR-43・Q.1b）＝クエスト「パーティー・権限を編集」（QuestPartyModal）と同一 UI に統一
// （フロントエンド実装フロー規約 §2.1c＝新規UIを作らない）。参加グループ Field＋共有 ProjectPartyPicker（.party 2カラム）を
// 作成ダイアログ（ProjectForm）と共用。唯一の適応＝メンバーごとを クエスト5権限→開発役割（lead/member）。試作＝保存はトースト。
import { useState } from "react";

import { Avatar, Field, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";

import { addProjectMember, patchProjectMember, removeProjectMember } from "../api";
import { ProjectPartyPicker, type PickedMember } from "./ProjectPartyPicker";
import type { ProjectMember, ProjectRole, UserRef } from "../types";
import "@/features/quests/quests.css";

export function ProjectMembersModal({ projectId, members, innovation, ownerName, onClose, onSaved }: {
  projectId: string;
  members: ProjectMember[];
  innovation: UserRef[];
  ownerName: string;   // 所有者（作成者）＝固定 owner 行
  onClose: () => void;
  onSaved?: () => void;
}) {
  const snack = useSnackbar();
  const initial = members.filter((m) => m.user).map((m) => ({ user: m.user!, role: m.role as ProjectRole }));
  const [devMembers, setDevMembers] = useState<PickedMember[]>(initial);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);
  const requestClose = () => setOpen(false);

  async function save() {
    setSaving(true);
    const before = new Map(initial.map((m) => [m.user.user_id, m.role]));
    const after = new Map(devMembers.map((m) => [m.user.user_id, m.role]));
    try {
      for (const [uid] of before) {
        if (!after.has(uid)) await removeProjectMember(projectId, uid);
      }
      for (const [uid, role] of after) {
        if (!before.has(uid)) await addProjectMember(projectId, uid, role);
        else if (before.get(uid) !== role) await patchProjectMember(projectId, uid, role);
      }
      snack({ type: "success", title: "開発メンバーを更新しました" });
      onSaved?.();
      requestClose();
    } catch {
      setSaving(false);
      snack({ type: "error", title: "更新できませんでした", msg: "権限（起票者/owner）と入力をご確認ください。" });
    }
  }

  return (
    <Modal open={open} onClose={requestClose} onClosed={onClose} title="開発メンバーを管理" size="xl">
      <ModalBody>
        <p className="role-note" style={{ marginTop: 0 }}>開発領域の担当者（会社内の任意ユーザー）。<strong>イノベーション担当（クエストパーティー）は参照＋チャット発言を継続</strong>できます。担当割当は開発メンバーに限ります。</p>

        {/* 参加メンバー（開発メンバー）・役割＝クエスト「参加メンバー（パーティー）・権限」を踏襲（.party 2カラム・グループ/名前絞込は候補側に内包）。 */}
        <Field className="dialog-section is-quiet" id="pm_party" label="参加メンバー（開発メンバー）・役割">
          <ProjectPartyPicker members={devMembers} onMembers={setDevMembers} ownerName={ownerName} ownerLabel="作成者" />
        </Field>

        {/* イノベーション担当（読み取り専用・参照＋口出し可）＝クエストのパーティー行レイアウト踏襲。 */}
        <Field className="dialog-section is-quiet" id="pm_innov" label="イノベーション担当（参照＋口出し可）">
          <div className="card tab-party-card" style={{ padding: 0 }}>
            <ul className="member-list">
              {innovation.length === 0 ? (
                <li className="member-row"><span className="hint">イノベーション担当はいません（コンセプト非依存プロジェクト）。</span></li>
              ) : innovation.map((u) => (
                <li className="member-row" key={u.user_id}>
                  <Avatar name={u.display_name} imageUrl={u.avatar_image_url ?? undefined} />
                  <span className="member-name">{u.display_name}</span>
                  <span className="member-perms"><span className="badge badge-muted">イノベーション担当</span></span>
                </li>
              ))}
            </ul>
          </div>
        </Field>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline dialog-close-left" onClick={requestClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>保存</button>
      </ModalFooter>
    </Modal>
  );
}
