"use client";

// SC-53 アイデアコンテスト一覧（ドメイン T・FR-46）。UI は SC-10 クエスト一覧を踏襲＝
// backlink＋page-head＋DataTable（検索/並び替え/絞り込み/列設定/エクスポート/表示切替）＋行アクション（RowMenu）。
// 会期ステータスの切り替えは SC-12 アイデア一覧と同じセグメントスイッチ（.segmented）。
// 作成/編集/複製はモーダル（入力系＝フッター「キャンセル」＋主ボタン btn-primary・デザイン標準 §4.10）。
// 作成/編集/削除の権限が無い場合はサーバーが 403＝スナックバーで案内（UI 非表示に依存しない）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, DataTable, Modal, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";

import { deleteContest, fetchContests, requestContestParticipation } from "../api";
import type { ContestListItem } from "../api";
import { CONTEST_MODE_LABEL, CONTEST_STATUS_BADGE, CONTEST_TABS, contestStatusLabel } from "../types";
import { ContestFormModal } from "./ContestFormModal";
import { markContestFromList } from "@/lib/nav";
import "../contests.css";

const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");

type ContestRow = {
  id: string; theme: string; mode: string; modeLabel: string; status: string; statusLabel: string;
  starts: string; ends: string;
  // 承認制×未参加の行クリック分岐＋応募ダイアログ用（SC-53・設計 §2.3）。
  autoApprove: boolean; myStatus: string; participantCount: number; description: string | null;
};

function toRow(c: ContestListItem): ContestRow {
  return {
    id: c.id, theme: c.theme, mode: c.mode, modeLabel: CONTEST_MODE_LABEL[c.mode] ?? c.mode,
    status: c.status, statusLabel: contestStatusLabel(c.status),
    starts: fmtDate(c.starts_at), ends: fmtDate(c.ends_at),
    autoApprove: c.auto_approve ?? false, myStatus: c.my_status ?? "none",
    participantCount: c.participant_count ?? 0, description: c.description ?? null,
  };
}

const MODE_OPTIONS: [string, string][] = Object.values(CONTEST_MODE_LABEL).map((v) => [v, v]);
// 参加方式（auto_approve）＝誰でも参加（自動承認）か、運営の承認が要るか（ユーザー要望・一覧で一目で分かる列）。
const JOIN_MODE_OPTIONS: [string, string][] = [["誰でも参加", "誰でも参加"], ["承認制", "承認制"]];
const joinModeLabel = (x: ContestRow): string => (x.autoApprove ? "誰でも参加" : "承認制");

type FormMode = "create" | "edit" | "duplicate";

