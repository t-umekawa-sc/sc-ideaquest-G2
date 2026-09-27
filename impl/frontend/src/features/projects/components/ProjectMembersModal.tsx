"use client";

// 開発メンバー管理（FR-43・Q.1b）＝クエスト「パーティー・権限を編集」（QuestPartyModal）と同一 UI に統一
// （フロントエンド実装フロー規約 §2.1c＝新規UIを作らない）。参加グループ Field＋共有 ProjectPartyPicker（.party 2カラム）を
// 作成ダイアログ（ProjectForm）と共用。唯一の適応＝メンバーごとを クエスト5権限→開発役割（lead/member）。試作＝保存はトースト。
import { useState } from "react";

import { Avatar, Field, Modal, ModalBody, ModalFooter, Multiselect, useSnackbar } from "@/components/ui";

import { PROJECT_GROUP_OPTIONS, ProjectPartyPicker, type PickedMember } from "./ProjectPartyPicker";
import type { ProjectMember, UserRef } from "../types";
import "@/features/quests/quests.css";

export function ProjectMembersModal({ members, innovation, onClose }: {
  members: ProjectMember[];
  innovation: UserRef[];
  onClose: () => void;
}) {
  const snack = useSnackbar();
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [devMembers, setDevMembers] = useState<PickedMember[]>(members.map((m) => ({ user: m.user, role: m.role })));
  const [candQuery, setCandQuery] = useState("");

  function save() {
    snack({ type: "success", title: "開発メンバーを更新しました", msg: "（試作＝接続時に POST/PATCH/DELETE /projects/{id}/members）" });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="開発メンバーを管理" size="xl">
      <ModalBody>
        <p className="role-note" style={{ marginTop: 0 }}>開発領域の担当者（会社内の任意ユーザー）。<strong>イノベーション担当（クエストパーティー）は参照＋チャット発言を継続</strong>できます。担当割当は開発メンバーに限ります。</p>

        {/* 参加グループ（アクセス条件）＝クエスト作成/編集の同 Field を踏襲（独立 Field＝Multiselect＋hint・§2.1c）。 */}
        <Field className="dialog-section is-quiet" id="pm_groups" label="参加グループ（アクセス条件・任意）" hint="会社のグループを複数選択できます。未選択（0件）なら全社が候補になります。開発メンバー候補の範囲を絞るために使います。">
          <Multiselect id="pm_groups" options={PROJECT_GROUP_OPTIONS} value={groupIds} onChange={setGroupIds} placeholder="グループを検索…（未選択なら全社）" ariaLabel="参加グループ（アクセス条件）" emptyText="該当するグループがありません" />
        </Field>

        {/* 参加メンバー（開発メンバー）・役割＝クエスト「参加メンバー（パーティー）・権限」を踏襲（.party 2カラム）。 */}
        <Field className="dialog-section is-quiet" id="pm_party" label="参加メンバー（開発メンバー）・役割">
          <ProjectPartyPicker groupIds={groupIds} members={devMembers} onMembers={setDevMembers} candQuery={candQuery} onCandQuery={setCandQuery} />
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
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary" onClick={save}>保存</button>
      </ModalFooter>
    </Modal>
  );
}
