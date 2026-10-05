"use client";

// SC-96 お知らせ管理（管理者のみ・FR-49・U.2）。一覧(DataTable)＋作成/編集モーダル（RichTextEditor・📌・掲載期間・状態）。
// ピン留めは RowMenu のトグル（即時 PATCH・§4.5）。認可はサーバー強制（管理者以外 403）。
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, DataTable, Field, Modal, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { RichTextEditor } from "@/components/richtext/RichTextEditor";
import {
  createAnnouncement, deleteAnnouncement, getAnnouncement, listAdminAnnouncements,
  updateAnnouncement, type AdminAnnouncementItem,
} from "../api";

const STATUS_LABEL: Record<string, string> = { draft: "下書き", published: "公開中", archived: "アーカイブ" };
const statusBadge = (s: string) => (s === "published" ? "badge badge-success" : "badge badge-muted");
const STATUS_OPTIONS: [string, string][] = [["下書き", "下書き"], ["公開中", "公開中"], ["アーカイブ", "アーカイブ"]];
const PIN_OPTIONS: [string, string][] = [["📌 ピン", "📌 ピン"], ["—", "—"]];

type Row = AdminAnnouncementItem;

export function AnnouncementAdminView() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // 作成/編集モーダル。
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [status, setStatus] = useState("draft");
  const [pinned, setPinned] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [titleErr, setTitleErr] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    listAdminAnnouncements(ac.signal)
      .then((r) => { if (r) setRows(r.data); })
      .catch(() => setErr("お知らせ管理一覧の取得に失敗しました。"));
    return () => ac.abort();
  }, [reload]);

  function openCreate() {
    setEditingId(null); setTitle(""); setBodyHtml(""); setStatus("draft"); setPinned(false);
    setStartsAt(""); setEndsAt(""); setTitleErr(null); setOpen(true);
  }
  async function openEdit(row: Row) {
    setEditingId(row.id); setTitleErr(null);
    setTitle(row.title); setStatus(row.status); setPinned(row.pinned);
    setStartsAt((row.starts_at ?? "").slice(0, 10)); setEndsAt((row.ends_at ?? "").slice(0, 10));
    setBodyHtml("");
    setOpen(true);
    // 本文(body_html)は一覧DTOに無い＝詳細を取得してプリフィル（公開物のみ GET 可なので取れないときは空）。
    const d = await getAnnouncement(row.id).catch(() => null);
    if (d) setBodyHtml(d.body_html ?? "");
  }

  async function togglePin(row: Row) {
    try {
      await updateAnnouncement(row.id, { pinned: !row.pinned });
      snack({ type: "success", title: row.pinned ? "ピン留めを解除しました" : "ピン留めしました" });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "更新できませんでした" });
    }
  }

  async function remove(row: Row) {
    const ok = await confirm({ variant: "danger", title: "お知らせを削除", msg: `「${row.title}」を削除しますか？ 一覧・ダッシュボードから見えなくなります。` });
    if (!ok) return;
    try {
      await deleteAnnouncement(row.id);
      snack({ type: "success", title: "お知らせを削除しました" });
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "削除できませんでした" });
    }
  }

  const toIso = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : null);
  async function submit() {
    if (!title.trim()) { setTitleErr("タイトルを入力してください。"); return; }
    setTitleErr(null); setSaving(true);
    const period = { starts_at: toIso(startsAt), ends_at: toIso(endsAt) };
    try {
      if (editingId) {
        await updateAnnouncement(editingId, { title: title.trim(), body_html: bodyHtml, status, pinned, ...period });
        snack({ type: "success", title: "お知らせを更新しました" });
      } else {
        await createAnnouncement({ title: title.trim(), body_html: bodyHtml, status: status === "archived" ? "draft" : status, pinned, ...period });
        snack({ type: "success", title: "お知らせを作成しました" });
      }
      setOpen(false);
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: editingId ? "更新に失敗しました" : "作成に失敗しました（権限が必要な場合があります）" });
    } finally {
      setSaving(false);
    }
  }

  const menu = (row: Row): RowMenuItem[] => [
    { label: row.pinned ? "📌 ピン留めを解除" : "📌 ピン留めする", onClick: () => void togglePin(row) },
    { label: "編集", onClick: () => void openEdit(row) },
    { label: "削除", danger: true, onClick: () => void remove(row) },
  ];

  const columns: DataTableColumn<Row>[] = [
    { key: "title", label: "タイトル", locked: true, width: 320, sortable: true, filter: { type: "text" }, sortVal: (x) => x.title, searchVal: (x) => x.title, csvVal: (x) => x.title, render: (x) => <span className="idea-title">{x.title}</span> },
    { key: "status", label: "状態", width: 120, sortable: true, filter: { type: "enum", options: STATUS_OPTIONS }, sortVal: (x) => STATUS_LABEL[x.status] ?? x.status, filterVal: (x) => STATUS_LABEL[x.status] ?? x.status, render: (x) => <span className={statusBadge(x.status)}>{STATUS_LABEL[x.status] ?? x.status}</span> },
    { key: "pinned", label: "ピン", width: 90, sortable: true, filter: { type: "enum", options: PIN_OPTIONS }, sortVal: (x) => (x.pinned ? 1 : 0), filterVal: (x) => (x.pinned ? "📌 ピン" : "—"), render: (x) => (x.pinned ? "📌" : "—") },
    { key: "published_at", label: "公開日", width: 120, sortable: true, sortVal: (x) => x.published_at ?? "", csvVal: (x) => (x.published_at ?? "").slice(0, 10), render: (x) => (x.published_at ?? "—").slice(0, 10) },
    { key: "period", label: "掲載期間", width: 170, sortVal: (x) => x.starts_at ?? "", render: (x) => `${(x.starts_at ?? "").slice(0, 10) || "—"} 〜 ${(x.ends_at ?? "").slice(0, 10) || "—"}` },
    { key: "read_count", label: "既読", width: 80, align: "num", sortable: true, sortVal: (x) => x.read_count, render: (x) => x.read_count },
    { key: "_actions", label: "", actions: true, locked: true, width: 64, render: (x) => <RowMenu items={menu(x)} /> },
  ];

  const modalTitle = editingId ? "お知らせを編集" : "お知らせを作成";

  return (
    <section aria-label="お知らせ管理">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head">
        <h1>📢 お知らせ管理</h1>
        <Button variant="primary" onClick={openCreate}>＋ お知らせを作成</Button>
      </div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        全社向けお知らせの作成・編集・公開・ピン留めを管理します。ピン留めはダッシュボード/一覧で上部に固定されます。
      </p>

      {err ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows === null ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<Row>
          storageKey="sc96-announcements"
          data={rows}
          columns={columns}
          rowId={(x) => x.id}
          unit="件"
          perPage={12}
          perPageOptions={[12, 24, 48]}
          defaultView="list"
          searchFields="タイトル"
          exportName="お知らせ一覧"
          emptyText="お知らせはまだありません。「＋ お知らせを作成」から追加してください。"
          onRowClick={(x) => void openEdit(x)}
          card={(x) => (
            <>
              <div className="between">
                <span className="card-title">{x.title}</span>
                <span className={statusBadge(x.status)}>{STATUS_LABEL[x.status] ?? x.status}</span>
              </div>
              <div className="muted text-xs" style={{ marginTop: "var(--space-2)" }}>
                {x.pinned ? "📌 ピン　・　" : ""}公開 {(x.published_at ?? "—").slice(0, 10)}　・　掲載 {(x.starts_at ?? "").slice(0, 10) || "—"}〜{(x.ends_at ?? "").slice(0, 10) || "—"}　・　既読 {x.read_count}
              </div>
            </>
          )}
        />
      )}

      {open && (
        <Modal open={open} title={modalTitle} size="lg" onClose={() => setOpen(false)}>
          <div className="modal__body">
            <Field id="an-title" label="タイトル" required error={titleErr}>
              <input className="input" id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例）年末アイデアソン開催のお知らせ" />
            </Field>
            <Field id="an-body" label="本文">
              <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="お知らせ本文（見出し・強調・箇条書き・リンク）…" ariaLabel="お知らせ本文" />
            </Field>
            <div className="row-2">
              <Field id="an-status" label="状態">
                <select className="select" id="an-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="draft">下書き（非公開）</option>
                  <option value="published">公開する</option>
                  {editingId && <option value="archived">アーカイブ</option>}
                </select>
              </Field>
              <Field id="an-pin" label="ピン留め">
                <label className="checkbox">
                  <input type="checkbox" id="an-pin" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                  <span>📌 上部に固定する</span>
                </label>
              </Field>
            </div>
            <div className="row-2">
              <Field id="an-starts" label="掲載開始日（任意）">
                <input className="input" id="an-starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </Field>
              <Field id="an-ends" label="掲載終了日（任意）">
                <input className="input" id="an-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="modal__footer">
            <button className="btn btn-outline dialog-close-left" type="button" onClick={() => setOpen(false)} disabled={saving}>キャンセル</button>
            <Button variant="primary" onClick={submit} loading={saving}>{editingId ? "保存する" : "作成する"}</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
