"use client";

// SC-22/SC-61 評価パネルのコメント表示（F.1.1/F.1.2・FR-50）。評価者が増えても縦伸びしないよう、観点別コメントと
// 総評は「観点ごと代表1件」に絞り、代表の選び方をタブ（高評価/合意〔既定〕/懸念）で切替＋「他N件→評価詳細(#13)」。
// 代表選定はクライアント側（候補数が小さくタブ切替を無通信で即応・母集団は可視評価＝サーバーが絞込済）。
// AI 評価は別枠（本コンポーネント外の AI ブロック）だが、#13 評価詳細には1枚のカードとして含める。
import { useState } from "react";

import { Avatar, Modal, ModalBody } from "@/components/ui";

import type { AiEvaluation, EvaluationEvaluator } from "../api";

type Tab = "high" | "avg" | "low";
const TABS: { key: Tab; label: string }[] = [
  { key: "high", label: "高評価" },
  { key: "avg", label: "合意" },
  { key: "low", label: "懸念" },
];
const TAB_DESC: Record<Tab, string> = { high: "最も高く評価した", avg: "平均に最も近い", low: "最も低く評価した" };

type Scored = { score: number; submitted_at?: string | null };

function earliest(a: Scored, b: Scored): number {
  const ta = a.submitted_at ?? "";
  const tb = b.submitted_at ?? "";
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

// 代表1件を選ぶ（その観点/総評にコメントした評価者の中から）。high=最高・low=最低・avg=平均に最も近い。同点は先の確定。
function pickRep<T extends Scored>(items: T[], tab: Tab): T | null {
  if (!items.length) return null;
  if (tab === "high") return [...items].sort((a, b) => b.score - a.score || earliest(a, b))[0];
  if (tab === "low") return [...items].sort((a, b) => a.score - b.score || earliest(a, b))[0];
  const mean = items.reduce((s, x) => s + x.score, 0) / items.length;
  return [...items].sort((a, b) => Math.abs(a.score - mean) - Math.abs(b.score - mean) || earliest(a, b))[0];
}

type EvalLike = EvaluationEvaluator & Scored;

export function EvaluationComments({ evaluators, aspectLabels, aiEvaluation, title }: {
  evaluators: EvaluationEvaluator[];
  aspectLabels: [string, string][];
  aiEvaluation?: AiEvaluation | null;
  title: string;
}) {
  const [tab, setTab] = useState<Tab>("avg");
  const [detail, setDetail] = useState(false);

  // 総評候補＝overall_comment あり・score＝評価者の観点平均（全体平均でタブ基準に選ぶ）。
  const overallCands: EvalLike[] = evaluators
    .filter((e) => e.overall_comment)
    .map((e) => {
      const vals = Object.values(e.scores ?? {});
      return { ...e, score: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0 };
    });
  const repOverall = pickRep(overallCands, tab);
  const hasAspectCmt = evaluators.some((e) => Object.keys(e.comments ?? {}).length > 0);
  if (!repOverall && !hasAspectCmt) return null;

  return (
    <>
      <hr className="eval-sep" />
      <h2 className="card-title" style={{ margin: "var(--space-4) 0 var(--space-1)" }}>コメント</h2>
      <div className="eval-cmt-tabs" role="tablist" aria-label="代表コメントの選び方">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={"eval-cmt-tab" + (tab === t.key ? " is-active" : "")} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="ai-meta" style={{ marginTop: 0 }}>
        観点・総評ごとに<strong>{TAB_DESC[tab]}</strong>評価者のコメントを1件表示（「他N件」で全件＝評価詳細）。
      </p>

      {repOverall && (
        <>
          <div className="eval-section-label">総評</div>
          <div className="eval-overall">
            <div className="eval-overall__item">
              <div className="eval-comment__head">
                <Avatar name={repOverall.evaluator.display_name || "?"} imageUrl={repOverall.evaluator.avatar_image_url ?? undefined} size="sm" />
                <span className="chat-msg__name">{repOverall.evaluator.display_name || "?"}</span>
                {overallCands.length > 1 && (
                  <button type="button" className="eval-comment__more" onClick={() => setDetail(true)}>他{overallCands.length - 1}件 →</button>
                )}
              </div>
              <p className="eval-comment__text">{repOverall.overall_comment}</p>
            </div>
          </div>
        </>
      )}

      {hasAspectCmt && (
        <>
          <div className="eval-section-label">観点別コメント</div>
          <div className="eval-comments">
            {aspectLabels.map(([k, label]) => {
              const cands: EvalLike[] = evaluators.filter((e) => e.comments?.[k]).map((e) => ({ ...e, score: e.scores?.[k] ?? 0 }));
              const rep = pickRep(cands, tab);
              if (!rep) return null;
              return (
                <div className="eval-comment" key={k}>
                  <div className="eval-comment__head">
                    <span className="badge badge-muted eval-comment__aspect--lead">{label}</span>
                    <Avatar name={rep.evaluator.display_name || "?"} imageUrl={rep.evaluator.avatar_image_url ?? undefined} size="sm" />
                    <span className="chat-msg__name">{rep.evaluator.display_name || "?"}</span>
                    {cands.length > 1 && (
                      <button type="button" className="eval-comment__more" onClick={() => setDetail(true)}>他{cands.length - 1}件 →</button>
                    )}
                  </div>
                  <p className="eval-comment__text eval-comment__text--indent">{rep.comments?.[k]}</p>
                </div>
              );
            })}
          </div>
        </>
      )}

      {detail && (
        <Modal open onClose={() => setDetail(false)} title="評価詳細" size="lg">
          <ModalBody>
            <p className="ai-meta">公開範囲（パーティ全員／限定／非公開）に応じて、あなたに公開されている評価のみ表示します。</p>
            {evaluators.map((e) => (
              <ScoreCard key={e.evaluator.user_id}
                name={e.evaluator.display_name || "?"} avatar={e.evaluator.avatar_image_url ?? undefined}
                scores={e.scores} comments={e.comments} overall={e.overall_comment} aspectLabels={aspectLabels} />
            ))}
            {aiEvaluation && (
              <ScoreCard ai name="AI評価" meta={aiEvaluation.model ?? undefined}
                scores={aiEvaluation.scores} comments={aiEvaluation.comments} overall={aiEvaluation.overall_comment} aspectLabels={aspectLabels} />
            )}
          </ModalBody>
        </Modal>
      )}
    </>
  );
}

// 評価者ごとの個別スコアカード（#13）。全観点を出し、未入力は「コメントなし」で行高を揃える。
function ScoreCard({ name, avatar, scores, comments, overall, aspectLabels, ai, meta }: {
  name: string;
  avatar?: string;
  scores?: Record<string, number> | null;
  comments?: Record<string, string> | null;
  overall?: string | null;
  aspectLabels: [string, string][];
  ai?: boolean;
  meta?: string;
}) {
  return (
    <div className={"sc-card" + (ai ? " ai-eval" : "")}>
      <div className="sc-card__head">
        {ai ? <span className="ai-badge">🤖 {name}</span> : <Avatar name={name} imageUrl={avatar} size="sm" />}
        {!ai && <span className="chat-msg__name">{name}</span>}
        {meta && <span className="sc-card__meta">{meta}</span>}
      </div>
      {aspectLabels.map(([k, label]) => {
        const v = scores?.[k];
        return (
          <div key={k}>
            <div className="score-row">
              <span className="score-row__label">{label}</span>
              <span className="score-bar"><i style={{ width: `${v ? (v / 5) * 100 : 0}%` }} /></span>
              <span className="score-row__val">{v ? v.toFixed(1) : "–"}</span>
            </div>
            {comments?.[k]
              ? <p className="eval-comment__text eval-comment__text--indent">{comments[k]}</p>
              : <p className="eval-comment__text eval-comment__text--indent eval-cmt-empty">コメントなし</p>}
          </div>
        );
      })}
      {overall && (
        <>
          <div className="eval-section-label">総評</div>
          <div className="eval-overall__item"><p className="eval-comment__text">{overall}</p></div>
        </>
      )}
    </div>
  );
}
