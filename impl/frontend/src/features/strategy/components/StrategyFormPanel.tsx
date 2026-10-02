"use client";

// SC-81 経営資料 登録・編集・複製フォーム（ドメイン R・FR-44）。ISO56001 の項目立て（意図/方針/戦略/重点領域/目標/期間）。
// 冒頭に ⓘ ガイダンス（ScreenPurpose・§4.13）／ISO 要求項目はラベル横 icon-only ⓘ で入力解説。重点領域は自由入力ありの複数選択。
import { useCallback, useEffect, useState } from "react";

import { Field, FormFooterError, FormSummary, ScreenPurpose, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { emitAiJobsChanged } from "@/features/ai-jobs";
import { cloudTokens } from "@/features/info-input/wordcloud";

import { addStrategyQuests, createStrategyDoc, emitStrategyChanged, exportStrategyMarkdown, fetchStrategyGeneration, fetchStrategyWordCloud, generateStrategyIso, getStrategyDoc, updateStrategyDoc } from "../api";
import { DOC_KIND_LABEL } from "../types";
import type { ImpactRates, QuestLinkItem, StrategyGeneration, StrategyWordCloud } from "../types";
import type { StrategyDocInput } from "../types";
import { StrategyQuestLinks } from "./StrategyQuestLinks";
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
  const [cloud, setCloud] = useState<[string, number][] | null>(null); // この資料の主要語（プレビュー・情報登録と同一UI）
  const [impact, setImpact] = useState<ImpactRates | null>(null); // 情報の影響サマリ（編集時のみ・R.4）
  const [surround, setSurround] = useState<StrategyWordCloud | null>(null); // この方針まわりの語像（編集時のみ・R.4b）
  const [questLinks, setQuestLinks] = useState<QuestLinkItem[]>([]); // 紐づくクエスト（編集＝API即時／登録＝ステージ）
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [periodErr, setPeriodErr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false); // AI 用 Markdown エクスポート中（R.5）
  const [generation, setGeneration] = useState<StrategyGeneration | null>(null); // Phase2 in-app 生成（最新ジョブ・R.6）
  const [generating, setGenerating] = useState(false);
  const { summaryRef, notify } = useFormErrorNotice();
  const snack = useSnackbar();

  // Phase2 in-app 生成（iso_generate・FR-45 基盤へ投入）＝たたき台を生成し人が確定（外部送信しない＝自社ホスト LLM）。
  const runGenerate = async () => {
    if (!docId) return;
    setGenerating(true);
    try {
      await generateStrategyIso(docId);
      emitAiJobsChanged(); // ヘッダーの AIジョブ件数バッジを更新
      setGeneration({ job_id: "", status: "queued", result_text: null, error: null, finished_at: null });
      snack({ type: "success", title: "生成を開始しました", msg: "完了まで少し待ちます（AI処理状況でも確認できます）。" });
    } catch {
      snack({ type: "error", title: "生成の開始に失敗しました" });
    } finally {
      setGenerating(false);
    }
  };

  // 生成中（queued/running）は結果が出るまで軽くポーリングして状態を更新する。
  useEffect(() => {
    if (!docId || !generation || (generation.status !== "queued" && generation.status !== "running")) return;
    const t = setInterval(() => {
      fetchStrategyGeneration(docId).then((g) => g && setGeneration(g)).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [docId, generation]);

  // AI 用 Markdown をコピー/ダウンロード（R.5・外部送信しない＝生テキストをローカルで扱うだけ）。
  const runExport = async (mode: "copy" | "download") => {
    if (!docId) return;
    setExporting(true);
    try {
      const md = await exportStrategyMarkdown(docId);
      if (mode === "copy") {
        await navigator.clipboard.writeText(md);
        snack({ type: "success", title: "Markdown をコピーしました", msg: "AI に貼り付けてご利用いただけます。" });
      } else {
        const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
        const a = document.createElement("a");
        a.href = url; a.download = `strategy-${docId}.md`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      snack({ type: "error", title: "エクスポートに失敗しました" });
    } finally {
      setExporting(false);
    }
  };

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
      if (!fromId) setImpact(d.impact ?? null); // 影響サマリは編集時のみ（複製は元資料の値なので出さない）
      if (!fromId) fetchStrategyWordCloud(sourceId, ac.signal).then(setSurround).catch(() => {}); // 方針まわりの語像（R.4b）
      if (!fromId) fetchStrategyGeneration(sourceId, ac.signal).then(setGeneration).catch(() => {}); // 最新の AI 生成（R.6）
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

  // 主要語は入力から自動抽出＝ボタンを押さずに表示（編集時は読込済み内容で即・以後は入力に追従／400ms デバウンス）。
  // 連結＝構造化項目＋補足（保存時の entity_tokens〔janome〕の目安・整合率の関連度に効く）。
  useEffect(() => {
    const text = [title, intent, policy, strategy, objectives, focus.join(" "), bodyMd].filter(Boolean).join(" ").trim();
    const t = setTimeout(() => setCloud(text ? cloudTokens(text) : []), 400);
    return () => clearTimeout(t);
  }, [title, intent, policy, strategy, objectives, focus, bodyMd]);

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
      else {
        const created = await createStrategyDoc(input); // 新規・複製とも create
        // 登録時にステージした紐づくクエストを保存後に一括反映（編集時は即時反映済み）。
        if (created && questLinks.length) await addStrategyQuests(created.id, questLinks.map((x) => x.id));
      }
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

        {/* 情報の影響サマリ（R.4・編集時のみ・read 集計＝決定的）。この方針に「効いている」判定済情報の量と機会/脅威の内訳。 */}
        {editing && impact && (
          <div className="dialog-section is-quiet impact-card">
            <div className="dialog-label">📊 この方針への情報の影響（判定済情報 {impact.info_total} 件中 {impact.related_count} 件が関連）</div>
            {impact.related_count > 0 ? (
              <>
                <div className="impact-rates">
                  <span className="impact-rate">影響率 <strong>{Math.round(impact.impact_rate * 100)}%</strong></span>
                  <span className="impact-rate is-opp">機会率 <strong>{Math.round(impact.opportunity_rate * 100)}%</strong>（{impact.opportunity_count} 件）</span>
                  <span className="impact-rate is-threat">脅威率 <strong>{Math.round(impact.threat_rate * 100)}%</strong>（{impact.threat_count} 件）</span>
                </div>
                <span className="hint">関連度しきい値 {impact.threshold} 以上でキーワードが効いている判定済情報を母集団に集計（決定的）。機会/脅威は情報の分類（人手トリアージ）由来。</span>
              </>
            ) : (
              <span className="hint">この方針に関連度しきい値（{impact.threshold}）以上で効いている判定済情報はまだありません。</span>
            )}
          </div>
        )}

        {/* この方針まわりの語像（R.4b・編集時のみ・設計§7＝集約でのみ UI 化）。関連情報＋アイデア＋コンセプトの語を集約。 */}
        {editing && surround && surround.related_count > 0 && surround.tokens.length > 0 && (
          <div className="dialog-section is-quiet surround-wc">
            <div className="dialog-label">☁️ この方針まわりの語像（関連 {surround.related_count} 件＝情報・アイデア・コンセプト）</div>
            <div className="wc-mini">
              {surround.tokens.map((t) => (
                <span key={t.token} className="wc-word" style={{ fontSize: `${(0.85 + t.weight * 0.9).toFixed(2)}rem` }} title={`${t.token}（${t.count}）`}>{t.token}</span>
              ))}
            </div>
            <span className="hint">この方針に関連する情報・アイデア・コンセプトに現れる語を集約したものです（決定的・キーワードベース）。</span>
          </div>
        )}

        {/* AI 用 Markdown エクスポート（R.5・編集時のみ・外部送信しない）。関連アイデア/情報/コンセプトを束ねて出力。 */}
        {editing && (
          <div className="dialog-section is-quiet export-md">
            <div className="dialog-label">🤖 AI 用にエクスポート</div>
            <p className="hint" style={{ marginTop: 0 }}>経営資料＋関連アイデア/情報/コンセプトを構造化 Markdown で出力します。ChatGPT 等に貼って意図/戦略の下書きにご利用ください（本アプリは外部送信しません）。</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={exporting} onClick={() => runExport("copy")}>📋 コピー</button>
              <button type="button" className="btn btn-outline btn-sm" disabled={exporting} onClick={() => runExport("download")}>⬇ ダウンロード（.md）</button>
            </div>
          </div>
        )}

        {/* アプリ内 AI 生成（R.6・FR-45 基盤・編集時のみ）＝自社ホスト LLM で ISO たたき台を生成し、人が確定。外部送信なし。 */}
        {editing && (
          <div className="dialog-section is-quiet gen-iso">
            <div className="dialog-label">🤖 AI で下書きを生成（ISO56001 §6）</div>
            <p className="hint" style={{ marginTop: 0 }}>経営資料＋関連を基に、意図/戦略/方針のたたき台を<strong>アプリ内の自社ホスト LLM</strong>で生成します（外部送信しません）。生成されたら内容を確認し、各項目へ反映してください。</p>
            <button type="button" className="btn btn-outline btn-sm" disabled={generating || generation?.status === "queued" || generation?.status === "running"} onClick={runGenerate}>
              {generation?.status === "queued" || generation?.status === "running" ? "生成中…" : "✨ AI で生成する"}
            </button>
            {(generation?.status === "queued" || generation?.status === "running") && (
              <p className="hint" style={{ marginBottom: 0 }}>生成中です。完了するとここに下書きが表示されます（AI処理状況でも確認できます）。</p>
            )}
            {generation?.status === "failed" && (
              <p className="form-error" role="alert" style={{ marginBottom: 0 }}>生成に失敗しました{generation.error ? `：${generation.error}` : ""}。LLM の稼働状況をご確認ください。</p>
            )}
            {generation?.status === "succeeded" && generation.result_text && (
              <div className="gen-iso__result">
                <div className="gen-iso__head">
                  <span className="dialog-label" style={{ margin: 0 }}>生成された下書き（たたき台・要確認）</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard.writeText(generation.result_text ?? ""); snack({ type: "success", title: "コピーしました" }); }}>📋 コピー</button>
                </div>
                <pre className="gen-iso__text">{generation.result_text}</pre>
              </div>
            )}
          </div>
        )}

        <Field className="dialog-section is-quiet" id="sd-title" label="タイトル" required error={titleErr}>
          <input className="input" id="sd-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例）2027-2029 中期経営計画" />
        </Field>
        <Field className="dialog-section is-quiet" id="sd-kind" label="種別">
          <select className="select" id="sd-kind" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
            {KIND_OPTS.map(({ v, l }) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {/* 対象期間の開始/終了は同じ行に並べる（ユーザー指摘 2026-09-29）。 */}
        <div className="form-grid-2">
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

        {/* この資料の主要語＝入力から自動抽出して表示（ボタン不要・入力に追従）。保存時に entity_tokens〔janome〕へ。 */}
        <div className="field dialog-section is-quiet">
          <div className="wc-preview">
            <div className="dialog-label">☁️ この資料の主要語（ワードクラウド）</div>
            {cloud === null ? (
              <span className="hint">入力内容から主要語を自動抽出して表示します（整合率の関連度に効きます）。</span>
            ) : cloud.length ? (
              <div className="wc-mini">
                {cloud.map(([w, c]) => {
                  const max = Math.max(...cloud.map((x) => x[1]), 1);
                  return <span key={w} className="wc-word" style={{ fontSize: `${(0.85 + (c / max) * 0.9).toFixed(2)}rem` }} title={`${w}（${c}）`}>{w}</span>;
                })}
              </div>
            ) : (
              <span className="hint">入力が空です。意図・方針・戦略などを入力してから抽出してください。</span>
            )}
          </div>
        </div>

        {/* 紐づくクエスト（登録＝ステージ／編集＝API即時・R.1b）。他項目と同じ .field dialog-section で間隔/見出しを統一。 */}
        <StrategyQuestLinks docId={docId} value={questLinks} onChange={setQuestLinks} />
      </div>
      <div className="modal__footer">
        {/* フッター順＝閉じる（左・.dialog-close-left）→副→主要（右）＝デザイン標準§ダイアログ内コンテンツ（2026-09-18）。 */}
        <button className="btn btn-outline dialog-close-left" type="button" onClick={onCancel}>キャンセル</button>
        <FormFooterError show={Boolean(titleErr || periodErr || formError)} />
        <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>
          {saving ? "保存中…" : editing ? "保存する" : "登録する"}
        </button>
      </div>
    </>
  );
}
