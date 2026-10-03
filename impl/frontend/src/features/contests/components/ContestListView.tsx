"use client";

// SC-53 アイデアコンテスト一覧（ドメイン T・FR-46）。UI は SC-10 クエスト一覧を踏襲＝
// backlink＋page-head＋DataTable（検索/並び替え/絞り込み/列設定/エクスポート/表示切替）＋行アクション（RowMenu）。
// 会期ステータスの切り替えは SC-12 アイデア一覧と同じセグメントスイッチ（.segmented）。
// 作成/編集/複製はモーダル（入力系＝フッター「キャンセル」＋主ボタン btn-primary・デザイン標準 §4.10）。
// 作成/編集/削除の権限が無い場合はサーバーが 403＝スナックバーで案内（UI 非表示に依存しない）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, DataTable, Field, Modal, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";

import { createContest, deleteContest, fetchContests, getContest, updateContest } from "../api";
import type { ContestListItem } from "../api";
import { CONTEST_MODE_LABEL, CONTEST_STATUS_BADGE, CONTEST_TABS, contestStatusLabel } from "../types";
import "../contests.css";

const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");

type ContestRow = {
  id: string; theme: string; mode: string; modeLabel: string; status: string; statusLabel: string;
  starts: string; ends: string;
};

function toRow(c: ContestListItem): ContestRow {
  return {
    id: c.id, theme: c.theme, mode: c.mode, modeLabel: CONTEST_MODE_LABEL[c.mode] ?? c.mode,
    status: c.status, statusLabel: contestStatusLabel(c.status),
    starts: fmtDate(c.starts_at), ends: fmtDate(c.ends_at),
  };
}

const MODE_OPTIONS: [string, string][] = Object.values(CONTEST_MODE_LABEL).map((v) => [v, v]);

type FormMode = "create" | "edit" | "duplicate";

