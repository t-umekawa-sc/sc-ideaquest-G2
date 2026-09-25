"use client";

// SC-12「🧩 コンセプト」タブ（FR-42・P.1）＝候補コンセプト一覧＋検証プール（前提）＋作成導線＋冒頭ガイダンス。
// 一覧は暫定クライアント表示（backend の DataTable クエリ契約は未実装＝サーバー委譲は follow-up・フロント実装フロー §4.1）。
// 正＝doc/画面設計/screens/SC-12_クエスト詳細.md §4.6。行クリックで SC-61 詳細へ。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, ScreenPurpose } from "@/components/ui";
import { QUEST_SCROLL_KEY } from "@/lib/nav";

import {
  CONCEPTS_CHANGED_EVENT,
  listAssumptions,
  listConcepts,
  type AssumptionListResponse,
  type ConceptListItem,
} from "../api";
import "../concepts.css";

const STATUS_LABEL: Record<string, string> = { draft: "下書き", active: "検証中", archived: "保管" };
const DECISION_LABEL: Record<string, string> = { undecided: "未判定", go: "推進", pivot: "方向転換", kill: "中止" };
const VERDICT_LABEL: Record<string, [string, string]> = {
  inconclusive: ["保留", "badge badge-muted"],
  supported: ["支持", "badge badge-success"],
  refuted: ["反証", "badge badge-danger"],
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function ConceptTab({ questId }: { questId: string }) {
  const router = useRouter();
  const [concepts, setConcepts] = useState<ConceptListItem[] | null>(null);
  const [pool, setPool] = useState<AssumptionListResponse["items"] | null>(null);

  const load = useCallback(() => {
    listConcepts(questId).then((r) => setConcepts(r?.items ?? []));
    listAssumptions(questId).then((r) => setPool(r?.items ?? []));
  }, [questId]);

  // 詳細へドリルインする直前にスクロール位置を保存＝戻り時に復元（§4.12・QuestDetailView と同じキー）。
  const openConcept = useCallback((id: string) => {
    try { sessionStorage.setItem(QUEST_SCROLL_KEY + questId, String(window.scrollY)); } catch { /* 無視 */ }
    router.push(`/concepts/${id}`);
  }, [router, questId]);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
  }, [load]);

  return (
    <div className="concept-tab" data-sp-host>
      <div className="concept-tab-head">
        <ScreenPurpose
          label="コンセプトとは？"
          summary="選別済みアイデアを統合し、前提を「証拠で」検証しながら Go/Pivot/Kill まで導く検証可能な提案（ISO 56001 §8.3 ②③段）。🏁結果の申し送りを受けて次段へ。"
          dialogTitle="コンセプトとは（ISO 56001 準拠）"
        >
          <p style={{ margin: 0 }}>選別済みのアイデアを統合し、<strong>課題・機会／価値提案／差別化／採算（viability）／前提と検証</strong>をまとめた<strong>検証可能な提案</strong>です。1 クエスト内に複数候補が競合し、評価と検証を経て owner が勝ち残りを選定します（ISO 56001 §8.3 ②③段）。</p>
        </ScreenPurpose>
        <Link href={`/quests/${questId}/concepts/new`} className="btn btn-primary">＋ コンセプトを作成</Link>
      </div>

      {/* 候補コンセプト一覧 */}
      <section className="concept-tab-section">
        <h3>候補コンセプト</h3>
        {concepts === null ? (
          <p className="muted">読み込み中…</p>
        ) : concepts.length === 0 ? (
          <EmptyState title="まだコンセプトはありません" hint="「＋ コンセプトを作成」から起票できます。" />
        ) : (
          <div className="table-wrap">
            <table className="table concept-table">
              <thead>
                <tr><th>名前</th><th>状態</th><th>判定</th><th>選定</th><th>由来</th><th>前提</th><th>評価</th><th>更新</th></tr>
              </thead>
              <tbody>
                {concepts.map((c) => (
                  <tr key={c.id} className="is-clickable" onClick={() => openConcept(c.id)}>
                    <td><Link href={`/concepts/${c.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openConcept(c.id); }}>{c.title}</Link></td>
                    <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                    <td>{DECISION_LABEL[c.decision] ?? c.decision}</td>
                    <td>{c.is_selected ? "★" : ""}</td>
                    <td>{c.source_idea_count}</td>
                    <td>{c.assumption_count}</td>
                    <td>{c.eval_summary.evaluator_count > 0 ? `${c.eval_summary.overall_avg?.toFixed(1) ?? "—"}（${c.eval_summary.evaluator_count}）` : "—"}</td>
                    <td>{fmtDate(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 検証プール（前提） */}
      <section className="concept-tab-section">
        <h3>検証プール（前提）</h3>
        {pool === null ? (
          <p className="muted">読み込み中…</p>
        ) : pool.length === 0 ? (
          <p className="muted text-sm">検証プールは空です。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>前提</th><th>現在判定</th><th>検証</th><th>リンク中</th><th>最終検証</th></tr>
              </thead>
              <tbody>
                {pool.map((a) => {
                  const [vl, vc] = VERDICT_LABEL[a.current_verdict] ?? [a.current_verdict, "badge badge-muted"];
                  return (
                    <tr key={a.id}>
                      <td className="cell-wrap">{a.statement}</td>
                      <td><span className={vc}>{vl}</span></td>
                      <td>{a.validation_count}</td>
                      <td>{a.linked_concept_count}</td>
                      <td>{a.latest_validated_on ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
