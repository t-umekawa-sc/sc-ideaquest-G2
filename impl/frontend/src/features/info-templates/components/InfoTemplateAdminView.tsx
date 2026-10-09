"use client";

// SC-55 情報テンプレート管理（会社管理者・N.5b・§5.37b・FR-41⑩）。情報登録（SC-51）で選べる会社共通
// テンプレート（本文ひな形＝PM-JSON＋属性既定値）を 追加/編集/有効無効/複製/論理削除。
// 一覧(DataTable)＋登録/編集モーダル（共有 RichTextEditor・TipTap）。認可はサーバー強制（管理者以外 403）。
// 正＝doc/画面設計/mocks/SC-55_情報テンプレート管理.html（DoD＝モック一致）。
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, Combobox, DataTable, Field, Modal, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { RichTextEditor, EMPTY_DOC, type RichTextValue } from "@/components/richtext/RichTextEditor";
import {
  BUSINESS_LABEL, CATEGORY_LABEL, CLASSIFICATION_LABEL, IMPACT_CLASS_LABEL, IMPACT_LABEL,
  PRIORITY_LABEL, SCOPE_LABEL, SOURCE_LABEL, TIMING_LABEL,
} from "@/features/info-input/labels";
import {
  createTemplate, deleteTemplate, listAdminTemplates, setTemplateActive, updateTemplate, uploadInfoImageApi,
  type InfoTemplateAdminItem,
} from "../api";

type Row = InfoTemplateAdminItem;

// defaults の scalar キー → ラベル辞書（info-input と同じ・DRY）。IMPACT_CLASS は [短縮,正式] なので [0] を使う。
const SCALAR_FIELDS: { key: string; label: string; opts: [string, string][] }[] = [
  { key: "priority", label: "優先度", opts: Object.entries(PRIORITY_LABEL) },
  { key: "source", label: "情報ソース", opts: Object.entries(SOURCE_LABEL) },
  { key: "classification", label: "情報分類", opts: Object.entries(CLASSIFICATION_LABEL) },
  { key: "scope", label: "大分類", opts: Object.entries(SCOPE_LABEL) },
  { key: "target_business", label: "対象事業", opts: Object.entries(BUSINESS_LABEL) },
  { key: "impact_level", label: "影響度", opts: Object.entries(IMPACT_LABEL) },
  { key: "impact_class", label: "影響分類", opts: Object.entries(IMPACT_CLASS_LABEL).map(([v, l]) => [v, l[0]] as [string, string]) },
  { key: "impact_timing", label: "影響発生時期", opts: Object.entries(TIMING_LABEL) },
];
const SCALAR_LABEL_OF = (key: string, val: string): string =>
  SCALAR_FIELDS.find((f) => f.key === key)?.opts.find(([v]) => v === val)?.[1] ?? val;

// 一覧の既定値チップ用の短い要約（非空の scalar ＋ categories 件数）。
function defaultsSummary(defaults: Record<string, unknown>): string[] {
  const chips: string[] = [];
  for (const f of SCALAR_FIELDS) {
    const v = defaults[f.key];
    if (typeof v === "string" && v) chips.push(`${f.label}: ${SCALAR_LABEL_OF(f.key, v)}`);
  }
  const cats = defaults.categories;
  if (Array.isArray(cats) && cats.length) chips.push(`カテゴリ×${cats.length}`);
  return chips;
}

