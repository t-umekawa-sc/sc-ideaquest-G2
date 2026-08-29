"use client";

// SC-25 評価画面＝5観点×5点のスター採点＋観点別コメント＋総評（必須）＋集計プレビュー＋公開範囲（F.2 実接続）。
// 正＝doc/画面設計/mocks/SC-25_評価画面.html・doc/画面設計/screens/SC-25_評価画面.md・API設計 F.2。
// 実接続: マウントで getMyEvaluation（プリフィル）＋getIdea（対象アイデアの文脈）。確定/下書きは PUT /ideas/{id}/evaluation。
// 権限/検証/状態機械はサーバー権威（403/409/422）。SC-22 からのソフト遷移は URL 付きモーダル（Intercept・
// EvaluationModal が onClose 付きで本 View を使う）／URL 直・リロードは本フルページ（onClose 無し＝chrome を出す）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Spinner, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { reduceMotion } from "@/lib/motion";
import { getIdea, type IdeaDetail } from "@/features/ideas/api";

import { getMyEvaluation, putEvaluation, type EvaluationVisibility } from "../api";
import "../evaluations.css";

type AspectKey = "novelty" | "impact" | "feasibility" | "fit" | "cost";
type Aspect = { key: AspectKey; label: string; desc: string; cost?: boolean };
const ASPECTS: Aspect[] = [
  { key: "novelty", label: "新規性", desc: "アイデアの目新しさ・独自性" },
  { key: "impact", label: "影響度", desc: "実現した場合のインパクトの大きさ" },
  { key: "feasibility", label: "実現度", desc: "実現可能性の高さ" },
  { key: "fit", label: "適合性", desc: "クエストのテーマ・目的への合致度" },
  { key: "cost", label: "コスト", desc: "💡 低コストほど高得点（★5＝非常に低コスト）", cost: true },
];

