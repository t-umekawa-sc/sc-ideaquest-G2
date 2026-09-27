"use client";

// 開発メンバー管理フォーム本体（FR-43・Q.1b）＝**モーダル content のみ**（Modal シェルは RouteModal/Panel が提供）。
// クエスト「パーティー・権限を編集」と同一 UI（.party 2カラム）。projectId で詳細（owner名）＋メンバーを取得し差分保存。
import { useEffect, useMemo, useState } from "react";

import { Avatar, Field, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
import { listCompanyGroupDirectory } from "@/features/quests/api";

import { addProjectMember, getProject, listProjectMembers, patchProjectMember, removeProjectMember } from "../api";
import { ProjectPartyPicker, type PickedMember } from "./ProjectPartyPicker";
import type { ProjectRole, UserRef } from "../types";
import "@/features/quests/quests.css";

export function ProjectMembersForm({ projectId, onDone, onCancel }: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const snack = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [ownerName, setOwnerName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | undefined>(undefined);
  const [devMembers, setDevMembers] = useState<PickedMember[]>([]);
  const [initial, setInitial] = useState<PickedMember[]>([]);
  const [innovation, setInnovation] = useState<UserRef[]>([]);
  const [allGroupIds, setAllGroupIds] = useState<string[]>([]);
  const [groupOpts, setGroupOpts] = useState<{ value: string; label: string }[]>([]);
  const groupNameById = useMemo(() => Object.fromEntries(groupOpts.map((g) => [g.value, g.label])), [groupOpts]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([getProject(projectId), listProjectMembers(projectId), listCompanyGroupDirectory()]).then(([p, m, dir]) => {
      if (!alive) return;
      setOwnerName(p?.owner?.display_name ?? ""); setOwnerUserId(p?.owner?.user_id);
      const picked = m.members.filter((x) => x.user).map((x) => ({ user: x.user!, role: x.role as ProjectRole }));
      setDevMembers(picked); setInitial(picked); setInnovation(m.innovation);
      const opts = (dir?.data ?? []).map((g) => ({ value: g.id, label: g.name }));
      setGroupOpts(opts); setAllGroupIds(opts.map((o) => o.value));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId]);

  async function save() {
    setSaving(true);
    const before = new Map(initial.map((m) => [m.user.user_id, m.role]));
    const after = new Map(devMembers.map((m) => [m.user.user_id, m.role]));
    try {
      for (const [uid] of before) if (!after.has(uid)) await removeProjectMember(projectId, uid);
      for (const [uid, role] of after) {
        if (!before.has(uid)) await addProjectMember(projectId, uid, role);
        else if (before.get(uid) !== role) await patchProjectMember(projectId, uid, role);
      }
      snack({ type: "success", title: "開発メンバーを更新しました" });
      onDone();
    } catch {
      setSaving(false);
      snack({ type: "error", title: "更新できませんでした", msg: "権限（起票者/owner）と入力をご確認ください。" });
    }
  }

  if (loading) return <ModalBody><p className="muted">読み込み中…</p></ModalBody>;

  return (
    <>
      <ModalBody>
        <p className="role-note" style={{ marginTop: 0 }}>開発領域の担当者（会社内の任意ユーザー）。<strong>イノベーション担当（クエストパーティー）は参照＋チャット発言を継続</strong>できます。担当割当は開発メンバーに限ります。</p>
        <Field className="dialog-section is-quiet" id="pm_party" label="参加メンバー（開発メンバー）・役割">
          <ProjectPartyPicker members={devMembers} onMembers={setDevMembers} ownerName={ownerName} ownerLabel="作成者" ownerUserId={ownerUserId} allGroupIds={allGroupIds} groupNameById={groupNameById} />
        </Field>
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
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onCancel}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>保存</button>
      </ModalFooter>
    </>
  );
}
