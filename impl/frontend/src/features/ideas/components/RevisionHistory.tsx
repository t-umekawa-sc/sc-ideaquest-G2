"use client";

// SC-22 更新履歴モーダルの中身（D.4 版タイムライン＋差分・実接続）。正＝doc/画面設計/mocks/SC-22_アイデア詳細.html。
// getRevisions で版一覧（新しい順）を取得し、各版の差分は展開時に getRevisionDiff で遅延取得（サーバーが2版を比較して算出）。
// 初版（revision=1）は差分なし＝「アイデアを投稿。」。current は「現在」バッジ。
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/ui";

import { getRevisionDiff, getRevisions, type IdeaRevision, type IdeaRevisionDiff } from "../api";

// 版で追跡するフィールドの表示名（D.4・§5.14）。
const FIELD_LABELS: Record<string, string> = {
  title: "件名",
  value: "価値",
  body: "アイデア本文",
  note: "備考 / 特記事項",
  time_limit: "タイムリミット",
  stakeholders: "利害関係者",
};

// ISO → YYYY/MM/DD HH:MM（版の記録日時・表示用）。
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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
    <div>
      {revs.map((rev) => (
        <RevisionItem key={rev.revision} ideaId={ideaId} rev={rev} isCurrent={rev.revision === currentRevision} />
      ))}
    </div>
  );
}

function RevisionItem({ ideaId, rev, isCurrent }: { ideaId: string; rev: IdeaRevision; isCurrent: boolean }) {
  const [diff, setDiff] = useState<IdeaRevisionDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const isInitial = rev.revision === 1;

  // 差分は展開時に遅延取得（既定＝前版比較）。取得済みなら再取得しない。
  const loadDiff = useCallback(async () => {
    if (diff || loading || isInitial) return;
    setLoading(true);
    try {
      setDiff(await getRevisionDiff(ideaId, rev.revision));
    } catch {
      /* 展開時の失敗は非致命（空表示）。 */
    } finally {
      setLoading(false);
    }
  }, [ideaId, rev.revision, diff, loading, isInitial]);

  return (
    <div className={`rev${isCurrent ? " is-current" : ""}`}>
      <div className="rev__head">
        <span className="rev__time">{fmtDateTime(rev.created_at)}</span>
        {isCurrent && <span className="badge badge-muted">現在</span>}
        {isInitial && <span className="badge badge-muted">初版</span>}
        <span className="poster">
          <Avatar name={rev.editor.display_name || "?"} size="sm" />
          <span className="name">{rev.editor.display_name || "?"}</span>
        </span>
      </div>
      {rev.changed_fields.length > 0 && (
        <div className="rev__fields">
          {rev.changed_fields.map((f) => (
            <span className="badge badge-muted" key={f}>{FIELD_LABELS[f] ?? f}</span>
          ))}
        </div>
      )}
      {rev.memo && <div className="rev__note">📝 {rev.memo}</div>}
      {isInitial ? (
        <div className="rev__note">アイデアを投稿。</div>
      ) : (
        <details
          className="rev__diff"
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) void loadDiff();
          }}
        >
          <summary className="role-note" style={{ cursor: "pointer" }}>差分を表示</summary>
          {loading && <p className="admin-muted">読み込み中…</p>}
          {diff && Object.keys(diff.fields).length === 0 && (
            <p className="role-note">表示できる差分がありません。</p>
          )}
          {diff &&
            Object.entries(diff.fields).map(([field, fd]) => (
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
