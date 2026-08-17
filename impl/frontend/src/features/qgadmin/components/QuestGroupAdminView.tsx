"use client";

// SC-90 QG管理者＝参加選択専任（B.4・SoD）。自分が admin のグループのメンバーを参加追加/除外するだけ。
// 認可は per-group（サーバー）。管理グループが無い（403）は「管理グループなし」を表示。
// メンバー一覧は DataTable（client モード）。§4.5⑪＝SC-90 メンバー行はクリック割当なし（onRowClick を渡さない）。
// ディレクトリ・ピッカー（メンバー追加モーダル）は最小射影の候補リスト＝簡易テーブルのまま（mock も同様）。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Avatar, Button, DataTable, Modal, ModalBody, ModalFooter, RowMenu } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { addMember, companyDirectory, listGroupMembers, listMyGroups, removeMember, type DirectoryEntry, type Member, type QuestGroup } from "../api";
import "@/features/companies/companies.css";
import "../qgadmin.css";

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

  const fetchDirectory = useCallback(async () => {
    try {
      const res = await companyDirectory(dirQuery || undefined);
      setDirectory(res?.data ?? []);
    } catch {
      setError("ディレクトリの取得に失敗しました。");
    }
  }, [dirQuery]);

  // ディレクトリはライブ検索（モック SC-90 準拠＝入力で即絞込・250ms デバウンス）。モーダルを開いた時も取得。
  useEffect(() => {
    if (!showAdd) return;
    const t = setTimeout(() => void fetchDirectory(), 250);
    return () => clearTimeout(t);
  }, [showAdd, fetchDirectory]);

  async function onAdd(accountId: string) {
    if (!selectedId) return;
    setError(null);
    try {
      await addMember(selectedId, accountId);
      await loadMembers(selectedId);
      void fetchDirectory(); // 追加済みは候補から消す（モック挙動）
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
        <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
        <h1 className="page-title">クエストグループ管理</h1>
        <p className="admin-sub">あなたが管理するクエストグループはありません（グループの管理者〔admin〕所属が必要です）。</p>
      </section>
    );
  }

  const selectedGroup = groups.find((g) => g.group_id === selectedId) ?? null;

  return (
    <section aria-label="クエストグループ管理">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="page-title">クエストグループ管理</h1>
      <p className="admin-sub">
        あなたが管理するクエストグループの<strong>参加メンバーを追加・除外</strong>できます。
        （アカウントの発行・無効化・パスワード再設定は<strong>会社アカウント管理者</strong>の担当です）
      </p>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="group-bar">
        <span className="group-bar__label">管理グループ:</span>
        <select
          className="select"
          style={{ width: "auto" }}
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {groups.map((g) => (
            <option key={g.group_id} value={g.group_id}>{g.name}（{g.member_count}）</option>
          ))}
        </select>
      </div>

      <div className="section-head">
        <h2>参加メンバー</h2>
        <Button type="button" variant="primary" onClick={() => setShowAdd(true)}>
          ＋ メンバーを追加
        </Button>
      </div>

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
        emptyText="このグループの参加メンバーがいません。「＋ メンバーを追加」から追加してください。"
        cardLayout={(m) => ({
          title: m.display_name,
          badges: [{ label: m.role === "admin" ? "管理者" : "メンバー" }],
        })}
      />

      <p className="role-note">
        この画面は<strong>参加メンバーの管理（追加・除外）専用</strong>です。会社の一覧から既存アカウントを選び、あなたが管理するグループに追加・除外します。除外しても、アカウント本体・他グループの所属・これまでの入力（アイデア／投票／評価／コメント）は残ります。（アカウントの発行・無効化・ログインID／メール編集・パスワード再設定は管理者が行います）
      </p>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="メンバーを追加" size="md">
        <ModalBody>
          <div className="form-row">
            <label>追加先グループ</label>
            <div className="form-note">
              {selectedGroup ? `${selectedGroup.name}（あなたが管理するグループ・参加ロールはメンバー固定）` : "—"}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="dir_search">会社ディレクトリを検索</label>
            <input
              id="dir_search"
              className="input"
              type="search"
              placeholder="氏名・ログインIDで検索"
              value={dirQuery}
              onChange={(e) => setDirQuery(e.target.value)}
            />
            <div className="hint">
              自社の有効アカウントから選択。既にこのグループに参加中の人は表示されません。氏名・アバターのみ表示（メール・ロール・他グループ所属は非開示）。
            </div>
          </div>
          <div className="dir-list">
            {directory.map((d) => (
              <div className="dir-row" key={d.account_id}>
                <Avatar name={d.display_name} size="sm" />
                <span className="dir-row__name">{d.display_name}</span>
                <Button type="button" variant="primary" onClick={() => onAdd(d.account_id)}>追加</Button>
              </div>
            ))}
          </div>
          {directory.length === 0 && (
            <div className="list-empty">
              候補がありません。未発行の場合は<strong>会社アカウント管理者</strong>へ発行を依頼してください。
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>閉じる</Button>
        </ModalFooter>
      </Modal>
    </section>
  );
}
