"use client";

// SC-04 AIジョブ詳細（読み取り専用）。GET /ai-jobs/{id}（S.1）。ダイアログ内コンテンツ標準（§4.5 line108・
// .dialog-label/.dialog-grid・囲まない）。結果/エラー/進捗・待ち・利用量・時刻・対象への導線を表示する。
import Link from "next/link";
import { useEffect, useState } from "react";

import { getAiJob } from "../api";
import { STATUS_BADGE, STATUS_LABEL, TASK_LABEL } from "../types";
import type { AiJobDetail } from "../types";

function targetHref(r: AiJobDetail): string | null {
  if (r.ref_idea_id) return `/ideas/${r.ref_idea_id}`;
  if (r.ref_strategy_document_id) return `/strategy-documents/${r.ref_strategy_document_id}/edit`;
  if (r.ref_info_item_id) return `/info-items/${r.ref_info_item_id}`;
  if (r.ref_quest_id) return `/quests/${r.ref_quest_id}`;
  return null;
}

const ts = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "—");

// 実行方式（ai_jobs.execution・§5.2）＝queued=バッチ（バックグラウンド worker）／immediate=API（同期）。
// どちらも状態機械は共通で ai_jobs に載る（§5.1）＝一覧(SC-04)に出る。Phase1 は queued のみ。
const execLabel = (e: string): string =>
  e === "queued" ? "バッチ（バックグラウンド）" : e === "immediate" ? "API（同期）" : e || "—";

export function AiJobDetailPanel({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [job, setJob] = useState<AiJobDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    getAiJob(jobId, ac.signal).then((j) => setJob(j)).catch(() => {}).finally(() => setLoading(false));
    return () => ac.abort();
  }, [jobId]);

  if (loading) return <div className="modal__body"><p className="hint">読み込み中…</p></div>;
  if (!job) return <div className="modal__body"><p className="hint">ジョブが見つかりませんでした。</p></div>;

  const href = targetHref(job);
  // 標準構造＝本文は .modal__body（共有 Modal の padding・情報詳細 SC-52 と同じ）／フッターは兄弟の .modal__footer。
  return (
    <>
      <div className="modal__body ai-job-detail">
        <div className="dialog-subject">
          <span className="card-title">{TASK_LABEL[job.task_type] ?? job.task_type}</span>
          <span className={`badge ${STATUS_BADGE[job.status]}`}>{STATUS_LABEL[job.status]}</span>
        </div>

        {job.status === "succeeded" && job.result?.text && (
          <div className="dialog-section">
            <div className="dialog-label">結果</div>
            <p className="ai-job-detail__result">{job.result.text}</p>
          </div>
        )}
        {job.status === "failed" && job.error && (
          <div className="dialog-section">
            <div className="dialog-label">エラー</div>
            <p className="ai-job-detail__error">{job.error.detail || job.error.code || "不明なエラー"}</p>
          </div>
        )}

        <div className="dialog-section">
          <div className="dialog-label">実行情報</div>
          <dl className="dialog-grid">
            <dt>実行方式</dt><dd>{execLabel(job.execution)}</dd>
            <dt>モデル（指定）</dt><dd>{job.requested_model ?? "（既定）"}</dd>
            <dt>モデル（実行）</dt><dd>{job.model ? `${job.model}${job.provider ? `（${job.provider}）` : ""}` : "—"}</dd>
            <dt>利用トークン</dt><dd>{job.input_tokens != null || job.output_tokens != null ? `入力 ${job.input_tokens ?? 0} / 出力 ${job.output_tokens ?? 0}` : "—"}</dd>
            <dt>依頼時刻</dt><dd>{ts(job.created_at)}</dd>
            <dt>開始時刻</dt><dd>{ts(job.started_at)}</dd>
            <dt>完了時刻</dt><dd>{ts(job.finished_at)}</dd>
          </dl>
        </div>
      </div>

      <div className="modal__footer">
        {/* フッター順＝閉じる（左・.dialog-close-left）→主要（右）＝デザイン標準§ダイアログ内コンテンツ。 */}
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>閉じる</button>
        {job.status === "succeeded" && href && (
          <Link className="btn btn-primary" href={href}>内容を参照する →</Link>
        )}
      </div>
    </>
  );
}
