"use client";

// SC-90 QG管理者＝参加選択専任（B.4・SoD）。自分が admin のグループのメンバーを参加追加/除外するだけ。
// 認可は per-group（サーバー）。管理グループが無い（403）は「管理グループなし」を表示。
import { useCallback, useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalFooter } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { addMember, companyDirectory, listGroupMembers, listMyGroups, removeMember, type DirectoryEntry, type Member, type QuestGroup } from "../api";
import "@/features/companies/companies.css";

export function QuestGroupAdminView() {
  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [notAdmin, setNotAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [dirQuery, setDirQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);

  const loadGroups = useCallback(async () => {
    setError(null);
    try {
      const res = await listMyGroups();
      const data = res?.data ?? [];
      setGroups(data);
      setNotAdmin(false);
      setSelectedId((cur) => cur ?? data[0]?.group_id ?? null);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "forbidden" || err.status === 403)) {
        setNotAdmin(true);
        setGroups([]);
      } else {
        setError("グループの取得に失敗しました。");
      }
    }
  }, []);

  const loadMembers = useCallback(async (groupId: string) => {
    setError(null);
    try {
      const res = await listGroupMembers(groupId);
      setMembers(res?.data ?? []);
    } catch {
      setError("メンバーの取得に失敗しました。");
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (selectedId) void loadMembers(selectedId);
  }, [selectedId, loadMembers]);

  async function searchDirectory() {
    try {
      const res = await companyDirectory(dirQuery || undefined);
      setDirectory(res?.data ?? []);
    } catch {
      setError("ディレクトリの取得に失敗しました。");
    }
  }

  async function onAdd(accountId: string) {
    if (!selectedId) return;
    setError(null);
    try {
      await addMember(selectedId, accountId);
      await loadMembers(selectedId);
    } catch {
      setError("参加追加に失敗しました。");
    }
  }

  async function onRemove(accountId: string, name: string) {
    if (!selectedId) return;
    if (!window.confirm(`「${name}」をこのグループから除外しますか？`)) return;
    setError(null);
    try {
      await removeMember(selectedId, accountId);
      await loadMembers(selectedId);
    } catch {
      setError("除外に失敗しました。");
    }
  }

  if (notAdmin) {
    return (
      <section aria-label="クエストグループ管理">
        <h1>クエストグループ管理</h1>
        <p className="admin-muted">あなたが管理するクエストグループはありません（グループの `admin` 所属が必要です）。</p>
      </section>
    );
  }

  return (
    <section aria-label="クエストグループ管理">
      <h1>クエストグループ管理</h1>
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="admin-toolbar">
        <label>
          グループ{" "}
          <select className="input" value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.group_id} value={g.group_id}>{g.name}（{g.member_count}）</option>
            ))}
          </select>
        </label>
        <Button type="button" variant="primary" onClick={() => { setShowAdd(true); void searchDirectory(); }}>
          ＋ メンバー追加
        </Button>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="ディレクトリから参加追加" size="md">
        <ModalBody>
          <div className="admin-toolbar">
            <input className="input" placeholder="氏名・ログインIDで検索" value={dirQuery} onChange={(e) => setDirQuery(e.target.value)} />
            <Button type="button" onClick={() => void searchDirectory()}>検索</Button>
          </div>
          <table className="admin-table">
            <tbody>
              {directory.map((d) => (
                <tr key={d.account_id}>
                  <td>{d.display_name}</td>
                  <td><button type="button" onClick={() => onAdd(d.account_id)}>追加</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {directory.length === 0 && <p className="admin-muted">候補がありません。</p>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>閉じる</Button>
        </ModalFooter>
      </Modal>

      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">氏名</th>
            <th scope="col">グループ内ロール</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.account_id}>
              <td>{m.display_name}</td>
              <td>{m.role === "admin" ? "管理者" : "メンバー"}</td>
              <td><button type="button" className="is-danger" onClick={() => onRemove(m.account_id, m.display_name)}>除外</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {members.length === 0 && <p className="admin-muted">メンバーがいません。</p>}
    </section>
  );
}
