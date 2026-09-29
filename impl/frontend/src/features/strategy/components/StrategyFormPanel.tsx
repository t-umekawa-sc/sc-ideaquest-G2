"use client";

// SC-81 経営資料 登録・編集・複製フォーム（ドメイン R・FR-44）。ISO56001 の項目立て（意図/方針/戦略/重点領域/目標/期間）。
// 冒頭に ⓘ ガイダンス（ScreenPurpose・§4.13）／ISO 要求項目はラベル横 icon-only ⓘ で入力解説。重点領域は自由入力ありの複数選択。
import { useCallback, useEffect, useState } from "react";

import { Field, FormFooterError, FormSummary, ScreenPurpose, useFormErrorNotice } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createStrategyDoc, emitStrategyChanged, getStrategyDoc, updateStrategyDoc } from "../api";
import { DOC_KIND_LABEL } from "../types";
import type { StrategyDocInput } from "../types";
import "../strategy.css";

const KIND_OPTS = Object.entries(DOC_KIND_LABEL).map(([v, l]) => ({ v, l }));
const FOCUS_SUGGESTIONS = ["脱炭素", "DX", "海外展開", "人材育成", "新規事業", "コスト削減", "品質向上"];

// ISO56001 が要求する入力項目の「何を書くか」＝ラベル横の icon-only ⓘ（ホバー要約・クリック全文・§4.13）。
const FIELD_GUIDE: Record<string, { title: string; summary: string; full: string }> = {
  intent: {
    title: "イノベーションの意図・ビジョン（ISO §4/§5.1）",
    summary: "なぜ取り組むか・どこを目指すか。組織の状況（内外の課題）とビジョンを簡潔に。",
    full: "ISO56001 §4（組織の状況）／§5.1（リーダーシップ）に対応。なぜイノベーションに取り組むのか、どこを目指すのか（ビジョン）を書きます。内外の課題・機会の認識を踏まえると、下流のアイデア/コンセプトとの整合が締まります。",
  },
  policy_commitment: {
    title: "イノベーション方針・コミットメント（ISO §5.2）",
    summary: "トップが掲げる方針・約束。取り組む領域と資源投入の意思を明確に。",
    full: "ISO56001 §5.2（イノベーション方針）に対応。トップマネジメントが掲げる方針・コミットメント（約束）を書きます。どの領域に・どれだけ資源を投じる意思があるかを明確にすると、現場の判断基準になります。",
  },
  strategy: {
    title: "戦略・方向性（ISO §6.1 機会への取組み）",
    summary: "重点の攻め筋。機会・リスクへどう取り組むかの方向性。",
    full: "ISO56001 §6.1（リスク及び機会への取組み）に対応。重点の攻め筋＝どの機会をどう取りに行くか、どのリスクにどう備えるかの方向性を書きます。",
  },
  objectives: {
    title: "イノベーション目標（ISO §6.2）",
    summary: "測定可能な狙い・KPI 方針。いつまでに何を達成するか。",
    full: "ISO56001 §6.2（イノベーション目標及びそれを達成するための計画策定）に対応。測定可能な目標・KPI 方針を書きます（いつまでに・何を・どの水準で）。",
  },
  focus_areas: {
    title: "重点領域",
    summary: "整合の軸になる重点テーマ（例：脱炭素・DX）。複数可。",
    full: "方針・戦略の重点テーマをタグで複数登録します。ここに挙げた語がアイデアとの「関連度（キーワード）」に効きます（例：脱炭素、DX、海外展開）。",
  },
};

function inputGuide(key: string): React.ReactNode {
  const g = FIELD_GUIDE[key];
  if (!g) return undefined;
  return (
    <ScreenPurpose summary={g.summary} dialogTitle={`${g.title}の入力ヒント`}>
      <p style={{ margin: 0 }}>{g.full}</p>
    </ScreenPurpose>
  );
}