export function ContestListView() {
  const router = useRouter();
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [tab, setTab] = useState(CONTEST_TABS[0].key);
  const [items, setItems] = useState<ContestListItem[] | null>(null);
  const [canManage, setCanManage] = useState(false);   // 会社レベルの運営可否（全行共通）
  const [reload, setReload] = useState(0);
  // 応募ダイアログ（承認制×未参加の行クリック＝概要＋メタ＋応募・SC-53）。
  const [applyRow, setApplyRow] = useState<ContestRow | null>(null);
  const [applying, setApplying] = useState(false);
  // 作成/編集/複製は共有フォーム（ContestFormModal・DRY）。ここは開閉とモード/プリフィル元 id だけ持つ。
  const [open, setOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [formSourceId, setFormSourceId] = useState<string | null>(null); // edit/duplicate のプリフィル元

  useEffect(() => {
    const ac = new AbortController();
    fetchContests(undefined, ac.signal)
      .then((res) => { setItems(res.items); setCanManage(res.canManage); })
      .catch(() => { setItems([]); setCanManage(false); });
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
    setFormMode("create"); setFormSourceId(null); setOpen(true);
  }

  // プリフィルは ContestFormModal が contestId から取得する（詳細DTO）。ここは mode と元 id を渡すだけ。
  function openEditOrDuplicate(row: ContestRow, m: FormMode) {
    setFormMode(m); setFormSourceId(row.id); setOpen(true);
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

  // 行クリック/「詳細を開く」の分岐＝参加資格があれば詳細へ、承認制×未参加はダイアログ（応募導線・SC-53・設計 §2.3）。
  // backend も can_view_contest で詳細を 403 ガード（UI非表示に依存しない）。
  function goToContest(row: ContestRow) {
    if (canManage || row.autoApprove || row.myStatus === "approved") {
      markContestFromList();  // 戻るラベルを「← アイデアコンテスト一覧」にする来歴（一覧→詳細のときだけ）。
      router.push(`/contests/${row.id}`);
    } else {
      setApplyRow(row);
    }
  }

  async function applyToContest(row: ContestRow) {
    setApplying(true);
    try {
      const r = await requestContestParticipation(row.id);
      if (!r) { snack({ type: "error", title: "応募できませんでした" }); return; }
      if (r.status === "approved") {  // 念のため（auto_approve 化等）＝そのまま詳細へ。
        setApplyRow(null);
        router.push(`/contests/${row.id}`);
        return;
      }
      snack({ type: "success", title: "参加リクエストを送信しました（承認待ち）" });
      // 一覧の my_status を更新＝ダイアログを「承認待ち」に。
      setItems((cur) => (cur ?? []).map((c) => (c.id === row.id ? { ...c, my_status: "requested" } : c)));
      setApplyRow((cur) => (cur ? { ...cur, myStatus: "requested" } : cur));
    } catch {
      snack({ type: "error", title: "参加リクエストに失敗しました" });
    } finally {
      setApplying(false);
    }
  }

  // 行アクション＝標準順。運営（can_manage）のみ編集/複製/削除を出す（一般は「詳細を開く」のみ＝分岐）。
  const menu = (row: ContestRow): RowMenuItem[] => [
    { label: "詳細を開く", onClick: () => goToContest(row) },
    ...(canManage ? [
      { label: "編集", onClick: () => void openEditOrDuplicate(row, "edit") },
      { label: "複製", onClick: () => void openEditOrDuplicate(row, "duplicate") },
      { label: "削除", danger: true, onClick: () => void remove(row) },
    ] : []),
  ];

  const columns: DataTableColumn<ContestRow>[] = [
    {
      key: "theme", label: "テーマ", locked: true, width: 320, sortable: true, filter: { type: "text" },
      sortVal: (x) => x.theme, searchVal: (x) => x.theme, csvVal: (x) => x.theme,
      render: (x) => <span className="idea-title">{x.theme}</span>,
    },
    { key: "mode", label: "種別", width: 170, sortable: true, filter: { type: "enum", options: MODE_OPTIONS }, sortVal: (x) => x.modeLabel, filterVal: (x) => x.modeLabel, render: (x) => x.modeLabel },
    { key: "status", label: "状態", width: 120, sortable: true, sortVal: (x) => x.statusLabel, filterVal: (x) => x.statusLabel, render: (x) => <span className={`badge ${CONTEST_STATUS_BADGE[x.status] ?? "badge-muted"}`}>{x.statusLabel}</span> },
    { key: "join", label: "参加方式", width: 130, sortable: true, filter: { type: "enum", options: JOIN_MODE_OPTIONS }, sortVal: (x) => joinModeLabel(x), filterVal: (x) => joinModeLabel(x), csvVal: (x) => joinModeLabel(x), render: (x) => <span className={x.autoApprove ? "badge badge-success" : "badge badge-muted"} title={x.autoApprove ? "誰でも即参加（自動承認）" : "参加には運営の承認が必要"}>{joinModeLabel(x)}</span> },
    { key: "starts", label: "開始", width: 120, sortable: true, sortVal: (x) => x.starts, csvVal: (x) => x.starts, render: (x) => x.starts },
    { key: "ends", label: "締切", width: 120, sortable: true, sortVal: (x) => x.ends, csvVal: (x) => x.ends, render: (x) => x.ends },
    { key: "_actions", label: "", actions: true, locked: true, width: 64, render: (x) => <RowMenu items={menu(x)} /> },
  ];

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
          onRowClick={(x) => goToContest(x)}
          card={(x) => (
            <>
              <div className="between">
                <span className="card-title">{x.theme}</span>
                <span className={`badge ${CONTEST_STATUS_BADGE[x.status] ?? "badge-muted"}`}>{x.statusLabel}</span>
              </div>
              <div className="contest-card__meta">
                <span className="badge badge-muted">{x.modeLabel}</span>
                <span className={x.autoApprove ? "badge badge-success" : "badge badge-muted"}>{joinModeLabel(x)}</span>
                <span>⏳ {x.starts} 〜 {x.ends}</span>
              </div>
            </>
          )}
        />
      )}

      {/* 作成/編集/複製は共有 ContestFormModal（詳細 SC-54 と共用・DRY）。保存後は一覧を再取得。 */}
      <ContestFormModal open={open} mode={formMode} contestId={formSourceId}
        onClose={() => setOpen(false)} onSaved={() => setReload((n) => n + 1)} />

      {/* 応募ダイアログ（承認制×未参加＝概要＋メタのみ確認し、ここから応募・SC-53・設計 §2.3）。 */}
      {applyRow && (
        <Modal open={!!applyRow} title={applyRow.theme} size="md" onClose={() => setApplyRow(null)}>
          <div className="modal__body">
            <p className="muted text-sm" style={{ marginTop: 0 }}>
              このコンテストは参加承認制です。参加すると応募・投票や内容の閲覧ができます。
            </p>
            {applyRow.description && <p style={{ whiteSpace: "pre-wrap" }}>{applyRow.description}</p>}
            <dl className="contest-meta" style={{ marginTop: "var(--space-3)" }}>
              <div><dt>種別</dt><dd>{applyRow.modeLabel}</dd></div>
              <div><dt>会期</dt><dd>{applyRow.starts} 〜 {applyRow.ends}</dd></div>
              <div><dt>状態</dt><dd><span className={`badge ${CONTEST_STATUS_BADGE[applyRow.status] ?? "badge-muted"}`}>{applyRow.statusLabel}</span></dd></div>
              <div><dt>参加人数</dt><dd>{applyRow.participantCount} 人</dd></div>
            </dl>
          </div>
          <div className="modal__footer">
            <button className="btn btn-outline dialog-close-left" type="button" onClick={() => setApplyRow(null)} disabled={applying}>閉じる</button>
            {applyRow.myStatus === "requested" ? (
              <span className="badge badge-muted">⏳ 承認待ち</span>
            ) : applyRow.status === "open" ? (
              <Button variant="primary" onClick={() => void applyToContest(applyRow)} loading={applying}>応募する</Button>
            ) : (
              <span className="muted text-sm">現在は応募を受け付けていません</span>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
