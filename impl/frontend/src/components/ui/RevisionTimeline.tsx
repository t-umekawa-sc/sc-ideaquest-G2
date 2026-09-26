"use client";

// 変更履歴（内容の版）の共通タイムライン（横断標準・設計ドラフト doc/設計ドラフト/変更履歴標準.md §3.1）。
// アイデア（SC-22・概要パネルのリンクUI＝variant="idea"）と情報インプット（SC-50・折り畳みUI＝variant="info"）の
// 二重実装を1コンポーネントへ統合。差分ブロックは共通、頭部レイアウトのみ variant で出し分け（既存の見た目を維持）。
// 新エンティティ（コンセプト/振り返り/クエスト/評価）はこのコンポーネントに variant＋fieldLabels＋loadDiff を渡して再利用する。
import { useCallback, useState } from "react";

import { Avatar } from "./Avatar";

export type RevisionEditor = { display_name?: string | null; avatar_image_url?: string | null };

export type RevisionRow = {
  revision: number;
  created_at: string;
  changed_fields: string[];
  memo?: string | null;
  editor?: RevisionEditor | null; // variant="idea"（アバター＋氏名）
  editor_name?: string | null; // variant="info"（氏名のみ）
};

export type RevisionDiffSeg = { op: string; text: string };
export type RevisionDiffField = { kind: string; old?: string | null; new?: string | null; segments?: RevisionDiffSeg[] };
export type RevisionDiff = { fields: Record<string, RevisionDiffField> };

type Props = {
  revisions: RevisionRow[];
  currentRevision: number;
  fieldLabels: Record<string, string>;
  loadDiff: (revision: number) => Promise<RevisionDiff | null>;
  initialNote: string; // 初版の説明（例「アイデアを投稿。」「情報を登録。」）
  variant: "idea" | "info";
};

// ISO → YYYY/MM/DD HH:MM（版の記録日時・表示用）。
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RevisionTimeline({ revisions, currentRevision, fieldLabels, loadDiff, initialNote, variant }: Props) {
  const listCls = variant === "info" ? "info-rev-list" : "";
  return (
    <div className={listCls || undefined}>
      {revisions.map((rev) => (
        <RevisionItem
          key={rev.revision}
          rev={rev}
          isCurrent={rev.revision === currentRevision}
          fieldLabels={fieldLabels}
          loadDiff={loadDiff}
          initialNote={initialNote}
          variant={variant}
        />
      ))}
    </div>
  );
}

function RevisionItem({
  rev, isCurrent, fieldLabels, loadDiff, initialNote, variant,
}: { rev: RevisionRow; isCurrent: boolean; fieldLabels: Record<string, string>; loadDiff: (r: number) => Promise<RevisionDiff | null>; initialNote: string; variant: "idea" | "info" }) {
  const [diff, setDiff] = useState<RevisionDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const isInitial = rev.revision === 1;
  const p = variant === "info" ? "info-rev" : "rev"; // クラス接頭辞（既存の見た目を維持）
  const muted = variant === "info" ? "hint" : "admin-muted"; // 読み込み/差分なしの補助文言クラス

  // 差分は展開時に遅延取得（既定＝前版比較）。取得済みなら再取得しない。
  const load = useCallback(async () => {
    if (diff || loading || isInitial) return;
    setLoading(true);
    try {
      setDiff(await loadDiff(rev.revision));
    } catch {
      /* 展開時の失敗は非致命（空表示）。 */
    } finally {
      setLoading(false);
    }
  }, [diff, loading, isInitial, loadDiff, rev.revision]);

  return (
    <div className={`${p}${isCurrent ? " is-current" : ""}`}>
      <div className={`${p}__head`}>
        {variant === "info" && <span className="info-rev__ver">版 {rev.revision}</span>}
        {variant === "idea" && <span className="rev__time">{fmtDateTime(rev.created_at)}</span>}
        {isCurrent && <span className="badge badge-muted">現在</span>}
        {isInitial && <span className="badge badge-muted">初版</span>}
        {variant === "idea" ? (
          <span className="poster">
            <Avatar name={rev.editor?.display_name || "?"} imageUrl={rev.editor?.avatar_image_url ?? undefined} size="sm" />
            <span className="name">{rev.editor?.display_name || "?"}</span>
          </span>
        ) : (
          <>
            <span className="info-rev__who">{rev.editor_name ?? "—"}</span>
            <span className="info-rev__at">{fmtDateTime(rev.created_at)}</span>
          </>
        )}
      </div>
      {rev.changed_fields.length > 0 && (
        <div className={`${p}__fields`}>
          {rev.changed_fields.map((f) => (
            <span className="badge badge-muted" key={f}>{fieldLabels[f] ?? f}</span>
          ))}
        </div>
      )}
      {variant === "idea" && rev.memo && <div className="rev__note">📝 {rev.memo}</div>}
      {isInitial ? (
        <div className={`${p}__note`}>{initialNote}</div>
      ) : (
        <details className={`${p}__diff`} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void load(); }}>
          <summary className={variant === "info" ? "hint" : "role-note"} style={{ cursor: "pointer" }}>差分を表示</summary>
          {loading && <p className={muted}>読み込み中…</p>}
          {diff && Object.keys(diff.fields).length === 0 && <p className={variant === "info" ? "hint" : "role-note"}>表示できる差分がありません。</p>}
          {diff && Object.entries(diff.fields).map(([field, fd]) => (
            <div className="diff-field" key={field}>
              <div className="diff-field__label">{fieldLabels[field] ?? field}</div>
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