export function ContestListView() {
  const router = useRouter();
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [tab, setTab] = useState(CONTEST_TABS[0].key);
  const [items, setItems] = useState<ContestListItem[] | null>(null);
  const [reload, setReload] = useState(0);
  // モーダル（作成/編集/複製の共通フォーム）。
  const [open, setOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState("bounded");
  const [status, setStatus] = useState("draft");
  const [themeErr, setThemeErr] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchContests(undefined, ac.signal)
      .then((all) => setItems(all))
      .catch(() => setItems([]));
    return () => ac.abort();
  }, [reload]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of CONTEST_TABS) m[t.key] = (items ?? []).filter((c) => t.statuses.includes(c.status)).length;
    return m;
  }, [items]);

  const rows = useMemo(() => {
    const statuses = CONTEST_TABS.find((t) => t.key === tab)?.statuses ?? [];
    return (items ?? []).filter((c) => statuses.includes(c.status)).map(toRow);
  }, [items, tab]);

  function openCreate() {
    setFormMode("create"); setEditingId(null);
    setTheme(""); setDescription(""); setMode("bounded"); setStatus("draft"); setThemeErr(null);
    setOpen(true);
  }

  async function openEditOrDuplicate(row: ContestRow, m: FormMode) {
    setFormMode(m); setThemeErr(null);
    setTheme(row.theme); setMode(row.mode); setStatus("draft");
    setEditingId(m === "edit" ? row.id : null);
    setOpen(true);
    // 説明は一覧DTOに無い＝詳細を取得してプリフィル（取得失敗は空のまま）。
    const detail = await getContest(row.id).catch(() => null);
    if (detail) { setDescription(detail.description ?? ""); if (m === "edit") setStatus(detail.status); }
  }

  async function remove(row: ContestRow) {
    const ok = await confirm({
      variant: "danger",
      title: "コンテストを削除",
      msg: `「${row.theme}」を削除しますか？ 一覧・詳細から見えなくなります（投稿されたアイデア等は監査のため保持されます）。`,
    });
    if (!ok) return;
    try {
      await deleteContest(row.id);
      snack({ type: "success", title: "コンテストを削除しました" });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "削除できませんでした（権限が必要な場合があります）" });
    }
  }

  // 行アクション＝標準順（詳細を開く → 編集 → 複製 → 削除〔danger〕・デザイン標準 §4.5）。
  const menu = (row: ContestRow): RowMenuItem[] => [
    { label: "詳細を開く", onClick: () => router.push(`/contests/${row.id}`) },
    { label: "編集", onClick: () => void openEditOrDuplicate(row, "edit") },
    { label: "複製", onClick: () => void openEditOrDuplicate(row, "duplicate") },
    { label: "削除", danger: true, onClick: () => void remove(row) },
  ];

  const columns: DataTableColumn<ContestRow>[] = [
    {
      key: "theme", label: "テーマ", locked: true, width: 320, sortable: true, filter: { type: "text" },
      sortVal: (x) => x.theme, searchVal: (x) => x.theme, csvVal: (x) => x.theme,
      render: (x) => <span className="idea-title">{x.theme}</span>,
    },
    { key: "mode", label: "種別", width: 170, sortable: true, filter: { type: "enum", options: MODE_OPTIONS }, sortVal: (x) => x.modeLabel, filterVal: (x) => x.modeLabel, render: (x) => x.modeLabel },
    { key: "status", label: "状態", width: 120, sortable: true, sortVal: (x) => x.statusLabel, filterVal: (x) => x.statusLabel, render: (x) => <span className={`badge ${CONTEST_STATUS_BADGE[x.status] ?? "badge-muted"}`}>{x.statusLabel}</span> },
    { key: "starts", label: "開始", width: 120, sortable: true, sortVal: (x) => x.starts, csvVal: (x) => x.starts, render: (x) => x.starts },
    { key: "ends", label: "締切", width: 120, sortable: true, sortVal: (x) => x.ends, csvVal: (x) => x.ends, render: (x) => x.ends },
    { key: "_actions", label: "", actions: true, locked: true, width: 64, render: (x) => <RowMenu items={menu(x)} /> },
  ];

  async function submit() {
    if (!theme.trim()) { setThemeErr("テーマを入力してください。"); return; }
    setThemeErr(null);
    setSaving(true);
    try {
      if (formMode === "edit" && editingId) {
        const updated = await updateContest(editingId, { theme: theme.trim(), description: description.trim() || null });
        if (!updated) { snack({ type: "error", title: "更新に失敗しました（権限が必要な場合があります）" }); return; }
        snack({ type: "success", title: "コンテストを更新しました" });
      } else {
        const created = await createContest({ theme: theme.trim(), description: description.trim() || null, mode, status });
        if (!created) { snack({ type: "error", title: "作成に失敗しました（権限が必要な場合があります）" }); return; }
        snack({ type: "success", title: "コンテストを作成しました" });
      }
      setOpen(false);
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: formMode === "edit" ? "更新に失敗しました" : "作成に失敗しました" });
    } finally {
      setSaving(false);
    }
  }

  const modalTitle = formMode === "edit" ? "コンテストを編集" : formMode === "duplicate" ? "コンテストを複製" : "コンテストを作成";
  const submitLabel = formMode === "edit" ? "保存する" : "作成する";

  return (
    <section aria-label="アイデアコンテスト一覧">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head">
        <h1>アイデアコンテスト</h1>
        <Button variant="primary" onClick={openCreate}>＋ コンテストを作成</Button>
      </div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        クエストに縛られず、アイデア単体を公募・投票・評価し、会期で優秀アイデアを表彰します。
      </p>

      <div className="segmented contest-seg" role="radiogroup" aria-label="会期の絞り込み" style={{ marginBottom: "var(--space-3)" }}>
        {CONTEST_TABS.map((t) => (
          <label key={t.key}>
            <input type="radio" name="contest-tab" checked={tab === t.key} onChange={() => setTab(t.key)} />
            {t.label} <span className="seg-n">{counts[t.key] ?? 0}</span>
          </label>
        ))}
      </div>

      {items === null ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<ContestRow>
          storageKey="sc53-contests"
          data={rows}
          columns={columns}
          rowId={(x) => x.id}
          unit="件"
          perPage={12}
          perPageOptions={[12, 24, 48]}
          defaultView="list"
          searchFields="テーマ"
          exportName="アイデアコンテスト一覧"
          emptyText="このタブに該当するコンテストはありません。"
          onRowClick={(x) => router.push(`/contests/${x.id}`)}
          card={(x) => (
            <>
              <div className="between">
                <span className="card-title">{x.theme}</span>
                <span className={`badge ${CONTEST_STATUS_BADGE[x.status] ?? "badge-muted"}`}>{x.statusLabel}</span>
              </div>
              <div className="contest-card__meta">
                <span className="badge badge-muted">{x.modeLabel}</span>
                <span>⏳ {x.starts} 〜 {x.ends}</span>
              </div>
            </>
          )}
        />
      )}

      {open && (
        <Modal open={open} title={modalTitle} size="md" onClose={() => setOpen(false)}>
          <div className="modal__body">
            <Field id="ct-theme" label="テーマ" required error={themeErr}>
              <input className="input" id="ct-theme" value={theme} onChange={(e) => setTheme(e.target.value)}
                     placeholder="例）業務改善アイデア大募集 2027" />
            </Field>
            <Field id="ct-desc" label="説明">
              <textarea className="input" id="ct-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="コンテストの趣旨・応募要領など（任意）" />
            </Field>
            {formMode !== "edit" && (
              <>
                <Field id="ct-mode" label="種別">
                  <select className="select" id="ct-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="bounded">{CONTEST_MODE_LABEL.bounded}</option>
                    <option value="rolling">{CONTEST_MODE_LABEL.rolling}</option>
                  </select>
                </Field>
                <Field id="ct-status" label="公開">
                  <select className="select" id="ct-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="draft">準備中（下書き）</option>
                    <option value="open">すぐ公募を開始</option>
                  </select>
                </Field>
              </>
            )}
          </div>
          <div className="modal__footer">
            <button className="btn btn-outline" type="button" onClick={() => setOpen(false)} disabled={saving}>キャンセル</button>
            <Button variant="primary" onClick={submit} loading={saving}>{submitLabel}</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
