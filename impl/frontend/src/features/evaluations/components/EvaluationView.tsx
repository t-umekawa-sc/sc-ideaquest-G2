"use client";

// SC-25 評価画面＝5観点×5点のスター採点＋観点別コメント＋総評（必須）＋集計プレビュー＋公開範囲。
// 正＝doc/画面設計/mocks/SC-25_評価画面.html・doc/画面設計/screens/SC-25_評価画面.md。
// 評価 backend 未実装＝デモ fixtures（画面モック先行）。設計上はSC-22からのモーダル（Intercept）／URL直・リロードは本フルページ。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import "../evaluations.css";

type AspectKey = "novelty" | "impact" | "feasibility" | "fit" | "cost";
type Aspect = { key: AspectKey; label: string; desc: string; seed: number; cost?: boolean };
const ASPECTS: Aspect[] = [
  { key: "novelty", label: "新規性", desc: "アイデアの目新しさ・独自性", seed: 4 },
  { key: "impact", label: "影響度", desc: "実現した場合のインパクトの大きさ", seed: 4 },
  { key: "feasibility", label: "実現度", desc: "実現可能性の高さ", seed: 3 },
  { key: "fit", label: "適合性", desc: "クエストのテーマ・目的への合致度", seed: 4 },
  { key: "cost", label: "コスト", desc: "💡 低コストほど高得点（★5＝非常に低コスト）", seed: 5, cost: true },
];

export function EvaluationView({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  // 既存評価の編集を想定したシード
  const [scores, setScores] = useState<Record<AspectKey, number>>({ novelty: 4, impact: 4, feasibility: 3, fit: 4, cost: 5 });
  const [hover, setHover] = useState<Partial<Record<AspectKey, number>>>({});
  const [comments, setComments] = useState<Partial<Record<AspectKey, string>>>({});
  const [overall, setOverall] = useState("");
  const [visibility, setVisibility] = useState<"party" | "limited">("party");
  const [missingErr, setMissingErr] = useState(0);
  const [overallErr, setOverallErr] = useState(false);

  const ratedVals = ASPECTS.map((a) => scores[a.key]).filter(Boolean);
  const rated = ratedVals.length;
  const avg = rated ? ratedVals.reduce((s, v) => s + v, 0) / rated : 0;

  function submit() {
    const missing = ASPECTS.filter((a) => !scores[a.key]).length;
    const noOverall = !overall.trim();
    setMissingErr(missing);
    setOverallErr(noOverall);
    if (missing || noOverall) return;
    // 評価 backend 未実装＝デモ（送信せず）。接続時に PUT /ideas/{id}/evaluations/me へ差し替え。
    window.alert(`評価を確定しました（デモ）\n平均: ${avg.toFixed(1)} / 5.0\n公開範囲: ${visibility === "party" ? "パーティー全員" : "限定"}`);
    router.push(`/ideas/${ideaId}`);
  }
  function saveDraft() {
    window.alert(`下書きを保存しました（デモ）\n採点: ${rated}/5 観点\n※ あなただけに表示。確定するまで XP・コインは付与されません。`);
  }

  return (
    <main className="container" style={{ paddingBlock: "var(--space-6) var(--space-16)", maxWidth: 760 }}>
      <Link className="backlink" href={`/ideas/${ideaId}`}>
        ← アイデア詳細へ戻る
      </Link>

      <section className="card">
        <h1 style={{ fontSize: "var(--text-xl)", margin: "0 0 var(--space-2)" }}>アイデアを評価</h1>
        <p className="role-note" style={{ marginTop: 0 }}>
          ▲ この画面は<strong>評価者権限</strong>を持つ人のみ表示。1アイデアに複数の評価者が評価できます。
        </p>

        {/* 対象アイデアの文脈 */}
        <div className="eval-context card" style={{ padding: "var(--space-3) var(--space-4)" }}>
          <div className="eval-context__quest">配送ルート最適化 ・ 業務改善</div>
          <div className="eval-context__title">夜間配送の集約による積載率改善</div>
          <div className="eval-context__link">
            <Link href={`/ideas/${ideaId}`}>アイデア詳細を見る →</Link>
          </div>
        </div>

        {/* 折りたたみ: アイデアを確認 */}
        <details className="eval-idea" open>
          <summary>アイデアを確認</summary>
          <div className="eval-idea__body">
            <div className="eval-idea__label">価値</div>
            <p>配送コストを約15%削減しつつ、CO2排出も同時に削減できる。ドライバーの日中拘束を減らし労務環境も改善。</p>
            <div className="eval-idea__label">アイデア本文</div>
            <p>複数拠点で個別に走らせている夜間配送を1本のルートに集約し、積載率を高める。AIで需要予測しながら翌日ルートを自動生成、繁忙期は臨時便を差し込む。まずは首都圏3拠点でパイロット運用し、効果を検証してから全国展開する。</p>
            <div className="eval-idea__label">関連資料</div>
            <p>
              <span className="badge badge-muted">📄 夜間配送_試算シート.xlsx</span>{" "}
              <span className="badge badge-muted">🖼️ ルート集約イメージ.png</span>
            </p>
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
                    <span className="stars" role="radiogroup" aria-label={`${a.label}の点数`} onMouseLeave={() => setHover((h) => ({ ...h, [a.key]: undefined }))}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          className={"star" + (n <= filled ? " is-on" : "")}
                          type="button"
                          aria-label={`${n}点`}
                          aria-pressed={val === n}
                          onMouseEnter={() => setHover((h) => ({ ...h, [a.key]: n }))}
                          onClick={() => {
                            setScores((s) => ({ ...s, [a.key]: n }));
                            if (missingErr) setMissingErr(0);
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
                <span className="vis-opt__desc">投稿者＋評価者＋所有者/クエスト管理権限者のみ閲覧可。範囲外メンバーへの見せ方（集計のみ/非表示）は今後確定（TBD）。</span>
              </span>
            </label>
          </div>
        </div>

        <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
          <strong>下書き保存</strong>は一時保存です（本人のみ表示・全観点がそろっていなくても保存できます）。<strong>確定</strong>すると他の評価者・パーティーに反映され、評価で XP、投稿者にコインが付与されます。
        </p>

        <div className="modal__foot" style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
          <Link className="btn btn-outline" href={`/ideas/${ideaId}`}>
            キャンセル
          </Link>
          <button className="btn btn-outline" type="button" onClick={saveDraft}>
            下書き保存
          </button>
          <button className="btn btn-primary" type="button" onClick={submit}>
            評価を確定
          </button>
        </div>
      </section>
    </main>
  );
}