// onClose あり＝モーダル（Intercept・SC-22 から）＝chrome（container/backlink）は RouteModal が担うので出さず、
// 確定成功で close()。無し＝フルページ（URL 直/リロード）＝従来どおり container＋backlink＋router.push。
export function EvaluationView({ ideaId, onClose }: { ideaId: string; onClose?: () => void }) {
  const router = useRouter();
  const inModal = onClose != null;
  const Frame = ({ children }: { children: ReactNode }) =>
    inModal ? (
      <>{children}</>
    ) : (
      <main className="container" style={{ paddingBlock: "var(--space-6) var(--space-16)", maxWidth: 760 }}>
        <Link className="backlink" href={`/ideas/${ideaId}`}>← アイデア詳細へ戻る</Link>
        {children}
      </main>
    );
  const snack = useSnackbar();
  const [scores, setScores] = useState<Partial<Record<AspectKey, number>>>({});
  const [hover, setHover] = useState<Partial<Record<AspectKey, number>>>({});
  // #22: 採点確定時に星が「フィルスイープ」でポップ（純視覚・reduce-motion 時は出さない）。
  const [popAspect, setPopAspect] = useState<string | null>(null);
  const firePop = (key: string) => {
    if (reduceMotion()) return;
    setPopAspect(key);
    setTimeout(() => setPopAspect((p) => (p === key ? null : p)), 450);
  };
  const [comments, setComments] = useState<Partial<Record<AspectKey, string>>>({});
  const [overall, setOverall] = useState("");
  const [visibility, setVisibility] = useState<EvaluationVisibility>("party");
  const [missingErr, setMissingErr] = useState(0);
  const [overallErr, setOverallErr] = useState(false);
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "draft" | "submit">(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // 自分の評価（プリフィル）＋対象アイデアの文脈を並行取得。評価権限が無ければ me が 403。
    Promise.all([getMyEvaluation(ideaId), getIdea(ideaId).catch(() => null)])
      .then(([me, d]) => {
        if (!alive) return;
        if (me && me.status) {
          setScores((me.scores ?? {}) as Partial<Record<AspectKey, number>>);
          setComments((me.comments ?? {}) as Partial<Record<AspectKey, string>>);
          setOverall(me.overall_comment ?? "");
          setVisibility(me.visibility ?? "party");
        }
        setIdea(d);
        setLoadError(null);
      })
      .catch((err) => {
        if (!alive) return;
        const status = err instanceof ApiError ? err.status : 0;
        setLoadError(
          status === 403 ? "この画面は評価者権限を持つメンバーのみ利用できます。"
          : status === 404 ? "このアイデアは見つからないか、評価できません。"
          : "評価の読み込みに失敗しました。",
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ideaId]);

  const ratedVals = ASPECTS.map((a) => scores[a.key]).filter((v): v is number => !!v);
  const rated = ratedVals.length;
  const avg = rated ? ratedVals.reduce((s, v) => s + v, 0) / rated : 0;

  const persist = useCallback(
    async (status: "draft" | "submitted") => {
      if (pending) return;
      if (status === "submitted") {
        // クライアント前段検証（サーバーも 422 で権威）＝全5観点＋総評。
        const missing = ASPECTS.filter((a) => !scores[a.key]).length;
        const noOverall = !overall.trim();
        setMissingErr(missing);
        setOverallErr(noOverall);
        if (missing || noOverall) return;
      }
      setPending(status === "submitted" ? "submit" : "draft");
      try {
        const res = await putEvaluation(ideaId, {
          scores: scores as Record<string, number>,
          comments: Object.fromEntries(Object.entries(comments).filter(([, v]) => v && v.trim())) as Record<string, string>,
          overall_comment: overall.trim() || null,
          visibility,
          status,
        });
        if (status === "submitted") {
          // #8: 実際に付与された評価 XP（server の xp_delta）を表示。再確定（冪等・0）は XP を出さない
          //（従来は再確定でも「＋30 XP」と誤表示していた＝金額の正はサーバー）。
          const xp = res?.xp_delta ?? 0;
          const msgBody = `平均 ${avg.toFixed(1)} / 5.0・公開: ${visibility === "party" ? "パーティー全員" : "限定"}`;
          if (xp > 0) {
            snack({ type: "reward", title: "評価を確定しました", msg: msgBody, rewards: [{ k: "xp", t: `＋${xp} XP` }] });
          } else {
            snack({ type: "success", title: "評価を更新しました", msg: msgBody });
          }
          if (onClose) onClose(); else router.push(`/ideas/${ideaId}`);  // モーダルは close・フルページは詳細へ
        } else {
          snack({ type: "info", title: "下書きを保存しました", msg: `採点 ${rated}/5 観点・あなただけに表示されます。` });
        }
      } catch (err) {
        const st = err instanceof ApiError ? err.status : 0;
        if (st === 422) {
          setMissingErr(ASPECTS.filter((a) => !scores[a.key]).length);
          setOverallErr(!overall.trim());
          snack({ type: "error", msg: "確定には全5観点の採点と総評が必要です。" });
        } else {
          snack({
            type: "error",
            msg:
              st === 403 ? "評価する権限がありません。"
              : st === 409 ? "完了したクエストのアイデアは評価できません。"
              : st === 404 ? "このアイデアは見つからないか、評価できません。"
              : "保存に失敗しました。時間をおいて再度お試しください。",
          });
        }
      } finally {
        setPending(null);
      }
    },
    [ideaId, scores, comments, overall, visibility, avg, rated, pending, snack, router, onClose],
  );

  if (loading) {
    // モーダル時はパネル（padding:0）直下に置かれるため標準ガターを付ける（フルページは container 側で確保）。
    return <Frame><div style={inModal ? { padding: "var(--space-5) var(--space-6)" } : undefined}><Spinner label="読み込み中…" /></div></Frame>;
  }
  if (loadError) {
    // モーダル時は .modal__body の外＝パネル直下のため、左右に隙間（標準ガター）を確保する。
    return <Frame><div className="form-error" role="alert" style={inModal ? { margin: "var(--space-5) var(--space-6)" } : { marginTop: "var(--space-4)" }}>{loadError}</div></Frame>;
  }

  return (
    <Frame>
      <section className="card">
        {!inModal && <h1 style={{ fontSize: "var(--text-xl)", margin: "0 0 var(--space-2)" }}>アイデアを評価</h1>}
        <p className="role-note" style={{ marginTop: 0 }}>
          ▲ この画面は<strong>評価者権限</strong>を持つ人のみ表示。1アイデアに複数の評価者が評価できます。
        </p>

        {/* 対象アイデアの文脈（実データ・getIdea） */}
        <div className="eval-context card" style={{ padding: "var(--space-3) var(--space-4)" }}>
          <div className="eval-context__quest">
            {idea?.quest?.title || "クエスト"}{idea?.quest?.categories?.[0] ? ` ・ ${idea.quest.categories[0]}` : ""}
          </div>
          <div className="eval-context__title">{idea?.title || "アイデア"}</div>
          <div className="eval-context__link">
            <Link href={`/ideas/${ideaId}`}>アイデア詳細を見る →</Link>
          </div>
        </div>

        {/* 折りたたみ: アイデアを確認（実データ） */}
        <details className="eval-idea" open>
          <summary>アイデアを確認</summary>
          <div className="eval-idea__body">
            <div className="eval-idea__label">価値</div>
            <p style={{ whiteSpace: "pre-wrap" }}>{idea?.value || "—"}</p>
            <div className="eval-idea__label">アイデア本文</div>
            <p style={{ whiteSpace: "pre-wrap" }}>{idea?.body || "—"}</p>
            {idea?.attachments && idea.attachments.length > 0 && (
              <>
                <div className="eval-idea__label">関連資料</div>
                <p>
                  {idea.attachments.map((f) => (
                    <span className="badge badge-muted" key={f.id}>📎 {f.original_name}</span>
                  ))}
                </p>
              </>
            )}
          </div>
        </details>

        {/* 5観点の採点 */}
        <div>
          {ASPECTS.map((a) => {
            const filled = hover[a.key] ?? scores[a.key] ?? 0;
            const val = scores[a.key];
            return (
              <div className="eval-row" key={a.key}>
                <div className="eval-row__head">
                  <div>
                    <span className="eval-aspect">{a.label}</span>
                    <div className={"eval-desc" + (a.cost ? " eval-cost-note" : "")}>{a.desc}</div>
                  </div>
                  <div className="eval-rate">
                    <span
                      className="stars"
                      role="radiogroup"
                      aria-label={`${a.label}の点数`}
                      data-pop={popAspect === a.key ? "true" : undefined}
                      onMouseLeave={() => setHover((h) => ({ ...h, [a.key]: undefined }))}
                      onKeyDown={(e) => {
                        // 矢印キーで採点移動＝radiogroup 標準（Home/End で 1/5）。選択後は当該★へフォーカス。
                        const cur = val ?? 0;
                        let next: number | null = null;
                        if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, (cur || 1) - 1);
                        else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, cur + 1);
                        else if (e.key === "Home") next = 1;
                        else if (e.key === "End") next = 5;
                        if (next != null) {
                          const nv = next;
                          const grp = e.currentTarget;  // イベント後は currentTarget が null になるため退避
                          e.preventDefault();
                          setScores((s) => ({ ...s, [a.key]: nv }));
                          if (missingErr) setMissingErr(0);
                          firePop(a.key);
                          // 再描画（roving tabindex 更新）＋モーダルの focus trap 後に選択★へフォーカス移動。
                          requestAnimationFrame(() => (grp.querySelector(`[data-star="${nv}"]`) as HTMLElement | null)?.focus());
                        }
                      }}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          data-star={n}
                          className={"star" + (n <= filled ? " is-on" : "")}
                          type="button"
                          role="radio"
                          aria-label={`${n}点`}
                          aria-checked={val === n}
                          tabIndex={val === n || (val == null && n === 1) ? 0 : -1}
                          onMouseEnter={() => setHover((h) => ({ ...h, [a.key]: n }))}
                          onClick={() => {
                            setScores((s) => ({ ...s, [a.key]: n }));
                            if (missingErr) setMissingErr(0);
                            firePop(a.key);
                          }}
                        >
                          ★
                        </button>
                      ))}
                    </span>
                    <span className="eval-score-num">
                      {val ? val : "–"}
                      <span className="muted"> /5</span>
                    </span>
                  </div>
                </div>
                <textarea
                  className="textarea eval-comment"
                  placeholder="観点別コメント（任意）"
                  value={comments[a.key] ?? ""}
                  onChange={(e) => setComments((c) => ({ ...c, [a.key]: e.target.value }))}
                />
              </div>
            );
          })}
        </div>

        {/* 総評（必須） */}
        <div className="field" style={{ marginTop: "var(--space-4)" }}>
          <label htmlFor="evalOverall">
            総評（全体コメント）<span className="req">*</span>
          </label>
          <textarea
            className="textarea"
            id="evalOverall"
            style={{ minHeight: 96 }}
            placeholder="このアイデア全体への評価・総括コメント（強み/懸念/次の一手 など）"
            value={overall}
            onChange={(e) => {
              setOverall(e.target.value);
              if (e.target.value.trim()) setOverallErr(false);
            }}
          />
          {overallErr ? (
            <p className="field__error" role="alert">
              総評（全体コメント）は必須です
            </p>
          ) : (
            <div className="hint">観点別コメントとは別に、アイデア全体への総評を必須入力。アイデア詳細の評価結果に表示されます。</div>
          )}
        </div>

        {/* 集計プレビュー */}
        <div className="eval-summary">
          <div>
            <span className="eval-summary__avg">{rated ? avg.toFixed(1) : "–"}</span>{" "}
            <span className="muted">
              / 5.0（{rated}/5 観点）
            </span>
          </div>
          <div className="eval-summary__note">
            5観点は<strong>均等平均</strong>。投稿者へのコインは<strong>全評価者の平均</strong>から <code>round(平均×10)</code>（最大50）で付与されます（本評価の平均は上記）。
          </div>
        </div>
        {missingErr > 0 && (
          <p className="field__error" role="alert">
            すべての観点（5つ）を採点してください（未採点 {missingErr} 件）
          </p>
        )}

        {/* 公開範囲 */}
        <div className="field">
          <label>評価結果の公開範囲</label>
          <div className="visibility">
            <label className={"vis-opt" + (visibility === "party" ? " is-sel" : "")}>
              <input type="radio" name="vis" value="party" checked={visibility === "party"} onChange={() => setVisibility("party")} />
              <span>
                <span className="vis-opt__title">🔓 パーティー全員に公開（既定）</span>
                <span className="vis-opt__desc">当該クエストの参加メンバー全員が、スコア・観点別コメントを閲覧できます。フィードバックを全員で共有。</span>
              </span>
            </label>
            <label className={"vis-opt" + (visibility === "limited" ? " is-sel" : "")}>
              <input type="radio" name="vis" value="limited" checked={visibility === "limited"} onChange={() => setVisibility("limited")} />
              <span>
                <span className="vis-opt__title">🔒 限定公開</span>
                <span className="vis-opt__desc">投稿者＋評価者＋所有者/クエスト管理権限者のみ閲覧可。範囲外メンバーには集計にも含めず完全非表示。</span>
              </span>
            </label>
          </div>
        </div>

        <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
          <strong>下書き保存</strong>は一時保存です（本人のみ表示・全観点がそろっていなくても保存できます）。<strong>確定</strong>すると他の評価者・パーティーに反映され、評価で XP、投稿者にコインが付与されます。
        </p>

        <div className="modal__foot" style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
          {inModal ? (
            <button className="btn btn-outline" type="button" onClick={onClose}>キャンセル</button>
          ) : (
            <Link className="btn btn-outline" href={`/ideas/${ideaId}`}>キャンセル</Link>
          )}
          <button className="btn btn-outline" type="button" onClick={() => void persist("draft")} disabled={pending !== null}>
            {pending === "draft" ? "保存中…" : "下書き保存"}
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void persist("submitted")} disabled={pending !== null}>
            {pending === "submit" ? "確定中…" : "評価を確定"}
          </button>
        </div>
      </section>
    </Frame>
  );
}