export function StrategyFormPanel({ docId, fromId, onCancel, onDone }: {
  docId?: string; fromId?: string; onCancel: () => void; onDone: () => void;
}) {
  const editing = Boolean(docId);
  const sourceId = docId || fromId; // 編集＝docId／複製＝fromId（値を引き継ぎ新規作成）
  const [loaded, setLoaded] = useState(!sourceId);
  const [title, setTitle] = useState("");
  const [docKind, setDocKind] = useState("midterm_plan");
  const [intent, setIntent] = useState("");
  const [policy, setPolicy] = useState("");
  const [strategy, setStrategy] = useState("");
  const [focus, setFocus] = useState<string[]>([]); // 重点領域＝自由入力ありの複数選択
  const [focusInput, setFocusInput] = useState("");
  const [objectives, setObjectives] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [periodErr, setPeriodErr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { summaryRef, notify } = useFormErrorNotice();

  useEffect(() => {
    if (!sourceId) return;
    const ac = new AbortController();
    getStrategyDoc(sourceId, ac.signal).then((d) => {
      if (!d) { setLoaded(true); return; }
      // 複製＝タイトルに（複製）を付ける（標準・デザイン標準 §複製＝入力項目は全プリフィル）。
      setTitle(fromId ? `${d.title}（複製）` : d.title);
      setDocKind(d.doc_kind); setIntent(d.intent ?? ""); setPolicy(d.policy_commitment ?? "");
      setStrategy(d.strategy ?? ""); setFocus(d.focus_areas ?? []); setObjectives(d.objectives ?? "");
      setBodyMd(d.body_md ?? ""); setPeriodFrom(d.period_from ?? ""); setPeriodTo(d.period_to ?? "");
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => ac.abort();
  }, [sourceId, fromId]);

  const addFocus = (v: string) => {
    const t = v.trim();
    if (t && !focus.includes(t)) setFocus((f) => [...f, t]);
    setFocusInput("");
  };
  const onFocusKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); addFocus(focusInput); }
    else if (e.key === "Backspace" && !focusInput && focus.length) setFocus((f) => f.slice(0, -1));
  };

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
      focus_areas: focus, objectives: objectives.trim() || null, body_md: bodyMd.trim() || null,
      period_from: periodFrom || null, period_to: periodTo || null,
    };
    try {
      if (editing && docId) await updateStrategyDoc(docId, input);
      else await createStrategyDoc(input); // 新規・複製とも create
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
      <div className="modal__body" data-sp-host>
        <FormSummary title="入力内容をご確認ください" errors={[formError, titleErr, periodErr].filter(Boolean) as string[]} innerRef={summaryRef} />
        <ScreenPurpose
          label="この画面について"
          summary="ISO 56001 の意図・方針・戦略・重点領域・目標に沿って会社の基準文書を登録します。"
          dialogTitle="経営資料の登録について"
        >
          <p style={{ margin: 0 }}>会社の中長期計画・方針・戦略を ISO 56001 の項目立てで登録します。ここで登録した資料を<strong>クエストで選ぶ</strong>と、配下アイデアの「方針との関連度（キーワードベース）」を算出します。各項目のラベル横 ⓘ に入力のヒントがあります。</p>
        </ScreenPurpose>

        <Field className="dialog-section is-quiet" id="sd-title" label="タイトル" required error={titleErr}>
          <input className="input" id="sd-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例）2027-2029 中期経営計画" />
        </Field>
        <div className="form-grid-2">
          <Field className="dialog-section is-quiet" id="sd-kind" label="種別">
            <select className="select" id="sd-kind" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
              {KIND_OPTS.map(({ v, l }) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field className="dialog-section is-quiet" id="sd-from" label="対象期間（開始）" error={periodErr}>
            <input className="input" id="sd-from" type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </Field>
          <Field className="dialog-section is-quiet" id="sd-to" label="対象期間（終了）">
            <input className="input" id="sd-to" type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </Field>
        </div>

        {/* 重点領域＝自由入力ありの複数選択（チップ＋Enter 追加＋候補ボタン）。 */}
        <Field className="dialog-section is-quiet" id="sd-focus" label="重点領域" guide={inputGuide("focus_areas")}>
          {focus.length > 0 && (
            <div className="tagselect__chips">
              {focus.map((c) => (
                <span key={c} className="tagselect__chip">{c}
                  <button type="button" aria-label={`${c} を外す`} onClick={() => setFocus((f) => f.filter((x) => x !== c))}>✕</button>
                </span>
              ))}
            </div>
          )}
          <input className="input" id="sd-focus" role="combobox" aria-expanded={false} placeholder="入力して Enter で追加（例：脱炭素）"
            value={focusInput} onChange={(e) => setFocusInput(e.target.value)} onKeyDown={onFocusKeyDown} />
          <div className="tagselect__sug">
            {FOCUS_SUGGESTIONS.filter((s) => !focus.includes(s)).map((s) => (
              <button key={s} type="button" className="tagselect__sugbtn" onClick={() => addFocus(s)}>＋ {s}</button>
            ))}
          </div>
        </Field>

        <Field className="dialog-section is-quiet" id="sd-intent" label="イノベーションの意図・ビジョン" guide={inputGuide("intent")}>
          <textarea className="input" id="sd-intent" rows={3} value={intent} onChange={(e) => setIntent(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-policy" label="イノベーション方針・コミットメント" guide={inputGuide("policy_commitment")}>
          <textarea className="input" id="sd-policy" rows={3} value={policy} onChange={(e) => setPolicy(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-strategy" label="戦略・方向性" guide={inputGuide("strategy")}>
          <textarea className="input" id="sd-strategy" rows={3} value={strategy} onChange={(e) => setStrategy(e.target.value)} />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-obj" label="イノベーション目標" guide={inputGuide("objectives")}>
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
