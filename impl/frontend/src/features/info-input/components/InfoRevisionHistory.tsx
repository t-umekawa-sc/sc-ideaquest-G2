"use client";

// SC-50 §85 更新履歴の中身＝各版に「変更フィールドのバッジ」＋「差分を表示」で遅延取得（アイデア SC-22/D.4 相当）。
// 版一覧は詳細（GET /info-items/{id}）に埋め込み済みの content_revisions を使い、差分は展開時に getInfoRevisionDiff で取得。
import { useCallback, useState } from "react";

import { getInfoRevisionDiff } from "../api";
import type { InfoRevision, InfoRevisionDiff } from "../types";

// 版で追跡するフィールドの表示名（§85・§17＝内容＝タイトル/本文/出典URL/参考資料）。
const FIELD_LABELS: Record<string, string> = {
  title: "タイトル",
  body_html: "本文・説明",
  source_url: "出典URL",
  attachments: "📎 参考資料",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function InfoRevisionHistory({ infoId, revisions }: { infoId: string; revisions: InfoRevision[] }) {
  if (!revisions.length) return null;
  const current = revisions[0]?.revision; // 降順＝先頭が最新（＝現在）
  return (
    <div className="info-rev-list">
      {revisions.map((rev) => (
        <RevisionItem key={rev.revision} infoId={infoId} rev={rev} isCurrent={rev.revision === current} />
      ))}
    </div>
  );
}

function RevisionItem({ infoId, rev, isCurrent }: { infoId: string; rev: InfoRevision; isCurrent: boolean }) {
  const [diff, setDiff] = useState<InfoRevisionDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const isInitial = rev.revision === 1;

  // 差分は展開時に遅延取得（既定＝前版比較）。取得済みなら再取得しない。
  const loadDiff = useCallback(async () => {
    if (diff || loading || isInitial) return;
    setLoading(true);
    try {
      setDiff(await getInfoRevisionDiff(infoId, rev.revision));
    } catch {
      /* 展開時の失敗は非致命（空表示）。 */
    } finally {
      setLoading(false);
    }
  }, [infoId, rev.revision, diff, loading, isInitial]);

  return (
    <div className={`info-rev${isCurrent ? " is-current" : ""}`}>
      <div className="info-rev__head">
        <span className="info-rev__ver">版 {rev.revision}</span>
        {isCurrent && <span className="badge badge-muted">現在</span>}
        {isInitial && <span className="badge badge-muted">初版</span>}
        <span className="info-rev__who">{rev.editor_name ?? "—"}</span>
        <span className="info-rev__at">{fmtDateTime(rev.created_at)}</span>
      </div>
      {rev.changed_fields.length > 0 && (
        <div className="info-rev__fields">
          {rev.changed_fields.map((f) => (
            <span className="badge badge-muted" key={f}>{FIELD_LABELS[f] ?? f}</span>
          ))}
        </div>
      )}
      {isInitial ? (
        <div className="info-rev__note">情報を登録。</div>
      ) : (
        <details className="info-rev__diff" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void loadDiff(); }}>
          <summary className="hint" style={{ cursor: "pointer" }}>差分を表示</summary>
          {loading && <p className="hint">読み込み中…</p>}
          {diff && Object.keys(diff.fields).length === 0 && <p className="hint">表示できる差分がありません。</p>}
          {diff && Object.entries(diff.fields).map(([field, fd]) => (
            <div className="diff-field" key={field}>
              <div className="diff-field__label">{FIELD_LABELS[field] ?? field}</div>
              {fd.kind === "text" ? (
                <div className="diff-text">
                  {(fd.segments ?? []).map((s, i) =>
                    s.op === "equal" ? (
                      <span key={i}>{s.text}</span>
                    ) : (
                      <span key={i} className={s.op === "add" ? "diff-add" : "diff-del"}>{s.text}</span>
                    ),
                  )}
                </div>
              ) : (
                <div className="diff-oldnew">
                  <span className="old">{fd.old || "（なし）"}</span> → <span className="new">{fd.new || "（なし）"}</span>
                </div>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
