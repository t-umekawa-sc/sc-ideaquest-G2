"use client";

// SC-60 コンセプト登録・編集フォーム（FR-42・P.2）。由来アイデア選択＋成果物スキーマ入力（viability=JSON）。
// 入力前理解のためフォーム冒頭に ⓘ ガイダンス（デザイン標準§4.13）。正＝doc/画面設計/screens/SC-60_コンセプト登録編集.md。
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, Field, FormSummary, ModalBody, ModalFooter, ScreenPurpose, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { listIdeas, type IdeaCard } from "@/features/ideas/api";

import { activateConcept, CONCEPTS_CHANGED_EVENT, createConcept, getConcept, patchConcept, type ConceptCreateInput } from "../api";
import "../concepts.css";

type Props = {
  mode: "create" | "edit";
  questId?: string; // create で必須
  conceptId?: string; // edit で必須
  onDone: () => void;
  onCancel: () => void;
};

type FieldErrors = { title?: string };

// viability（価値実現モデル）＝ラベル付き構造入力（SC-60 §4・2026-09-25）。JSON 直接入力の負荷を避ける。
const VIABILITY_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "cost", label: "コスト（初期/運用）", placeholder: "例: 初期200万＋月額運用10万" },
  { key: "revenue", label: "収益モデル", placeholder: "例: SaaS 月額課金" },
  { key: "roi", label: "ROI・投資回収", placeholder: "例: 18ヶ月で回収" },
  { key: "notes", label: "備考（その他）", placeholder: "補足があれば" },
];

