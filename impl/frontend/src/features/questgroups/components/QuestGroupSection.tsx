"use client";

// SC-92 クエストグループ（この会社・CRUD）。system_admin 専用（会社構造の変更・B.3.1）。
// 一覧＋作成＋リネーム＋削除（空グループのみ＝有効所属があれば 409 in_use）。
import { useCallback, useEffect, useState } from "react";

import { Button, Field, Modal, ModalBody, ModalFooter } from "@/components/ui";
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
  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await listQuestGroups(companyId);
      setGroups(res?.data ?? []);
    } catch {
      setLoadError("クエストグループ一覧の取得に失敗しました。");
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
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(createErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function onRename(g: QuestGroup) {
    const next = window.prompt("新しいグループ名", g.name);
    if (next === null || next.trim() === "" || next === g.name) return;
    setActionError(null);
    try {
      await renameQuestGroup(companyId, g.group_id, next.trim());
      await reload();
    } catch {
      setActionError("リネームに失敗しました。");
    }
  }

  async function onDelete(g: QuestGroup) {
    if (!window.confirm(`クエストグループ「${g.name}」を削除しますか？（空のグループのみ）`)) return;
    setActionError(null);
    try {
      await deleteQuestGroup(companyId, g.group_id);
      await reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.code === "conflict"
          ? "所属メンバーがいるため削除できません（先に所属を外してください）。"
          : "削除に失敗しました。",
      );
    }
  }

  return (
    <div className="card admin-create">
      <div className="admin-toolbar">
        <h2>クエストグループ</h2>
        <Button type="button" variant="primary" onClick={() => setShowForm(true)}>
          ＋ グループ作成
        </Button>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="クエストグループを作成" size="sm">
        <form onSubmit={onCreate} noValidate>
          <ModalBody>
            {formError && <div className="form-error" role="alert">{formError}</div>}
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

      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">グループ名</th>
            <th scope="col">コード</th>
            <th scope="col">メンバー数</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.group_id}>
              <td>{g.name}</td>
              <td className="admin-code">{g.quest_group_code}</td>
              <td>{g.member_count}</td>
              <td>
                <button type="button" onClick={() => onRename(g)}>リネーム</button>{" "}
                <button type="button" className="is-danger" onClick={() => onDelete(g)}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.length === 0 && !loadError && <p className="admin-muted">クエストグループがありません。</p>}
    </div>
  );
}
