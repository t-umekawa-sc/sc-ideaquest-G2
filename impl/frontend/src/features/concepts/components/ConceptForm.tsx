"use client";

// SC-60 コンセプト登録・編集フォーム（FR-42・P.2）。由来アイデア選択＋成果物スキーマ入力（viability=JSON）。
// 入力前理解のためフォーム冒頭に ⓘ ガイダンス（デザイン標準§4.13）。正＝doc/画面設計/screens/SC-60_コンセプト登録編集.md。
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, Field, FormSummary, ModalBody, ModalFooter, ScreenPurpose, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { listIdeas, type IdeaCard } from "@/features/ideas/api";

import { CONCEPTS_CHANGED_EVENT, createConcept, getConcept, patchConcept, type ConceptCreateInput } from "../api";
import "../concepts.css";

type Props = {
  mode: "create" | "edit";
  questId?: string; // create で必須
  conceptId?: string; // edit で必須
  onDone: () => void;
  onCancel: () => void;
};

type FieldErrors = { title?: string; viability?: string };

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
  const [viability, setViability] = useState("");
  const [sourceIdeas, setSourceIdeas] = useState<string[]>([]);
  const [ideaOptions, setIdeaOptions] = useState<IdeaCard[]>([]);
  const [ownQuestId, setOwnQuestId] = useState<string | undefined>(questId);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
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
      setViability(c.viability && Object.keys(c.viability).length ? JSON.stringify(c.viability, null, 2) : "");
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
    if (viability.trim()) {
      try { JSON.parse(viability); } catch { e.viability = "JSON 形式で入力してください（例: {\"roi\":\"18ヶ月\"}）。"; }
    }
    return e;
  }, [title, viability]);

  function toggleIdea(id: string) {
    setSourceIdeas((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      viability: viability.trim() ? JSON.parse(viability) : {},
    };
    setPending(true);
    try {
      if (isEdit && conceptId) {
        await patchConcept(conceptId, body);
        window.dispatchEvent(new CustomEvent(CONCEPTS_CHANGED_EVENT));
        snack({ type: "success", title: "コンセプトを更新しました" });
        onDone();
      } else if (ownQuestId) {
        const created = await createConcept(ownQuestId, body);
        window.dispatchEvent(new CustomEvent(CONCEPTS_CHANGED_EVENT));
        snack({ type: "success", title: "コンセプトを登録しました（下書き）" });
        onDone();
        if (created?.id) router.push(`/concepts/${created.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrors({ title: "入力を確認してください。" });
        notify(["入力を確認してください。"]);
      } else {
        snack({ type: "error", msg: "保存できませんでした。" });
      }
    } finally {
      setPending(false);
    }
  }

  const summary = Object.values(errors).filter(Boolean) as string[];

  if (loading) return <ModalBody><p className="muted">読み込み中…</p></ModalBody>;

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody>
        <FormSummary title="入力内容を確認してください" errors={summary} innerRef={summaryRef} />

        <div className="dialog-section is-quiet" data-sp-host style={{ marginBottom: "var(--space-3)" }}>
          <ScreenPurpose
            label="コンセプトとは？"
            summary="選別済みアイデアを統合し、課題/価値/差別化/採算(viability)と「前提と検証」をまとめた検証可能な提案（ISO 56002 §8.3 ②③段）。粒度＝1クエスト内で競合する検証単位。"
            dialogTitle="この画面について（ISO 56002 準拠）"
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

        <Field className="dialog-section is-quiet" id="c_viability" label="採算・事業性（viability）" hint='価値実現モデル（コスト/収益モデル/ROI）。JSON で任意キー。例: {"cost":"初期200万","roi":"18ヶ月"}' error={errors.viability}>
          <textarea className="textarea" id="c_viability" rows={4} value={viability} onChange={(e) => setViability(e.target.value)} placeholder='{"cost":"...","revenue":"...","roi":"..."}' style={{ fontFamily: "monospace" }} />
        </Field>
      </ModalBody>
      <ModalFooter>
        <Button type="button" className="dialog-close-left" onClick={onCancel}>キャンセル</Button>
        <Button type="submit" variant="primary" disabled={pending} loading={pending}>{isEdit ? "保存" : "登録（下書き）"}</Button>
      </ModalFooter>
    </form>
  );
}
