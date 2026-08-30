"use client";

// SC-90 QG管理者＝参加選択専任（B.4・SoD）。自分が admin のグループのメンバーを参加追加/除外するだけ。
// 認可は per-group（サーバー）。管理グループが無い（403）は「管理グループなし」を表示。
// メンバー一覧は DataTable（client モード）。§4.5⑪＝SC-90 メンバー行はクリック割当なし（onRowClick を渡さない）。
// メンバー追加は URL 付きモーダル（別ルート /admin/quest-groups/[groupId]/members/add・ピッカーは開いたまま複数追加）へ分離。
// 追加成功は GROUP_MEMBERS_CHANGED_EVENT（window）で通知され、この画面が購読してメンバー一覧/件数を再取得する。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Avatar, DataTable, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { GROUP_MEMBERS_CHANGED_EVENT, listGroupMembers, listMyGroups, removeMember, type Member, type QuestGroup } from "../api";
import "@/features/companies/companies.css";
import "../qgadmin.css";

export function QuestGroupAdminView() {
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [notAdmin, setNotAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  // 参加追加は別ルート（URL モーダル）で行う＝成功時の GROUP_MEMBERS_CHANGED_EVENT を購読して
  // メンバー一覧（選択中グループ）と件数（グループ一覧の member_count）を再取得する。
  useEffect(() => {
    const onChanged = () => {
      void loadGroups();
      if (selectedId) void loadMembers(selectedId);
    };
    window.addEventListener(GROUP_MEMBERS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(GROUP_MEMBERS_CHANGED_EVENT, onChanged);
  }, [selectedId, loadGroups, loadMembers]);

  async function onRemove(accountId: string, name: string) {
    if (!selectedId) return;
    // 除外は編集ダイアログを開かない副作用＝カスタム確認ダイアログ（§15・破壊的）。
    const ok = await confirm({
      variant: "danger",
      title: "グループから除外",
      msg: `「${name}」をこのグループから除外しますか？（アカウント本体・他グループ所属・これまでの入力は残ります）`,
      confirmLabel: "除外する",
    });
    if (!ok) return;
    setError(null);
    try {
      await removeMember(selectedId, accountId);
      snack({ type: "success", title: `「${name}」を除外しました` });
      await loadMembers(selectedId);
    } catch {
      const msg = "除外に失敗しました。";
      setError(msg);
      snack({ type: "error", title: msg });
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
        <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
        <h1 className="page-title">クエストグループ管理</h1>
        <p className="admin-sub">あなたが管理するクエストグループはありません（グループの管理者〔admin〕所属が必要です）。</p>
      </section>
    );
  }

  return (
    <section aria-label="クエストグループ管理">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
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
        {/* 追加は URL 付きモーダル（別ルート）。選択中グループ id を URL に載せる。直アクセス/リロードはフルページ。 */}
        {selectedId ? (
          <Link href={`/admin/quest-groups/${selectedId}/members/add`} className="btn btn-primary">
            ＋ メンバーを追加
          </Link>
        ) : (
          <button type="button" className="btn btn-primary" disabled>
            ＋ メンバーを追加
          </button>
        )}
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
    </section>
  );
}
