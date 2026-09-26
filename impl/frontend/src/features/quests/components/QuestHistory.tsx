"use client";

// SC-12 クエストの変更履歴＝定義の版（更新履歴・概要パネルのリンクUI）＋ステータス意思決定ログ。
// 版タイムラインは共有 RevisionTimeline（variant="idea"）で描画（標準＝doc/設計ドラフト/変更履歴標準.md §3.1/§3.2）。
import { useEffect, useState } from "react";

import { RevisionTimeline, type RevisionDiff, type RevisionRow } from "@/components/ui/RevisionTimeline";

import { getQuestDecisionLog, getQuestRevisionDiff, getQuestRevisions, type QuestDecisionLog } from "../api";

// 定義で追跡するフィールドの表示名（§3.1）。
const FIELD_LABELS: Record<string, string> = {
  title: "クエスト名",
  purpose: "目的・テーマ",
  color: "カラー",
  deadline: "締切",
  categories: "カテゴリー",
};

export function QuestRevisionHistory({ questId }: { questId: string }) {
  const [revs, setRevs] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    let alive = true;
    void getQuestRevisions(questId)
      .then((r) => {
        if (!alive) return;
        const data = (r?.data ?? []) as unknown as RevisionRow[];
        setRevs(data);
        setCurrent(data[0]?.revision ?? 0); // 降順＝先頭が最新
      })
      .catch(() => alive && setError("更新履歴の取得に失敗しました。"));
    return () => { alive = false; };
  }, [questId]);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!revs) return <p className="admin-muted">読み込み中…</p>;
  if (revs.length === 0) return <p className="role-note" style={{ marginTop: 0 }}>まだ更新履歴がありません。</p>;

  return (
    <RevisionTimeline
      variant="idea"
      revisions={revs}
      currentRevision={current}
      fieldLabels={FIELD_LABELS}
      loadDiff={(r) => getQuestRevisionDiff(questId, r) as Promise<RevisionDiff | null>}
      initialNote="クエストを作成。"
    />
  );
}

const STATUS_LABEL: Record<string, string> = { draft: "下書き", recruiting: "募集中", in_progress: "進行中", evaluating: "評価中", completed: "完了" };

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ステータス遷移ログ（新しい順・§3.2）。
export function QuestDecisionLogView({ questId }: { questId: string }) {
  const [log, setLog] = useState<QuestDecisionLog["data"] | null>(null);
  useEffect(() => {
    let alive = true;
    void getQuestDecisionLog(questId).then((r) => alive && setLog(r?.data ?? [])).catch(() => alive && setLog([]));
    return () => { alive = false; };
  }, [questId]);

  if (!log) return <p className="admin-muted">読み込み中…</p>;
  if (log.length === 0) return <p className="role-note" style={{ marginTop: 0 }}>まだステータスの変更履歴がありません。</p>;

  return (
    <ul className="decision-log">
      {log.map((e, i) => (
        <li key={i} className="decision-log__item">
          <div className="decision-log__head">
            <span className="badge badge-muted">ステータス</span>
            <span className="decision-log__change">{STATUS_LABEL[e.from_value ?? ""] ?? e.from_value ?? "—"} → <strong>{STATUS_LABEL[e.to_value] ?? e.to_value}</strong></span>
            <span className="decision-log__at">{fmtDateTime(e.created_at)}</span>
          </div>
          {e.actor?.display_name && <div className="decision-log__who">{e.actor.display_name}</div>}
        </li>
      ))}
    </ul>
  );
}
