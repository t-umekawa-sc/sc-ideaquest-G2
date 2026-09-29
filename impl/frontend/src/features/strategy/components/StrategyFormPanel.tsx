"use client";

// SC-81 経営資料 登録・編集フォーム（ドメイン R・FR-44）。ISO56001 の項目立て（意図/方針/戦略/重点領域/目標/期間）。
// モーダル（RouteModal）／フルページ双方から使う（body/footer を出す）。検証は §4.7 の4部品。
import { useCallback, useEffect, useState } from "react";

import { Field, FormFooterError, FormSummary, useFormErrorNotice } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createStrategyDoc, emitStrategyChanged, getStrategyDoc, updateStrategyDoc } from "../api";
import { DOC_KIND_LABEL } from "../types";
import type { StrategyDocInput } from "../types";
import "../strategy.css";

const KIND_OPTS = Object.entries(DOC_KIND_LABEL).map(([v, l]) => ({ v, l }));

export function StrategyFormPanel({ docId, onCancel, onDone }: {
  docId?: string; onCancel: () => void; onDone: () => void;
}) {
  const editing = Boolean(docId);
  const [loaded, setLoaded] = useState(!editing);
  const [title, setTitle] = useState("");
  const [docKind, setDocKind] = useState("midterm_plan");
  const [intent, setIntent] = useState("");
  const [policy, setPolicy] = useState("");
  const [strategy, setStrategy] = useState("");
  const [focus, setFocus] = useState(""); // カンマ区切り → focus_areas[]
  const [objectives, setObjectives] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [periodErr, setPeriodErr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { summaryRef, notify } = useFormErrorNotice();

  // 編集＝既存値をロード。
  useEffect(() => {
    if (!docId) return;
    const ac = new AbortController();
    getStrategyDoc(docId, ac.signal).then((d) => {
      if (!d) return;
      setTitle(d.title); setDocKind(d.doc_kind); setIntent(d.intent ?? ""); setPolicy(d.policy_commitment ?? "");
      setStrategy(d.strategy ?? ""); setFocus((d.focus_areas ?? []).join(", ")); setObjectives(d.objectives ?? "");
      setBodyMd(d.body_md ?? ""); setPeriodFrom(d.period_from ?? ""); setPeriodTo(d.period_to ?? "");
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => ac.abort();
  }, [docId]);

  const validate = useCallback((): string[] => {
    const errs: string[] = [];
    const te = title.trim() ? null : "タイトルを入力してください。";
    setTitleErr(te); if (te) errs.push(te);
    const pe = periodFrom && periodTo && periodFrom > periodTo ? "対象期間の開始が終了より後になっています。" : null;
    setPeriodErr(pe); if (pe) errs.push(pe);
    return errs;
  }, [title, periodFrom, periodTo]);

  const save = async () => {
    setFormError(null);
    const errs = validate();
    if (errs.length) { notify(errs); return; }
    setSaving(true);
    const input: StrategyDocInput = {
      title: title.trim(), doc_kind: docKind,
      intent: intent.trim() || null, policy_commitment: policy.trim() || null, strategy: strategy.trim() || null,
      focus_areas: focus.split(/[,、]/).map((s) => s.trim()).filter(Boolean),
      objectives: objectives.trim() || null, body_md: bodyMd.trim() || null,
      period_from: periodFrom || null, period_to: periodTo || null,
    };
    try {
      if (editing && docId) await updateStrategyDoc(docId, input);
      else await createStrategyDoc(input);
      emitStrategyChanged();
      onDone();
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      const msg = st === 403 ? "経営資料を編集する権限がありません。" : st === 422 ? "入力内容をご確認ください。" : "保存に失敗しました。";
      setFormError(msg);
      notify([msg]);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="modal__body"><p className="admin-muted">読み込み中…</p></div>;

  return (
    <>
      <div className="modal__body">
        <FormSummary title="入力内容をご確認ください" errors={[formError, titleErr, periodErr].filter(Boolean) as string[]} innerRef={summaryRef} />
        <p className="screen-purpose">ISO 56001 の <strong>意図・方針・戦略・重点領域・目標</strong> に沿って会社の基準文書を登録します。ここで登録した資料をクエストで選ぶと、配下アイデアの「方針との関連度」を算出します。</p>

        <Field className="dialog-section is-quiet" id="sd-title" label="タイトル" required error={titleErr}>
          <input className="input" id="sd-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例）2027-2029 中期経営計画" />
        </Field>
        <div className="form-grid-2">
          <Field className="dialog-section is-quiet" id="sd-kind" label="種別">
            <select className="select" id="sd-kind" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
              {KIND_OPTS.map(({ v, l }) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field className="dialog-section is-quiet" id="sd-focus" label="重点領域" hint="カンマ区切りで複数（例：脱炭素, DX, 海外展開）">
            <input className="input" id="sd-focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="脱炭素, DX" />
          </Field>
          <Field className="dialog-section is-quiet" id="sd-from" label="対象期間（開始）" error={periodErr}>
            <input className="input" id="sd-from" type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </Field>
          <Field className="dialog-section is-quiet" id="sd-to" label="対象期間（終了）">
            <input className="input" id="sd-to" type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </Field>
        </div>

        <Field className="dialog-section is-quiet" id="sd-intent" label="イノベーションの意図・ビジョン" hint="なぜ・どこを目指すか（ISO §4/§5.1）">
          <textarea className="input" id="sd-intent" rows={3} value={intent} onChange={(e) => setIntent(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-policy" label="イノベーション方針・コミットメント" hint="トップの方針・約束（ISO §5.2）">
          <textarea className="input" id="sd-policy" rows={3} value={policy} onChange={(e) => setPolicy(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-strategy" label="戦略・方向性" hint="重点の攻め筋（ISO §6.1 機会への取組み）">
          <textarea className="input" id="sd-strategy" rows={3} value={strategy} onChange={(e) => setStrategy(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-obj" label="イノベーション目標" hint="測定可能な狙い・KPI 方針（ISO §6.2）">
          <textarea className="input" id="sd-obj" rows={3} value={objectives} onChange={(e) => setObjectives(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-body" label="補足・全文" hint="上記に載らない全文貼付（整合率の追加素材）">
          <textarea className="input" id="sd-body" rows={5} value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} />
        </Field>
      </div>
      <div className="modal__footer">
        <button className="btn btn-outline" type="button" onClick={onCancel}>キャンセル</button>
        <FormFooterError show={Boolean(titleErr || periodErr || formError)} />
        <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>
          {saving ? "保存中…" : editing ? "保存する" : "登録する"}
        </button>
      </div>
    </>
  );
}
