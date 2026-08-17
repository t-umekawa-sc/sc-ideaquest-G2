"use client";

// SC-90 QG管理者＝参加選択専任（B.4・SoD）。自分が admin のグループのメンバーを参加追加/除外するだけ。
// 認可は per-group（サーバー）。管理グループが無い（403）は「管理グループなし」を表示。
// メンバー一覧は DataTable（client モード）。§4.5⑪＝SC-90 メンバー行はクリック割当なし（onRowClick を渡さない）。
// ディレクトリ・ピッカー（メンバー追加モーダル）は最小射影の候補リスト＝簡易テーブルのまま（mock も同様）。
import { useCallback, useEffect, useState } from "react";

import { Avatar, Button, DataTable, Modal, ModalBody, ModalFooter, RowMenu } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
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

  // 列定義（正＝mocks/SC-90 のメンバー DataTable columns）。backend の MemberListItem は最小射影
  // （氏名・ロールのみ／ログインID・参加日は B.4 で非提供）＝実データの氏名＋グループ内ロールを表示。
  const columns: DataTableColumn<Member>[] = [
    {
      key: "name",
      label: "氏名",
      locked: true,
      width: 260,
      sortable: true,
      filter: { type: "text" },
      sortVal: (m) => m.display_name,
      searchVal: (m) => m.display_name,
      csvVal: (m) => m.display_name,
      render: (m) => (
        <span className="co">
          <Avatar name={m.display_name} size="sm" />
          <strong>{m.display_name}</strong>
        </span>
      ),
    },
    {
      key: "role",
      label: "グループ内ロール",
      width: 150,
      sortable: true,
      filter: {
        type: "enum",
        options: [
          ["admin", "管理者"],
          ["member", "メンバー"],
        ],
      },
      sortVal: (m) => m.role,
      filterVal: (m) => m.role,
      csvVal: (m) => (m.role === "admin" ? "管理者" : "メンバー"),
      render: (m) => (m.role === "admin" ? "管理者" : "メンバー"),
    },
    {
      key: "_actions",
      label: "",
      actions: true,
      locked: true,
      width: 80,
      render: (m) => (
        <RowMenu items={[{ label: "このグループから除外", danger: true, onClick: () => onRemove(m.account_id, m.display_name) }]} />
      ),
    },
  ];

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

      <DataTable<Member>
        storageKey="sc90-members"
        data={members}
        columns={columns}
        rowId={(m) => m.account_id}
        unit="名"
        perPage={5}
        perPageOptions={[5, 10, 20, 50]}
        searchFields="氏名"
        exportName="グループメンバー"
        emptyText="このグループの参加メンバーがいません。「＋ メンバー追加」から追加してください。"
        cardLayout={(m) => ({
          title: m.display_name,
          badges: [{ label: m.role === "admin" ? "管理者" : "メンバー" }],
        })}
      />
    </section>
  );
}
