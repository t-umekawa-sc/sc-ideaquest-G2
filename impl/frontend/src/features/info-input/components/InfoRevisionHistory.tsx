"use client";

// SC-50 §85 更新履歴の中身＝折り畳みUI（variant="info"）。版一覧は詳細（GET /info-items/{id}）埋め込みの content_revisions を使い、
// 差分は展開時に getInfoRevisionDiff で取得。共通 RevisionTimeline に統合（標準＝doc/設計ドラフト/変更履歴標準.md §3.1）。
import { RevisionTimeline, type RevisionDiff, type RevisionRow } from "@/components/ui/RevisionTimeline";

import { getInfoRevisionDiff } from "../api";
import type { InfoRevision } from "../types";

// 版で追跡するフィールドの表示名（§85・§17＝内容＝タイトル/本文/出典URL/参考資料）。
const FIELD_LABELS: Record<string, string> = {
  title: "タイトル",
  body_html: "本文・説明",
  source_url: "出典URL",
  attachments: "📎 参考資料",
};

export function InfoRevisionHistory({ infoId, revisions }: { infoId: string; revisions: InfoRevision[] }) {
  if (!revisions.length) return null;
  const current = revisions[0]?.revision ?? 1; // 降順＝先頭が最新（＝現在）
  return (
    <RevisionTimeline
      variant="info"
      revisions={revisions as unknown as RevisionRow[]}
      currentRevision={current}
      fieldLabels={FIELD_LABELS}
      loadDiff={(r) => getInfoRevisionDiff(infoId, r) as Promise<RevisionDiff | null>}
      initialNote="情報を登録。"
    />
  );
}
