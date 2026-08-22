"use client";

// SC-92 クエストグループ（この会社・CRUD）。system_admin 専用（会社構造の変更・B.3.1）。
// 一覧（DataTable client モード）＋作成＋リネーム＋削除（空グループのみ＝有効所属があれば 409 in_use）。
// レイアウト/クラスの正＝doc/画面設計/mocks/SC-92_会社詳細.html（DoD＝モック一致）。
// 一覧の操作標準は DataTable に委譲＝検索/絞込/ソート/列設定/CSV/ピン/カード（§4.5）。listQuestGroups は全件返す。
import { useCallback, useEffect, useState } from "react";

import { Button, DataTable, Field, Modal, ModalBody, ModalFooter, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { createQuestGroup, deleteQuestGroup, listQuestGroups, renameQuestGroup, type QuestGroup } from "../api";
import "@/features/companies/companies.css";

function createErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "conflict") return "この会社コード内でコードが重複しています。";
    if (err.code === "validation_error") return "コードは英大文字始まり・A-Z/0-9/- ・2〜20 字で入力してください。";
    if (err.code === "forbidden") return "この操作を行う権限がありません。";
  }
  return "エラーが発生しました。時間をおいて再度お試しください。";
}

export function QuestGroupSection({ companyId }: { companyId: string }) {
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [dupMode, setDupMode] = useState(false); // 複製で開いたか（案内文の出し分け）
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 編集ダイアログ（グループ名のみ編集可・コードは作成後不変）。
  const [editing, setEditing] = useState<QuestGroup | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editPending, setEditPending] = useState(false);

  function openEdit(g: QuestGroup) {
    setEditing(g);
    setEditName(g.name);
    setEditError(null);
  }

  // 新規作成ダイアログを開く（空）。
  function openCreate() {
    setCode("");
    setName("");
    setDupMode(false);
    setFormError(null);
    setShowForm(true);
  }
  // 複製＝作成ダイアログを追加モードで開き、名前を引き継ぐ（コードは一意キーのため引き継がず新規入力・§4.5 複製）。
  function openDuplicate(g: QuestGroup) {
    setCode("");
    setName(g.name);
    setDupMode(true);
    setFormError(null);
    setShowForm(true);
  }

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listQuestGroups(companyId);
      setGroups(res?.data ?? []);
    } catch {
      setLoadError("クエストグループ一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    try {
      await createQuestGroup(companyId, { quest_group_code: code, name });
      setCode("");
      setName("");
      setDupMode(false);
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(createErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function onEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const next = editName.trim();
    if (next === "") {
      setEditError("グループ名を入力してください。");
      return;
    }
    setEditError(null);
    setEditPending(true);
    try {
      if (next !== editing.name) await renameQuestGroup(companyId, editing.group_id, next);
      setEditing(null);
      await reload();
    } catch (err) {
      setEditError(createErrorMessage(err));
    } finally {
      setEditPending(false);
    }
  }

  async function onDelete(g: QuestGroup) {
    // 削除は編集ダイアログを開かない副作用＝カスタム確認ダイアログ（§15）。
    const ok = await confirm({
      variant: "danger",
      title: "クエストグループを削除",
      msg: `クエストグループ「${g.name}」を削除しますか？（空のグループのみ）`,
      confirmLabel: "削除する",
    });
    if (!ok) return;
    setActionError(null);
    try {
      await deleteQuestGroup(companyId, g.group_id);
      snack({ type: "success", title: "クエストグループを削除しました" });
      await reload();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "conflict"
          ? "所属メンバーがいるため削除できません（先に所属を外してください）。"
          : "削除に失敗しました。";
      setActionError(msg);
      snack({ type: "error", title: "削除できませんでした", msg });
    }
  }

  // 列定義（正＝mocks/SC-92 のグループ DataTable columns）。操作は RowMenu（リネーム/削除）。
  const columns: DataTableColumn<QuestGroup>[] = [
    {
      key: "name",
      label: "グループ名",
      locked: true,
      width: 260,
      sortable: true,
      filter: { type: "text" },
      sortVal: (g) => g.name,
      searchVal: (g) => g.name,
      csvVal: (g) => g.name,
      render: (g) => <strong>{g.name}</strong>,
    },
    {
      key: "quest_group_code",
      label: "コード",
      width: 160,
      cellClass: "db-id",
      sortable: true,
      filter: { type: "text" },
      sortVal: (g) => g.quest_group_code,
      searchVal: (g) => g.quest_group_code,
      render: (g) => g.quest_group_code,
    },
    {
      key: "member_count",
      label: "メンバー数",
      width: 130,
      align: "num",
      sortable: true,
      sortVal: (g) => g.member_count,
      csvVal: (g) => `${g.member_count} 名`,
      render: (g) => `${g.member_count} 名`,
    },
    {
      key: "_actions",
      label: "",
      actions: true,
      locked: true,
      width: 90,
      render: (g) => (
        <RowMenu
          items={[
            { label: "編集", onClick: () => openEdit(g) },
            { label: "複製", onClick: () => openDuplicate(g) },
            { label: "削除", danger: true, onClick: () => onDelete(g) },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="card admin-create admin-create--table">
      <div className="admin-toolbar">
        <h2>クエストグループ</h2>
        <Button type="button" variant="primary" onClick={openCreate}>
          ＋ グループ作成
        </Button>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="クエストグループを作成" size="sm">
        <form onSubmit={onCreate} noValidate>
          <ModalBody>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            {dupMode && (
              <p className="provision-note">
                複製元の名前を引き継いで新規作成します。<strong>コードは新しい値を入力してください</strong>（一意のため引き継ぎません）。
              </p>
            )}
            <Field id="g_code" label="クエストグループコード" required>
              <input id="g_code" className="input" placeholder="例: PLAN" value={code} onChange={(e) => setCode(e.target.value)} required />
            </Field>
            <Field id="g_name" label="グループ名" required>
              <input id="g_name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "作成中…" : "作成する"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* 編集ダイアログ＝グループ名のみ編集可（コードは作成後不変・B.3.1）。 */}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="クエストグループを編集" size="sm">
        <form onSubmit={onEditSubmit} noValidate>
          <ModalBody>
            {editError && <div className="form-error" role="alert">{editError}</div>}
            <Field id="g_edit_code" label="クエストグループコード" hint="コードは作成後は変更できません。">
              <input id="g_edit_code" className="input db-id" value={editing?.quest_group_code ?? ""} readOnly disabled />
            </Field>
            <Field id="g_edit_name" label="グループ名" required>
              <input
                id="g_edit_name"
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                aria-invalid={editError ? true : undefined}
                required
              />
            </Field>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={editPending}>
              {editPending ? "保存中…" : "保存する"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      {loadError ? (
        <div className="form-error" role="alert">{loadError}</div>
      ) : loading ? (
        <p className="admin-muted">読み込み中…</p>
      ) : (
        <DataTable<QuestGroup>
          storageKey={`sc92-groups-${companyId}`}
          data={groups}
          columns={columns}
          rowId={(g) => g.group_id}
          unit="件"
          perPage={10}
          perPageOptions={[10, 20, 50]}
          searchFields="グループ名・コード"
          exportName="クエストグループ"
          emptyText="クエストグループがありません。「＋ グループ作成」から追加してください。"
          onRowClick={(g) => openEdit(g)} // §4.5⑪: 複数操作あり＝クリックは主アクション(編集)
          cardLayout={(g) => ({
            title: g.name,
            meta: [`コード: ${g.quest_group_code}`],
            stats: [`${g.member_count} 名`],
          })}
        />
      )}
    </div>
  );
}
