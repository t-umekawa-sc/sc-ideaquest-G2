"use client";

// SC-12「🧩 コンセプト」タブ（FR-42・P.1）＝候補コンセプト一覧＋検証プール（前提）＋作成導線＋冒頭ガイダンス。
// 一覧は共有 DataTable（検索/並び替え/絞込/カード-リスト/エクスポート/操作列）＝他一覧と同じ標準UI。
// 正＝doc/画面設計/screens/SC-12_クエスト詳細.md §4.6。行クリックで SC-61 詳細へ。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, DataTable, Field, Modal, ModalBody, ModalFooter, RowMenu, ScreenPurpose, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { QUEST_SCROLL_KEY } from "@/lib/nav";

import {
  CONCEPTS_CHANGED_EVENT,
  createAssumption,
  deleteAssumption,
  deleteConcept,
  listAssumptions,
  listConcepts,
  patchAssumption,
  type AssumptionListResponse,
  type ConceptListItem,
} from "../api";
import "../concepts.css";

type Assumption = AssumptionListResponse["items"][number];

const STATUS_LABEL: Record<string, string> = { draft: "下書き", active: "検証中", archived: "保管" };
const DECISION_LABEL: Record<string, string> = { undecided: "未判定", go: "推進", pivot: "方向転換", kill: "中止" };
const DECISION_CLS: Record<string, string> = { undecided: "badge badge-muted", go: "badge badge-success", pivot: "badge badge-muted", kill: "badge badge-danger" };
const VERDICT_LABEL: Record<string, [string, string]> = {
  inconclusive: ["保留", "badge badge-muted"],
  supported: ["支持", "badge badge-success"],
  refuted: ["反証", "badge badge-danger"],
};

const STATUS_OPTIONS: [string, string][] = [["下書き", "下書き"], ["検証中", "検証中"], ["保管", "保管"]];
const DECISION_OPTIONS: [string, string][] = [["未判定", "未判定"], ["推進", "推進"], ["方向転換", "方向転換"], ["中止", "中止"]];
const SELECTED_OPTIONS: [string, string][] = [["選定", "選定"], ["未選定", "未選定"]];
const VERDICT_OPTIONS: [string, string][] = [["保留", "保留"], ["支持", "支持"], ["反証", "反証"]];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function evalText(c: ConceptListItem): string {
  return c.eval_summary.evaluator_count > 0 ? `${c.eval_summary.overall_avg?.toFixed(1) ?? "—"}（${c.eval_summary.evaluator_count}）` : "—";
}

