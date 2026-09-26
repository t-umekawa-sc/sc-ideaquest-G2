"use client";

// SC-61 コンセプトの変更履歴＝内容の版（更新履歴・概要パネルのリンクUI）＋意思決定ログ（総合判定/ステータスの遷移）。
// 版タイムラインは共有 RevisionTimeline（variant="idea"）で描画（標準＝doc/設計ドラフト/変更履歴標準.md §3.1/§3.2）。
import { useEffect, useState } from "react";

import { RevisionTimeline, type RevisionDiff, type RevisionRow } from "@/components/ui/RevisionTimeline";

import {
  getConceptDecisionLog,
  getConceptRevisionDiff,
  getConceptRevisions,
  type ConceptDecisionLog,
} from "../api";

// 版で追跡するフィールドの表示名（成果物スキーマ・§3.1）。
const FIELD_LABELS: Record<string, string> = {
  title: "コンセプト名",
  problem: "課題・機会",
  value_proposition: "狙う価値（価値提案）",
  target: "対象",
  differentiation: "競合・差別化",
  solution_form: "解の形態＋必要な能力",
  viability: "採算・事業性（viability）",
  assumptions: "前提と検証（リンク/判定）",
};

export function ConceptRevisionHistory({ conceptId, currentRevision }: { conceptId: string; currentRevision: number }) {
  const [revs, setRevs] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getConceptRevisions(conceptId)
      .then((r) => alive && setRevs((r?.data ?? []) as unknown as RevisionRow[]))
      .catch(() => alive && setError("更新履歴の取得に失敗しました。"));
    return () => { alive = false; };
  }, [conceptId]);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!revs) return <p className="admin-muted">読み込み中…</p>;
  if (revs.length === 0) return <p className="role-note" style={{ marginTop: 0 }}>まだ更新履歴がありません。</p>;

  return (
    <RevisionTimeline
      variant="idea"
      revisions={revs}
      currentRevision={currentRevision}
      fieldLabels={FIELD_LABELS}
      loadDiff={(r) => getConceptRevisionDiff(conceptId, r) as Promise<RevisionDiff | null>}
      initialNote="コンセプトを作成。"
    />
  );
}

const KIND_LABEL: Record<string, string> = { decision: "総合判定", status: "ステータス" };
const DECISION_LABEL: Record<string, string> = { undecided: "未判定", go: "推進(Go)", pivot: "方向転換(Pivot)", kill: "中止(Kill)" };
const STATUS_LABEL: Record<string, string> = { draft: "下書き", active: "有効", archived: "保管" };

function labelFor(kind: string, v: string | null | undefined): string {
  if (!v) return "—";
  return (kind === "decision" ? DECISION_LABEL[v] : STATUS_LABEL[v]) ?? v;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 総合判定/ステータスの遷移ログ（新しい順・§3.2）。判断材料（当時の投票/評価/前提）も併記。
export function ConceptDecisionLogView({ conceptId }: { conceptId: string }) {
  const [log, setLog] = useState<ConceptDecisionLog["data"] | null>(null);
  useEffect(() => {
    let alive = true;
    void getConceptDecisionLog(conceptId).then((r) => alive && setLog(r?.data ?? [])).catch(() => alive && setLog([]));
    return () => { alive = false; };
  }, [conceptId]);

  if (!log) return <p className="admin-muted">読み込み中…</p>;
  if (log.length === 0) return <p className="role-note" style={{ marginTop: 0 }}>まだ判定・ステータスの変更履歴がありません。</p>;

  return (
    <ul className="decision-log">
      {log.map((e, i) => {
        const ctx = (e.context_snapshot ?? {}) as { votes?: { approve?: number; oppose?: number }; eval?: { evaluator_count?: number }; assumptions?: { supported?: number; refuted?: number; inconclusive?: number } };
        return (
          <li key={i} className="decision-log__item">
            <div className="decision-log__head">
              <span className="badge badge-muted">{KIND_LABEL[e.kind] ?? e.kind}</span>
              <span className="decision-log__change">{labelFor(e.kind, e.from_value)} → <strong>{labelFor(e.kind, e.to_value)}</strong></span>
              <span className="decision-log__at">{fmtDateTime(e.created_at)}</span>
            </div>
            {e.actor?.display_name && <div className="decision-log__who">{e.actor.display_name}</div>}
            {e.reason && <div className="decision-log__reason">📝 {e.reason}</div>}
            {e.context_snapshot && (
              <div className="decision-log__ctx role-note">
                当時の材料＝👍{ctx.votes?.approve ?? 0}/👎{ctx.votes?.oppose ?? 0}・評価{ctx.eval?.evaluator_count ?? 0}名・前提(支持{ctx.assumptions?.supported ?? 0}/反証{ctx.assumptions?.refuted ?? 0}/保留{ctx.assumptions?.inconclusive ?? 0})
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