export function InfoTemplateAdminView() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // 登録/編集モーダル。
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [titleTemplate, setTitleTemplate] = useState("");
  const [body, setBody] = useState<RichTextValue>(EMPTY_DOC);
  const [scalars, setScalars] = useState<Record<string, string>>({});
  const [cats, setCats] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [nameErr, setNameErr] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    listAdminTemplates(ac.signal)
      .then((r) => { if (r) setRows(r.data); })
      .catch(() => setErr("テンプレート一覧の取得に失敗しました。"));
    return () => ac.abort();
  }, [reload]);

  function resetForm() {
    setName(""); setDescription(""); setTitleTemplate(""); setBody(EMPTY_DOC);
    setScalars({}); setCats([]); setSortOrder("0"); setIsActive(true); setNameErr(null);
  }
  function openCreate() { setEditingId(null); resetForm(); setOpen(true); }
  function fillFrom(row: Row, { duplicate = false } = {}) {
    setName(duplicate ? `${row.name} のコピー` : row.name);
    setDescription(row.description ?? "");
    setTitleTemplate(row.title_template ?? "");
    setBody((row.body as RichTextValue) ?? EMPTY_DOC);
    const d = (row.defaults ?? {}) as Record<string, unknown>;
    const sc: Record<string, string> = {};
    for (const f of SCALAR_FIELDS) if (typeof d[f.key] === "string") sc[f.key] = d[f.key] as string;
    setScalars(sc);
    setCats(Array.isArray(d.categories) ? (d.categories as string[]) : []);
    setSortOrder(String(row.sort_order ?? 0));
    setIsActive(duplicate ? true : row.is_active);
    setNameErr(null);
  }
  function openEdit(row: Row) { setEditingId(row.id); fillFrom(row); setOpen(true); }
  function openDuplicate(row: Row) { setEditingId(null); fillFrom(row, { duplicate: true }); setOpen(true); }

  async function toggleActive(row: Row) {
    try {
      await setTemplateActive(row.id, !row.is_active);
      snack({ type: "success", title: row.is_active ? "無効にしました" : "有効にしました" });
      setReload((n) => n + 1);
    } catch { snack({ type: "error", title: "更新できませんでした" }); }
  }
  async function remove(row: Row) {
    const ok = await confirm({ variant: "danger", title: "テンプレートを削除", msg: `「${row.name}」を削除しますか？ 情報登録の候補から外れます（既存の情報には影響しません）。` });
    if (!ok) return;
    try {
      await deleteTemplate(row.id);
      snack({ type: "success", title: "テンプレートを削除しました" });
      setReload((n) => n + 1);
    } catch { snack({ type: "error", title: "削除できませんでした" }); }
  }

  const buildDefaults = (): Record<string, unknown> => {
    const d: Record<string, unknown> = {};
    for (const f of SCALAR_FIELDS) if (scalars[f.key]) d[f.key] = scalars[f.key];
    if (cats.length) d.categories = cats;
    return d;
  };
  const toggleCat = (c: string) => setCats((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  async function submit() {
    if (!name.trim()) { setNameErr("テンプレート名を入力してください。"); return; }
    setNameErr(null); setSaving(true);
    const payload = {
      name: name.trim(), description: description.trim() || null, title_template: titleTemplate.trim() || null,
      body, defaults: buildDefaults(), sort_order: Number(sortOrder) || 0, is_active: isActive,
    };
    try {
      if (editingId) {
        await updateTemplate(editingId, payload);
        snack({ type: "success", title: "テンプレートを更新しました" });
      } else {
        await createTemplate(payload);
        snack({ type: "success", title: "テンプレートを作成しました" });
      }
      setOpen(false);
      setReload((n) => n + 1);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 409) { setNameErr("同名の有効なテンプレートがあります。"); }
      else if (status === 422) { snack({ type: "error", title: "入力内容をご確認ください", msg: "本文ひな形は必須・属性の既定値は選択肢から選んでください。" }); }
      else { snack({ type: "error", title: editingId ? "更新に失敗しました" : "作成に失敗しました" }); }
      setSaving(false);
    }
  }

  const menu = (row: Row): RowMenuItem[] => [
    { label: "編集", onClick: () => openEdit(row) },
    { label: "複製", onClick: () => openDuplicate(row) },
    { label: row.is_active ? "無効にする" : "有効にする", onClick: () => void toggleActive(row) },
    { label: "削除", danger: true, onClick: () => void remove(row) },
  ];

  const columns: DataTableColumn<Row>[] = [
    { key: "name", label: "テンプレート名", locked: true, width: 220, sortable: true, filter: { type: "text" }, sortVal: (x) => x.name, searchVal: (x) => `${x.name} ${x.description ?? ""}`, csvVal: (x) => x.name, render: (x) => <span className="idea-title">{x.name}</span> },
    { key: "description", label: "説明", width: 260, sortVal: (x) => x.description ?? "", render: (x) => <span className="muted">{x.description || "—"}</span> },
    { key: "defaults", label: "既定属性", width: 280, render: (x) => {
      const chips = defaultsSummary((x.defaults ?? {}) as Record<string, unknown>);
      return chips.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{chips.map((c) => <span key={c} className="badge badge-muted">{c}</span>)}</div> : <span className="muted">—</span>;
    } },
    { key: "is_active", label: "状態", width: 100, sortable: true, filter: { type: "enum", options: [["有効", "有効"], ["無効", "無効"]] }, sortVal: (x) => (x.is_active ? 1 : 0), filterVal: (x) => (x.is_active ? "有効" : "無効"), render: (x) => <span className={x.is_active ? "badge badge-success" : "badge badge-muted"}>{x.is_active ? "有効" : "無効"}</span> },
    { key: "sort_order", label: "並び", width: 70, align: "num", sortable: true, sortVal: (x) => x.sort_order, render: (x) => x.sort_order },
    { key: "updated_at", label: "更新", width: 120, sortable: true, sortVal: (x) => x.updated_at ?? "", render: (x) => (x.updated_at ?? "—").slice(0, 10) },
    { key: "_actions", label: "", actions: true, locked: true, width: 64, render: (x) => <RowMenu items={menu(x)} /> },
  ];

  const modalTitle = editingId ? "テンプレートを編集" : "テンプレートを追加";

  return (
    <section aria-label="情報テンプレート管理">
      <Link className="backlink backlink--float" href="/info-items">← 情報インプットへ戻る</Link>
      <div className="page-head">
        <h1>🗂 情報テンプレート管理</h1>
        <Button variant="primary" onClick={openCreate}>＋ テンプレートを追加</Button>
      </div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        情報登録（SC-51）で選べる定型フォーマット（本文ひな形＋属性の既定値）を管理します。ここでの編集・削除は<strong>既存の情報には影響しません</strong>（登録後の情報はテンプレを参照しない疎結合）。管理＝会社管理者／適用＝会社内全員。
      </p>

      {err ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows === null ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<Row>
          storageKey="sc55-info-templates"
          data={rows}
          columns={columns}
          rowId={(x) => x.id}
          unit="件"
          perPage={12}
          perPageOptions={[12, 24, 48]}
          defaultView="list"
          searchFields="テンプレート名・説明"
          exportName="情報テンプレート一覧"
          emptyText="テンプレートはまだありません。「＋ テンプレートを追加」から作成してください。"
          onRowClick={(x) => openEdit(x)}
        />
      )}

      {open && (
        <Modal open={open} title={modalTitle} size="lg" onClose={() => setOpen(false)}>
          <div className="modal__body">
            <Field id="tm-name" label="テンプレート名" required error={nameErr}>
              <input className="input" id="tm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 電話対応履歴" />
            </Field>
            <Field id="tm-desc" label="説明（ピッカーの補足・任意）">
              <input className="input" id="tm-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例: 顧客からの電話対応を記録" />
            </Field>
            <Field id="tm-title" label="タイトル雛形（任意・適用時にフォームのタイトルへ）"
              hint="{{today}} は適用時に当日の日付へ置換されます。">
              <input className="input" id="tm-title" value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} placeholder="例: 電話対応履歴 {{today}}（）" />
            </Field>
            <Field id="tm-body" label="本文ひな形（見出し＋「（記入）」で穴埋めの型を作ります）" required>
              <RichTextEditor value={body} onChange={setBody} preset="document" uploadImage={uploadInfoImageApi}
                placeholder="見出しと「（記入）」で穴埋めの型を作ります…" ariaLabel="本文ひな形" />
            </Field>

            <details className="disclosure" style={{ marginTop: "var(--space-3)" }}>
              <summary>🧭 属性の既定値（任意・選択時にフォームへプリフィル）</summary>
              <div className="disclosure__body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {SCALAR_FIELDS.map((f) => (
                  <Field key={f.key} id={`tm-${f.key}`} label={f.label}>
                    <Combobox id={`tm-${f.key}`} ariaLabel={f.label} value={scalars[f.key] ?? ""}
                      onChange={(v) => setScalars((s) => ({ ...s, [f.key]: v }))}
                      options={[{ value: "", label: "—" }, ...f.opts.map(([v, l]) => ({ value: v, label: l }))]} />
                  </Field>
                ))}
                <div className="field">
                  <div className="dialog-label">情報カテゴリ（複数可）</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                      <label key={v} className="checkbox" style={{ fontSize: "var(--text-xs)" }}>
                        <input type="checkbox" checked={cats.includes(v)} onChange={() => toggleCat(v)} /><span>{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </details>

            <div className="row-2" style={{ marginTop: "var(--space-3)" }}>
              <Field id="tm-sort" label="並び順（小さいほど上）">
                <input className="input" id="tm-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
              </Field>
              <Field id="tm-active" label="公開">
                <label className="checkbox">
                  <input type="checkbox" id="tm-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span>情報登録で選べるようにする（有効）</span>
                </label>
              </Field>
            </div>
          </div>
          <div className="modal__footer">
            <button className="btn btn-outline dialog-close-left" type="button" onClick={() => setOpen(false)} disabled={saving}>キャンセル</button>
            <Button variant="primary" onClick={submit} loading={saving}>{editingId ? "保存する" : "追加する"}</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