export function ConceptForm({ mode, questId, conceptId, onDone, onCancel }: Props) {
  const router = useRouter();
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const isEdit = mode === "edit";

  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [target, setTarget] = useState("");
  const [differentiation, setDifferentiation] = useState("");
  const [solutionForm, setSolutionForm] = useState("");
  const [viab, setViab] = useState<Record<string, string>>({}); // cost/revenue/roi/notes
  const [viabExtra, setViabExtra] = useState<Record<string, unknown>>({}); // 分解対象外の既存キー（温存）
  const [sourceIdeas, setSourceIdeas] = useState<string[]>([]);
  const [ideaOptions, setIdeaOptions] = useState<IdeaCard[]>([]);
  const [ownQuestId, setOwnQuestId] = useState<string | undefined>(questId);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<null | "draft" | "publish">(null);
  const [loading, setLoading] = useState(isEdit);

  // edit＝既存値をプリフィル（P.1）。quest_id は由来アイデア候補の取得に使う。
  useEffect(() => {
    if (!isEdit || !conceptId) return;
    let alive = true;
    getConcept(conceptId).then((c) => {
      if (!alive || !c) return;
      setTitle(c.title);
      setProblem(c.problem ?? "");
      setValueProp(c.value_proposition ?? "");
      setTarget(c.target ?? "");
      setDifferentiation(c.differentiation ?? "");
      setSolutionForm(c.solution_form ?? "");
      const via = { ...(c.viability ?? {}) } as Record<string, unknown>;
      const known: Record<string, string> = {};
      for (const f of VIABILITY_FIELDS) {
        if (typeof via[f.key] === "string") known[f.key] = via[f.key] as string;
        delete via[f.key];
      }
      setViab(known);
      setViabExtra(via);
      setSourceIdeas(c.source_ideas.map((s) => s.idea_id));
      setOwnQuestId(c.quest_id);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [isEdit, conceptId]);

  // 由来アイデア候補＝同一クエストの公開アイデア（P.2 スコープ）。
  useEffect(() => {
    if (!ownQuestId) return;
    listIdeas(ownQuestId).then((r) => setIdeaOptions((r?.data ?? []).filter((i) => i.status === "published")));
  }, [ownQuestId]);

  const validate = useCallback((): FieldErrors => {
    const e: FieldErrors = {};
    if (!title.trim()) e.title = "コンセプト名を入力してください。";
    return e;
  }, [title]);

  function toggleIdea(id: string) {
    setSourceIdeas((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  // 下書き保存（publish=false）／投稿する（publish=true＝作成/保存後に公開＝activate・アイデアの投稿と同型）。
  async function submit(publish: boolean) {
    const fe = validate();
    setErrors(fe);
    const list = Object.values(fe).filter(Boolean) as string[];
    if (list.length) { notify(list); return; }
    const body: ConceptCreateInput = {
      title: title.trim(),
      source_idea_ids: sourceIdeas,
      problem: problem.trim() || null,
      value_proposition: valueProp.trim() || null,
      target: target.trim() || null,
      differentiation: differentiation.trim() || null,
      solution_form: solutionForm.trim() || null,
      viability: (() => {
        const obj: Record<string, unknown> = { ...viabExtra };
        for (const f of VIABILITY_FIELDS) {
          const v = (viab[f.key] ?? "").trim();
          if (v) obj[f.key] = v; else delete obj[f.key];
        }
        return obj;
      })(),
    };
    setPending(publish ? "publish" : "draft");
    try {
      let targetId = conceptId;
      if (isEdit && conceptId) {
        await patchConcept(conceptId, body);
      } else if (ownQuestId) {
        const created = await createConcept(ownQuestId, body);
        targetId = created?.id;
      }
      if (publish && targetId) await activateConcept(targetId);
      window.dispatchEvent(new CustomEvent(CONCEPTS_CHANGED_EVENT));
      snack({ type: "success", title: publish ? "コンセプトを投稿しました（公開）" : "下書きを保存しました" });
      onDone();
      if (!isEdit && targetId) router.push(`/concepts/${targetId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrors({ title: "入力を確認してください。" });
        notify(["入力を確認してください。"]);
      } else if (err instanceof ApiError && err.status === 403) {
        snack({ type: "error", msg: "公開する権限がありません（下書き保存はできます）。" });
      } else {
        snack({ type: "error", msg: "保存できませんでした。" });
      }
    } finally {
      setPending(null);
    }
  }

  const summary = Object.values(errors).filter(Boolean) as string[];

  if (loading) return <ModalBody><p className="muted">読み込み中…</p></ModalBody>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(false); }} noValidate>
      <ModalBody>
        <FormSummary title="入力内容を確認してください" errors={summary} innerRef={summaryRef} />

        <div className="dialog-section is-quiet" data-sp-host style={{ marginBottom: "var(--space-3)" }}>
          <ScreenPurpose
            label="コンセプトとは？"
            summary="選別済みアイデアを統合し、課題/価値/差別化/採算(viability)と「前提と検証」をまとめた検証可能な提案（ISO 56001 §8.3 ②③段）。粒度＝1クエスト内で競合する検証単位。"
            dialogTitle="この画面について（ISO 56001 準拠）"
          >
            <div className="dialog-section"><div className="dialog-label">コンセプトとは</div><p style={{ margin: 0 }}>選別済みのアイデアを統合し、<strong>課題・機会／価値提案と対象／競合・差別化／解の形態と必要な能力／採算・事業性（viability）／前提と検証</strong>をまとめた、<strong>検証可能な提案</strong>です。</p></div>
            <div className="dialog-section"><div className="dialog-label">この画面の狙い</div><p style={{ margin: 0 }}>理解したうえでスキーマを入力し、後で前提を「証拠で」検証して Go/Pivot/Kill まで導きます。</p></div>
          </ScreenPurpose>
        </div>

        <Field className="dialog-section is-quiet" id="c_title" label="コンセプト名" required error={errors.title}>
          <input className="input" id="c_title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: スマート勤怠アシスタント" />
        </Field>

        <Field className="dialog-section is-quiet" id="c_sources" label="由来アイデア" hint="このコンセプトの元になった選別済み（公開）アイデア（複数可）。">
          <div id="c_sources" className="concept-source-list">
            {ideaOptions.length === 0 ? (
              <p className="muted text-sm" style={{ margin: 0 }}>選べる公開アイデアがありません。</p>
            ) : (
              ideaOptions.map((i) => (
                <label key={i.id} className="checkbox">
                  <input type="checkbox" checked={sourceIdeas.includes(i.id)} onChange={() => toggleIdea(i.id)} />
                  <span>{i.title}</span>
                </label>
              ))
            )}
          </div>
        </Field>

        <Field className="dialog-section is-quiet" id="c_problem" label="課題・機会">
          <textarea className="textarea" id="c_problem" rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="c_value" label="狙う価値（価値提案）">
          <textarea className="textarea" id="c_value" rows={2} value={valueProp} onChange={(e) => setValueProp(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="c_target" label="対象">
          <input className="input" id="c_target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="ユーザ／既存顧客／市場" />
        </Field>
        <Field className="dialog-section is-quiet" id="c_diff" label="競合・差別化">
          <textarea className="textarea" id="c_diff" rows={2} value={differentiation} onChange={(e) => setDifferentiation(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="c_solution" label="解の形態＋必要な能力（粗）">
          <textarea className="textarea" id="c_solution" rows={2} value={solutionForm} onChange={(e) => setSolutionForm(e.target.value)} />
        </Field>

        <div className="dialog-section is-quiet" data-sp-host>
          <div className="concept-section-head" style={{ marginBottom: "var(--space-1)" }}>
            <span style={{ fontWeight: 600 }}>採算・事業性（viability）</span>
            <ScreenPurpose label="viability とは？" summary="価値実現モデル（value realization model）＝コスト/収益モデル/ROI で how value can be realized を示す（ISO §8.3.3）。経営が投資判断できる証拠まで。" dialogTitle="viability（価値実現モデル）とは">
              <p style={{ margin: 0 }}>ISO 56001 §8.3.3 の value realization model。<strong>コスト・収益モデル・ROI</strong> 等で「どう価値を実現するか」を示す、経営説得の核です。</p>
            </ScreenPurpose>
          </div>
          {VIABILITY_FIELDS.map((f) => (
            <Field key={f.key} className="dialog-section is-quiet" id={`c_v_${f.key}`} label={f.label}>
              <input className="input" id={`c_v_${f.key}`} value={viab[f.key] ?? ""} onChange={(e) => setViab((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} />
            </Field>
          ))}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" className="dialog-close-left" onClick={onCancel}>キャンセル</Button>
        <Button type="button" variant="outline" disabled={pending !== null} loading={pending === "draft"} onClick={() => void submit(false)}>下書き保存</Button>
        <Button type="button" variant="primary" disabled={pending !== null} loading={pending === "publish"} onClick={() => void submit(true)}>投稿する</Button>
      </ModalFooter>
    </form>
  );
}
