"use client";

// SC-22 更新履歴モーダルの中身（D.4 版タイムライン＋差分・実接続）。正＝doc/画面設計/mocks/SC-22_アイデア詳細.html。
// 版一覧を getRevisions で取得し、共有 RevisionTimeline（variant="idea"＝概要パネルのリンクUI）で描画。
// 差分は展開時に getRevisionDiff で遅延取得（共通コンポーネント側）。標準＝doc/設計ドラフト/変更履歴標準.md §3.1。
import { useEffect, useState } from "react";

import { RevisionTimeline, type RevisionDiff, type RevisionRow } from "@/components/ui/RevisionTimeline";

import { getRevisionDiff, getRevisions, type IdeaRevision } from "../api";

// 版で追跡するフィールドの表示名（D.4・§5.14）。
const FIELD_LABELS: Record<string, string> = {
  title: "件名",
  value: "価値",
  body: "アイデア本文",
  note: "備考 / 特記事項",
  time_limit: "タイムリミット",
  stakeholders: "利害関係者",
  attachments: "📎 添付",
};

export function RevisionHistory({ ideaId, currentRevision }: { ideaId: string; currentRevision: number }) {
  const [revs, setRevs] = useState<IdeaRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getRevisions(ideaId)
      .then((r) => alive && setRevs(r?.data ?? []))
      .catch(() => alive && setError("更新履歴の取得に失敗しました。"));
    return () => {
      alive = false;
    };
  }, [ideaId]);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!revs) return <p className="admin-muted">読み込み中…</p>;
  if (revs.length === 0) return <p className="role-note" style={{ marginTop: 0 }}>まだ更新履歴がありません。</p>;

  return (
    <RevisionTimeline
      variant="idea"
      revisions={revs as unknown as RevisionRow[]}
      currentRevision={currentRevision}
      fieldLabels={FIELD_LABELS}
      loadDiff={(r) => getRevisionDiff(ideaId, r) as Promise<RevisionDiff | null>}
      initialNote="アイデアを投稿。"
    />
  );
}