export function ConceptTab({ questId, canManage = false }: { questId: string; canManage?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [concepts, setConcepts] = useState<ConceptListItem[] | null>(null);
  const [pool, setPool] = useState<Assumption[] | null>(null);
  // 前提の追加/編集ダイアログ（ユーザー要望＝インライン入力→ダイアログ）。
  const [assumptionDialog, setAssumptionDialog] = useState<{ mode: "create" | "edit"; id?: string; statement: string } | null>(null);
  const [savingAssumption, setSavingAssumption] = useState(false);

  const load = useCallback(() => {
    listConcepts(questId).then((r) => setConcepts(r?.items ?? []));
    listAssumptions(questId).then((r) => setPool(r?.items ?? []));
  }, [questId]);

  // 詳細へドリルインする直前にスクロール位置を保存＝戻り時に復元（§4.12・QuestDetailView と同じキー）。
  const openConcept = useCallback((id: string) => {
    try { sessionStorage.setItem(QUEST_SCROLL_KEY + questId, String(window.scrollY)); } catch { /* 無視 */ }
    router.push(`/concepts/${id}`);
  }, [router, questId]);

  // 複製＝作成フォームを元コンセプトでプリフィル（?dup）。削除＝作成者本人 or owner/quest_admin（論理削除）。
  const conceptMenu = useCallback((c: ConceptListItem): RowMenuItem[] => {
    const items: RowMenuItem[] = [
      { label: "複製", onClick: () => router.push(`/quests/${questId}/concepts/new?dup=${c.id}`) },
    ];
    if (c.is_mine || canManage) {
      items.push({
        label: "削除",
        danger: true,
        onClick: async () => {
          const ok = await confirm({
            variant: "danger",
            title: "コンセプトを削除",
            msg: `「${c.title}」を削除しますか？ 一覧・詳細から見えなくなります（評価・議論・前提リンク等は監査のため保持されます）。`,
          });
          if (!ok) return;
          try {
            await deleteConcept(c.id);
            window.dispatchEvent(new CustomEvent(CONCEPTS_CHANGED_EVENT));
            snack({ type: "success", title: "コンセプトを削除しました" });
          } catch {
            snack({ type: "error", title: "削除できませんでした", msg: "時間をおいて再度お試しください。" });
          }
        },
      });
    }
    return items;
  }, [router, questId, canManage, confirm, snack]);

  // 前提の追加/編集をダイアログで保存（P.3・検証プール所有＝owner/quest_admin）。statement のみ。
  const saveAssumption = useCallback(async () => {
    if (!assumptionDialog || savingAssumption) return;
    const stmt = assumptionDialog.statement.trim();
    // 主ボタンは常に押せる（dirty ゲートで無効化しない・デザイン標準 §4.1）。空なら押下時に検証エラーを通知。
    if (!stmt) { snack({ type: "error", title: "前提を入力してください" }); return; }
    setSavingAssumption(true);
    try {
      if (assumptionDialog.mode === "edit" && assumptionDialog.id) {
        await patchAssumption(assumptionDialog.id, stmt);
        snack({ type: "success", title: "前提を更新しました" });
      } else {
        await createAssumption(questId, stmt);
        snack({ type: "success", title: "前提を追加しました" });
      }
      setAssumptionDialog(null);
      load();
    } catch {
      snack({ type: "error", title: "保存できませんでした", msg: "権限（owner/クエスト管理者）と入力をご確認ください。" });
    } finally {
      setSavingAssumption(false);
    }
  }, [assumptionDialog, savingAssumption, questId, load, snack]);

  // 前提の行メニュー（編集/削除）＝検証プール所有（owner/quest_admin）のみ。
  const assumptionMenu = useCallback((a: Assumption): RowMenuItem[] => [
    { label: "編集", onClick: () => setAssumptionDialog({ mode: "edit", id: a.id, statement: a.statement }) },
    {
      label: "削除",
      danger: true,
      onClick: async () => {
        const ok = await confirm({ variant: "danger", title: "前提を削除", msg: `「${a.statement}」を削除しますか？（リンク中のコンセプトからも外れます）` });
        if (!ok) return;
        try {
          await deleteAssumption(a.id);
          window.dispatchEvent(new CustomEvent(CONCEPTS_CHANGED_EVENT));
          load();
          snack({ type: "success", title: "前提を削除しました" });
        } catch {
          snack({ type: "error", title: "削除できませんでした", msg: "時間をおいて再度お試しください。" });
        }
      },
    },
  ], [confirm, load, snack]);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
  }, [load]);

  // 候補コンセプト一覧の列（標準 DataTable）。行クリックで SC-61 詳細へ。操作列＝複製/削除。
  const conceptColumns: DataTableColumn<ConceptListItem>[] = [
    {
      key: "title", label: "名前", locked: true, width: 260, sortable: true, filter: { type: "text" },
      sortVal: (c) => c.title, searchVal: (c) => c.title, csvVal: (c) => c.title,
      render: (c) => <Link href={`/concepts/${c.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openConcept(c.id); }}>{c.title}</Link>,
    },
    { key: "status", label: "状態", width: 110, sortable: true, filter: { type: "enum", options: STATUS_OPTIONS }, sortVal: (c) => STATUS_LABEL[c.status] ?? c.status, filterVal: (c) => STATUS_LABEL[c.status] ?? c.status, render: (c) => STATUS_LABEL[c.status] ?? c.status },
    { key: "decision", label: "判定", width: 110, sortable: true, filter: { type: "enum", options: DECISION_OPTIONS }, sortVal: (c) => DECISION_LABEL[c.decision] ?? c.decision, filterVal: (c) => DECISION_LABEL[c.decision] ?? c.decision, render: (c) => <span className={DECISION_CLS[c.decision] ?? "badge badge-muted"}>{DECISION_LABEL[c.decision] ?? c.decision}</span> },
    { key: "selected", label: "選定", width: 90, sortable: true, filter: { type: "enum", options: SELECTED_OPTIONS }, sortVal: (c) => (c.is_selected ? 1 : 0), filterVal: (c) => (c.is_selected ? "選定" : "未選定"), csvVal: (c) => (c.is_selected ? "選定" : ""), render: (c) => (c.is_selected ? <span className="badge badge-success">★ 選定</span> : "") },
    { key: "source", label: "由来", width: 80, align: "num", sortable: true, sortVal: (c) => c.source_idea_count, render: (c) => c.source_idea_count },
    { key: "assumption", label: "前提", width: 80, align: "num", sortable: true, sortVal: (c) => c.assumption_count, render: (c) => c.assumption_count },
    { key: "eval", label: "評価", width: 110, sortable: true, sortVal: (c) => c.eval_summary.overall_avg ?? -1, csvVal: (c) => evalText(c), render: (c) => evalText(c) },
    { key: "updated", label: "更新", width: 120, sortable: true, sortVal: (c) => c.updated_at ?? "", csvVal: (c) => fmtDate(c.updated_at), render: (c) => fmtDate(c.updated_at) },
    { key: "_actions", label: "", actions: true, locked: true, width: 56, render: (c) => <RowMenu items={conceptMenu(c)} /> },
  ];

  // 検証プール（前提）の列（標準 DataTable）。前提は複数コンセプトで共有（DRY）。
  const assumptionColumns: DataTableColumn<Assumption>[] = [
    { key: "statement", label: "前提", locked: true, width: 320, sortable: true, filter: { type: "text" }, sortVal: (a) => a.statement, searchVal: (a) => a.statement, csvVal: (a) => a.statement, render: (a) => <span className="cell-wrap">{a.statement}</span> },
    { key: "verdict", label: "現在判定", width: 110, sortable: true, filter: { type: "enum", options: VERDICT_OPTIONS }, sortVal: (a) => (VERDICT_LABEL[a.current_verdict]?.[0] ?? a.current_verdict), filterVal: (a) => (VERDICT_LABEL[a.current_verdict]?.[0] ?? a.current_verdict), render: (a) => { const [vl, vc] = VERDICT_LABEL[a.current_verdict] ?? [a.current_verdict, "badge badge-muted"]; return <span className={vc}>{vl}</span>; } },
    { key: "validation", label: "検証", width: 80, align: "num", sortable: true, sortVal: (a) => a.validation_count, render: (a) => a.validation_count },
    { key: "linked", label: "リンク中", width: 90, align: "num", sortable: true, sortVal: (a) => a.linked_concept_count, render: (a) => a.linked_concept_count },
    { key: "latest", label: "最終検証", width: 110, sortable: true, sortVal: (a) => a.latest_validated_on ?? "", render: (a) => a.latest_validated_on ?? "—" },
    // 操作列（編集/削除）＝検証プール所有（owner/quest_admin）のみ。
    ...(canManage ? [{ key: "_actions", label: "", actions: true, locked: true, width: 56, render: (a: Assumption) => <RowMenu items={assumptionMenu(a)} /> } as DataTableColumn<Assumption>] : []),
  ];

  return (
    <div className="concept-tab" data-sp-host>
      <div className="concept-tab-head">
        <ScreenPurpose
          label="コンセプトとは？"
          summary="選別済みアイデアを統合し、前提を「証拠で」検証しながら 推進/方向転換/中止 まで導く検証可能な提案（ISO 56001 §8.3 ②③段）。🏁結果の申し送りを受けて次段へ。"
          dialogTitle="コンセプトとは（ISO 56001 準拠）"
        >
          <p style={{ margin: 0 }}>選別済みのアイデアを統合し、<strong>課題・機会／価値提案／差別化／採算（viability）／前提と検証</strong>をまとめた<strong>検証可能な提案</strong>です。1 クエスト内に複数候補が競合し、評価と検証を経て所有者が勝ち残りを選定します（ISO 56001 §8.3 ②③段）。</p>
        </ScreenPurpose>
      </div>

      {/* 候補コンセプト一覧（標準 DataTable）。作成ボタンは「候補コンセプト」見出しの右（検証プールと統一）。 */}
      <section className="concept-tab-section">
        <div className="concept-tab-head" style={{ marginBottom: "var(--space-2)" }}>
          <h3 style={{ margin: 0 }}>候補コンセプト</h3>
          <Link href={`/quests/${questId}/concepts/new`} className="btn btn-primary">＋ コンセプトを作成</Link>
        </div>
        {concepts === null ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <DataTable<ConceptListItem>
            storageKey="sc12-concepts"
            data={concepts}
            columns={conceptColumns}
            rowId={(c) => c.id}
            unit="件"
            perPage={20}
            searchFields="名前"
            exportName="候補コンセプト"
            emptyText="まだコンセプトはありません。「＋ コンセプトを作成」から起票できます。"
            onRowClick={(c) => openConcept(c.id)}
            pins={false}
            defaultView="list"
            cardLayout={(c) => ({
              title: c.title,
              badges: [
                { label: STATUS_LABEL[c.status] ?? c.status, cls: "badge badge-muted" },
                { label: DECISION_LABEL[c.decision] ?? c.decision, cls: DECISION_CLS[c.decision] ?? "badge badge-muted" },
                c.is_selected ? { label: "★ 選定", cls: "badge badge-success" } : null,
              ],
              stats: [`由来 ${c.source_idea_count}`, `前提 ${c.assumption_count}`, `評価 ${evalText(c)}`, `更新 ${fmtDate(c.updated_at)}`],
            })}
          />
        )}
      </section>

      {/* 検証プール（前提・標準 DataTable） */}
      <section className="concept-tab-section">
        <div className="concept-tab-head" style={{ marginBottom: "var(--space-2)" }}>
          <h3 style={{ margin: 0 }}>検証プール（前提）</h3>
          {/* 前提の追加＝owner/quest_admin のみ（P.3 検証プール所有）。追加/編集はダイアログで行う。 */}
          {canManage && (
            <Button type="button" variant="primary" onClick={() => setAssumptionDialog({ mode: "create", statement: "" })}>＋ 前提を追加</Button>
          )}
        </div>
        {pool === null ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <DataTable<Assumption>
            storageKey="sc12-assumptions"
            data={pool}
            columns={assumptionColumns}
            rowId={(a) => a.id}
            unit="件"
            perPage={20}
            searchFields="前提"
            exportName="検証プール"
            emptyText="検証プールは空です。"
            pins={false}
            defaultView="list"
            onRowClick={canManage ? (a) => setAssumptionDialog({ mode: "edit", id: a.id, statement: a.statement }) : undefined}
            cardLayout={(a) => ({
              title: a.statement,
              badges: [{ label: VERDICT_LABEL[a.current_verdict]?.[0] ?? a.current_verdict, cls: VERDICT_LABEL[a.current_verdict]?.[1] ?? "badge badge-muted" }],
              stats: [`検証 ${a.validation_count}`, `リンク中 ${a.linked_concept_count}`, `最終検証 ${a.latest_validated_on ?? "—"}`],
            })}
          />
        )}
      </section>

      {/* 前提の追加/編集ダイアログ（P.3・statement のみ）。 */}
      {assumptionDialog && (
        <Modal open onClose={() => setAssumptionDialog(null)} title={assumptionDialog.mode === "edit" ? "前提を編集" : "前提を追加"} size="md">
          <ModalBody>
            <Field className="dialog-section is-quiet" id="assumption_statement" label="前提（検証したい仮説）" hint="例: 想定顧客は月1回以上この課題に直面する" required>
              <textarea
                className="textarea"
                value={assumptionDialog.statement}
                onChange={(e) => setAssumptionDialog((d) => (d ? { ...d, statement: e.target.value } : d))}
                placeholder="検証したい前提を入力"
                rows={3}
                autoFocus
              />
            </Field>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" className="dialog-close-left" onClick={() => setAssumptionDialog(null)}>キャンセル</Button>
            <Button type="button" variant="primary" disabled={savingAssumption} loading={savingAssumption} onClick={() => void saveAssumption()}>{assumptionDialog.mode === "edit" ? "更新" : "追加"}</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
