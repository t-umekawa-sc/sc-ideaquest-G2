"use client";

// SC-53 アイデアコンテスト一覧（ドメイン T・FR-46）。会期タブ（公募中/予定/審査中/終了）＋作成。
// UI は SC-10 クエスト一覧を踏襲（新規UIを増やさない）。作成権限が無い場合はサーバーが 403＝スナックバーで案内。
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button, Field, Modal, useSnackbar } from "@/components/ui";

import { createContest, fetchContests } from "../api";
import type { ContestListItem } from "../api";
import { CONTEST_MODE_LABEL, CONTEST_STATUS_BADGE, CONTEST_TABS, contestStatusLabel } from "../types";
import "../contests.css";

const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");

export function ContestListView() {
  const snack = useSnackbar();
  const [tab, setTab] = useState(CONTEST_TABS[0].key);
  const [items, setItems] = useState<ContestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState("");
  const [mode, setMode] = useState("bounded");
  const [status, setStatus] = useState("draft");
  const [themeErr, setThemeErr] = useState<string | null>(null);

  const statuses = useMemo(() => CONTEST_TABS.find((t) => t.key === tab)?.statuses ?? [], [tab]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    // タブは複数 status を含み得る＝全件取得後にクライアントで絞る（件数は小・MVP）。
    fetchContests(undefined, ac.signal)
      .then((all) => setItems(all.filter((c) => statuses.includes(c.status))))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [statuses, reload]);

  async function submit() {
    if (!theme.trim()) { setThemeErr("テーマを入力してください。"); return; }
    setThemeErr(null);
    setSaving(true);
    try {
      const created = await createContest({ theme: theme.trim(), mode, status });
      if (!created) { snack({ type: "error", title: "作成に失敗しました（権限が必要な場合があります）" }); return; }
      snack({ type: "success", title: "コンテストを作成しました" });
      setOpen(false); setTheme(""); setMode("bounded"); setStatus("draft");
      setReload((n) => n + 1);
    } catch {
      snack({ type: "error", title: "作成に失敗しました" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container contest-list" style={{ paddingBlock: "var(--space-6) var(--space-16)" }}>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="page-title">アイデアコンテスト</h1>
        <Button onClick={() => setOpen(true)}>＋ コンテストを作成</Button>
      </div>
      <p className="hint" style={{ maxWidth: 720 }}>クエストに縛られず、アイデア単体を公募・投票・評価し、会期で優秀アイデアを表彰します。</p>

      <div className="contest-tabs" role="tablist">
        {CONTEST_TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
                  className={`btn btn-sm ${tab === t.key ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <p className="hint">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="hint">このタブに該当するコンテストはありません。</p>
      ) : (
        <table className="contest-table">
          <thead><tr><th>テーマ</th><th>種別</th><th>状態</th><th>開始</th><th>締切</th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/contests/${c.id}`}>{c.theme}</Link></td>
                <td>{CONTEST_MODE_LABEL[c.mode] ?? c.mode}</td>
                <td><span className={`badge ${CONTEST_STATUS_BADGE[c.status] ?? "badge-muted"}`}>{contestStatusLabel(c.status)}</span></td>
                <td>{fmtDate(c.starts_at)}</td>
                <td>{fmtDate(c.ends_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <Modal open={open} title="コンテストを作成" size="md" onClose={() => setOpen(false)}>
          <div className="modal__body">
            <Field id="ct-theme" label="テーマ" required error={themeErr}>
              <input className="input" id="ct-theme" value={theme} onChange={(e) => setTheme(e.target.value)}
                     placeholder="例）業務改善アイデア大募集 2027" />
            </Field>
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
          </div>
          <div className="modal__footer">
            <button className="btn btn-outline" type="button" onClick={() => setOpen(false)}>キャンセル</button>
            <Button onClick={submit} disabled={saving}>{saving ? "作成中…" : "作成する"}</Button>
          </div>
        </Modal>
      )}
    </main>
  );
}
