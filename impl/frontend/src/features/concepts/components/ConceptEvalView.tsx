"use client";

// SC-62 コンセプト評価フォーム（FR-42・P.5）。中核5＋補助3観点の採点＋総評＋Go/Pivot/Kill 推奨＋公開範囲。
// submitted は中核5(1..5)＋総評＋推奨をサーバー検証（クライアントでも事前検証）。各観点に ⓘ ガイダンス（§4.13）。
// 正＝doc/画面設計/screens/SC-62_コンセプト評価.md。
import { useCallback, useEffect, useState } from "react";

import { Button, Field, FormSummary, ModalBody, ModalFooter, ScreenPurpose, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { CONCEPTS_CHANGED_EVENT, getMyEvaluation, putEvaluation } from "../api";
import "@/features/evaluations/evaluations.css"; // SC-25 と同じ採点 UI（.eval-row/.eval-rate/.stars/.star）を再利用
import "../concepts.css";

type AspectDef = { key: string; label: string; see: string };
const CORE_ASPECTS: AspectDef[] = [
  { key: "desirability", label: "望ましさ", see: "狙う価値が明確・対象が本当に欲しがるか（検証の裏付け込み）。" },
  { key: "feasibility", label: "実現可能性", see: "形態・必要能力が現実的か。" },
  { key: "viability", label: "採算・事業性", see: "コスト/収益モデル/ROI が筋か（価値実現モデル）。" },
  { key: "assumption_strength", label: "前提検証の強さ", see: "主要な前提が『証拠で』検証されているか（言い張りを弾く・ISO③ 固有ゲート）。" },
  { key: "differentiation", label: "差別化", see: "競合に対する位置づけ。" },
];
const AUX_ASPECTS: AspectDef[] = [
  { key: "novelty", label: "新規性", see: "既存に対する新しさ・独自性（ISO §8.3.3 b）。" },
  { key: "sustainability", label: "持続可能性", see: "環境・社会・事業継続で無理がないか（ISO §8.3.3 b）。" },
  { key: "ip", label: "知的財産", see: "知財で保護できるか／他者の知財を侵害しないか（ISO §8.3.3 b・§8.3.5 d）。" },
];
const RECOMMENDATIONS: [string, string][] = [["go", "推進"], ["pivot", "方向転換"], ["kill", "中止"]];

// SC-25 と同じスター採点行（.eval-row/.eval-rate/.stars/.star）。観点の説明は ⓘ のみ（ラベルなし）。
function ScoreRow({ def, value, onPick }: { def: AspectDef; value: number | undefined; onPick: (n: number) => void }) {
  const [hover, setHover] = useState<number | undefined>(undefined);
  const filled = hover ?? value ?? 0;
  return (
    <div className="eval-row">
      <div className="eval-row__head">
        <div className="eval-aspect-block">
          <span className="eval-aspect">{def.label}</span>
          <ScreenPurpose summary={def.see} dialogTitle={def.label}><p style={{ margin: 0 }}>{def.see}</p></ScreenPurpose>
        </div>
        <div className="eval-rate">
          <span className="stars" role="radiogroup" aria-label={`${def.label}の点数`} onMouseLeave={() => setHover(undefined)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" data-star={n} className={"star" + (n <= filled ? " is-on" : "")}
                role="radio" aria-checked={value === n} aria-label={`${n}点`}
                onMouseEnter={() => setHover(n)} onClick={() => onPick(n)}>★</button>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ConceptEvalView({ conceptId, onDone, onCancel }: { conceptId: string; onDone: () => void; onCancel: () => void }) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [overall, setOverall] = useState("");
  const [recommendation, setRecommendation] = useState<string>("");
  const [visibility, setVisibility] = useState<"party" | "limited">("party");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<null | "draft" | "submit">(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getMyEvaluation(conceptId).then((me) => {
      if (!alive) return;
      if (me?.status) {
        setScores((me.scores ?? {}) as Record<string, number>);
        setOverall(me.overall_comment ?? "");
        setRecommendation(me.recommendation ?? "");
        setVisibility((me.visibility ?? "party") as "party" | "limited");
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [conceptId]);

  const pick = (key: string, n: number) => setScores((s) => ({ ...s, [key]: n }));

  const validateSubmit = useCallback((): string[] => {
    const e: string[] = [];
    if (CORE_ASPECTS.some((a) => !scores[a.key])) e.push("中核5観点をすべて採点してください。");
    if (!overall.trim()) e.push("総評を入力してください。");
    if (!recommendation) e.push("推進 / 方向転換 / 中止 の推奨を選んでください。");
    return e;
  }, [scores, overall, recommendation]);

  async function save(status: "draft" | "submitted") {
    if (status === "submitted") {
      const e = validateSubmit();
      setErrors(e);
      if (e.length) { notify(e); return; }
    }
    setPending(status === "submitted" ? "submit" : "draft");
    try {
      await putEvaluation(conceptId, {
        scores, comments: {}, overall_comment: overall.trim() || null,
        recommendation: (recommendation || null) as "go" | "pivot" | "kill" | null,
        visibility, status,
      });
      window.dispatchEvent(new CustomEvent(CONCEPTS_CHANGED_EVENT));
      snack({ type: "success", title: status === "submitted" ? "評価を確定しました" : "下書きを保存しました" });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) { setErrors(["入力を確認してください（中核5＋総評＋推奨）。"]); notify(["入力を確認してください。"]); }
      else snack({ type: "error", msg: "保存できませんでした。" });
    } finally {
      setPending(null);
    }
  }

  if (loading) return <ModalBody><p className="muted">読み込み中…</p></ModalBody>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save("submitted"); }} noValidate data-sp-host>
      <ModalBody>
        <FormSummary title="入力内容を確認してください" errors={errors} innerRef={summaryRef} />

        <div className="dialog-section is-quiet">
          <div className="dialog-label">評価点（中核5・必須）</div>
          {CORE_ASPECTS.map((a) => <ScoreRow key={a.key} def={a} value={scores[a.key]} onPick={(n) => pick(a.key, n)} />)}
        </div>

        <details className="disclosure" style={{ marginTop: "var(--space-3)" }}>
          <summary>補助3観点（任意）</summary>
          <div className="disclosure__body">
            {AUX_ASPECTS.map((a) => <ScoreRow key={a.key} def={a} value={scores[a.key]} onPick={(n) => pick(a.key, n)} />)}
          </div>
        </details>

        <Field className="dialog-section is-quiet" id="eval_overall" label="総評" required>
          <textarea className="textarea" id="eval_overall" rows={3} value={overall} onChange={(e) => setOverall(e.target.value)} placeholder="全体の評価コメント（確定時必須）" />
        </Field>

        {/* 総合判定の推奨＝評価者が Go/Pivot/Kill をどう見るかのフラグ。style-guide の .segmented（3択以上の単一選択）。 */}
        <Field className="dialog-section is-quiet" id="eval_reco" label="総合判定の推奨" hint="評価者としての Go / Pivot / Kill の見立て（推進＝進める／方向転換＝見直す／中止）。" required>
          <div className="segmented" role="radiogroup" aria-label="推奨">
            {RECOMMENDATIONS.map(([k, lbl]) => (
              <label key={k}>
                <input type="radio" name="reco" checked={recommendation === k} onChange={() => setRecommendation(k)} />{lbl}
              </label>
            ))}
          </div>
        </Field>

        {/* 公開範囲＝アイデア評価(SC-25)と同じ .visibility/.vis-opt ラジオを再利用。 */}
        <div className="field dialog-section is-quiet">
          <label>評価結果の公開範囲</label>
          <div className="visibility">
            <label className={"vis-opt" + (visibility === "party" ? " is-sel" : "")}>
              <input type="radio" name="vis" value="party" checked={visibility === "party"} onChange={() => setVisibility("party")} />
              <span>
                <span className="vis-opt__title">🔓 パーティー全員に公開（既定）</span>
                <span className="vis-opt__desc">当該クエストの参加メンバー全員が、スコア・推奨・総評を閲覧できます。</span>
              </span>
            </label>
            <label className={"vis-opt" + (visibility === "limited" ? " is-sel" : "")}>
              <input type="radio" name="vis" value="limited" checked={visibility === "limited"} onChange={() => setVisibility("limited")} />
              <span>
                <span className="vis-opt__title">🔒 限定公開</span>
                <span className="vis-opt__desc">作成者＋評価者＋所有者/クエスト管理のみが閲覧できます（範囲外は非表示・集計にも含めません）。</span>
              </span>
            </label>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" className="dialog-close-left" onClick={onCancel}>キャンセル</Button>
        <Button type="button" variant="outline" disabled={!!pending} loading={pending === "draft"} onClick={() => void save("draft")}>下書き保存</Button>
        <Button type="submit" variant="primary" disabled={!!pending} loading={pending === "submit"}>評価を確定</Button>
      </ModalFooter>
    </form>
  );
}
