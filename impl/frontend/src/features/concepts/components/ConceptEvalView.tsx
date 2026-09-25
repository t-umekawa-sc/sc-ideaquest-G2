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
        <div className="eval-aspect-block" data-sp-host>
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
    <form onSubmit={(e) => { e.preventDefault(); void save("submitted"); }} noValidate>
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

        <Field className="dialog-section is-quiet" id="eval_reco" label="総合判定の推奨（推進 / 方向転換 / 中止）" required>
          <div id="eval_reco" className="eval-scores" role="radiogroup" aria-label="推奨">
            {RECOMMENDATIONS.map(([k, lbl]) => (
              <button key={k} type="button" className={`btn ${recommendation === k ? "btn-primary" : "btn-outline"}`}
                role="radio" aria-checked={recommendation === k} onClick={() => setRecommendation(k)}>{lbl}</button>
            ))}
          </div>
        </Field>

        <Field className="dialog-section is-quiet" id="eval_vis" label="公開範囲" hint="限定＝投稿者＋評価者＋所有者/管理のみ（範囲外は非表示）。">
          <select className="select" id="eval_vis" value={visibility} onChange={(e) => setVisibility(e.target.value as "party" | "limited")}>
            <option value="party">パーティー全員</option>
            <option value="limited">限定</option>
          </select>
        </Field>
      </ModalBody>
      <ModalFooter>
        <Button type="button" className="dialog-close-left" onClick={onCancel}>キャンセル</Button>
        <Button type="button" variant="outline" disabled={!!pending} loading={pending === "draft"} onClick={() => void save("draft")}>下書き保存</Button>
        <Button type="submit" variant="primary" disabled={!!pending} loading={pending === "submit"}>評価を確定</Button>
      </ModalFooter>
    </form>
  );
}
