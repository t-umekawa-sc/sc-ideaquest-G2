"use client";

// SC-51 情報 登録・編集フォーム。正＝doc/画面設計/mocks/SC-50_情報インプット.html（DoD＝モック一致）。
// モーダル（RouteModal）／フルページ双方から使う（body/footer を出す）。データ源は api.ts（当面 fixtures）。
import { useCallback, useEffect, useRef, useState } from "react";

import { Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { addAttachmentsApi, addLinkApi, createInfoItemApi, fetchInfoCapabilities, fetchInfoDetail, uploadInfoImageApi } from "../api";
import {
  BUSINESS_LABEL, CATEGORY_LABEL, CLASSIFICATION_LABEL, IMPACT_CLASS_LABEL, IMPACT_LABEL, LINK_KIND_LABEL,
  LINK_TARGET_LABEL, PRIORITY_LABEL, SCOPE_LABEL, SOURCE_LABEL, TIMING_LABEL, TRIAGE_LABEL,
} from "../labels";
import type { InfoInput } from "../api";
import type { InfoDetail, InfoLinkCandidate, InfoLinkKind, InfoLinkTarget } from "../types";
import { cloudTokens, demoSummary, plainText } from "../wordcloud";
import { TargetPicker } from "./TargetPicker";
import "../info-input.css";

// 登録時にステージするリンク（保存後に /info-links へ POST）。対象は共通 TargetPicker で選ぶ。
interface StagedLink { target_type: InfoLinkTarget; target_id: string; target_title: string; kind: InfoLinkKind; }

const OPT = (m: Record<string, string>) => Object.entries(m).map(([v, l]) => ({ v, l }));
const iconFor = (name: string) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (ext === "pdf") return "📕";
  if (["doc", "docx"].includes(ext)) return "📄";
  return "📎";
};
const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

export function InfoFormPanel({ parentId, onCancel, onDone }: {
  parentId?: string; onCancel: () => void; onDone: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  // 続報の親は実 API から取得（プレビュー用・fixtures 不使用）。属性は create で保存されない（curator の PATCH 管轄）ため
  // 続報でも親属性は事前投入しない＝空から。親の関連リンクは backend が登録時に自動複製（§12-1）。編集は詳細のインライン編集に一本化。
  const [parent, setParent] = useState<InfoDetail | undefined>(undefined);
  useEffect(() => {
    if (!parentId) { setParent(undefined); return; }
    const ac = new AbortController();
    fetchInfoDetail(parentId, ac.signal).then((d) => { if (d) setParent(d); }).catch(() => {});
    return () => ac.abort();
  }, [parentId]);

  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("");
  const [classification, setClassification] = useState("");
  const [scope, setScope] = useState("");
  const [business, setBusiness] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [impact, setImpact] = useState("");
  const [impactClass, setImpactClass] = useState("");
  const [timing, setTiming] = useState("");
  const [triagedOn, setTriagedOn] = useState("");
  const [triage, setTriage] = useState("");
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  // 属性（キュレーション）は curator のみ登録時に付与できる（§85）＝非curator には属性セクションを出さない。
  const [canCurate, setCanCurate] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    void fetchInfoCapabilities(ac.signal).then((c) => setCanCurate(c.can_curate)).catch(() => {});
    return () => ac.abort();
  }, []);
  const [links, setLinks] = useState<StagedLink[]>([]);
  const [files, setFiles] = useState<File[]>([]); // 参考資料＝登録成功後に POST /info-items/{id}/attachments へ送る
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<InfoLinkCandidate[]>([]); // ピッカーで選びストックした候補（種別を選んで追加）
  const [linkKind, setLinkKind] = useState<InfoLinkKind>("related");
  const [cloud, setCloud] = useState<[string, number][] | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [urlErr, setUrlErr] = useState<string | null>(null);

  const exec = useCallback((cmd: string, arg?: string) => {
    bodyRef.current?.focus();
    document.execCommand(cmd, false, arg);
  }, []);

  // 貼付画像の再ホスト（§12-4）＝blob を POST /info-items/images へ送り、返った自社ホスト URL で img を挿入する。
  // 外部 img src は持ち込まない（トラッキング/referer 漏れ防止）。
  const insertImageFiles = useCallback(async (fl: File[]) => {
    const imgs = fl.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setImgErr(null); setImgBusy(true);
    try {
      for (const f of imgs) {
        const url = await uploadInfoImageApi(f);
        bodyRef.current?.focus();
        document.execCommand("insertHTML", false, `<img src="${url}" alt="貼付画像">`);
      }
    } catch (e) {
      setImgErr(e instanceof ApiError ? "画像の再ホストに失敗しました（形式・サイズをご確認ください）。" : "画像のアップロードに失敗しました。");
    } finally {
      setImgBusy(false);
    }
  }, []);

  // paste ハンドラ＝クリップボードに画像 blob があれば横取りして再ホスト（スクショ/コピー画像）。
  // 画像が無ければ既定の貼付（リッチ HTML/テキスト＝保存時に nh3 サニタイズ）に委ねる。
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length) { e.preventDefault(); void insertImageFiles(files); }
  }, [insertImageFiles]);

  const runCloud = useCallback(() => {
    setCloudBusy(true);
    setTimeout(() => {
      const text = `${title} ${plainText(bodyRef.current?.innerHTML ?? "")}`.trim();
      setCloud(text ? cloudTokens(text) : []);
      setCloudBusy(false);
    }, 700);
  }, [title]);
  const runSummary = useCallback(() => {
    setSummaryBusy(true);
    setTimeout(() => {
      const text = plainText(bodyRef.current?.innerHTML ?? "");
      setSummary(text ? demoSummary(text) : "");
      setSummaryBusy(false);
    }, 700);
  }, []);

  const toggleCategory = (c: string) => setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  // 対象ピッカーで選んだ対象（複数可）を呼び元にストック（種別は後で選ぶ・モック 10d 準拠）。既存/ストックと重複は除外。
  const addPicked = (picked: InfoLinkCandidate[]) => {
    setPickerOpen(false);
    setPending((ps) => {
      const seen = new Set([...ps, ...links].map((l) => `${l.target_type}:${l.target_id}`));
      return [...ps, ...picked.filter((c) => !seen.has(`${c.target_type}:${c.target_id}`))];
    });
  };
  // ストックした候補を、選択中の種別でステージ（保存後に /info-links へ POST）→ ストック解消。
  const commitStaged = () => {
    if (!pending.length) return;
    setLinks((ls) => [...ls, ...pending.map((c) => ({ target_type: c.target_type, target_id: c.target_id, target_title: c.title, kind: linkKind }))]);
    setPending([]);
  };
  const removePending = (c: InfoLinkCandidate) =>
    setPending((ps) => ps.filter((x) => !(x.target_type === c.target_type && x.target_id === c.target_id)));
  const setLinkKindAt = (i: number, kind: InfoLinkKind) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, kind } : l)));
  const removeLink = (i: number) => setLinks((ls) => ls.filter((_, j) => j !== i));

  const addFiles = (fl: FileList | null) => { if (fl) setFiles((f) => [...f, ...Array.from(fl)]); };

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setTitleErr(null); setUrlErr(null);
    const t = title.trim();
    if (!t) { setTitleErr("タイトルを入力してください"); return; }
    const url = sourceUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) { setUrlErr("http/https の URL を入力してください"); return; }
    const bodyHtml = bodyRef.current?.innerHTML ?? "";
    const input: InfoInput = {
      title: t, body_html: bodyHtml, summary: summary ?? demoSummary(plainText(bodyHtml)), source_url: url,
      parent_info_id: parentId ?? null,
      priority: priority || null, source: source || null, classification: classification || null, scope: scope || null,
      target_business: business || null, categories, impact_level: impact || null, impact_class: impactClass || null,
      impact_timing: timing || null, triaged_on: triagedOn || null, triage: triage || null, triage_reason: reason || null,
      due_date: dueDate || null,
    };
    // 新規/続報＝実 API（POST /info-items）＝内容（title/body_html/source_url/parent）。編集は詳細のインライン編集に一本化。
    setSaving(true);
    try {
      const created = await createInfoItemApi(input);
      // 参考資料（info_attachments・§5.33）＝作成後に追加（本人が作成者＝内容群を編集可）。
      if (files.length) {
        try { await addAttachmentsApi(created.id, files); }
        catch { setTitleErr("情報は登録しましたが、参考資料の一部を添付できませんでした。詳細から再添付してください。"); }
      }
      // 関連リンク＝作成後に /info-links へ POST（create は links を持たない＝id 先行が必要）。
      if (links.length) {
        try { for (const l of links) await addLinkApi(created.id, l.target_type, l.target_id, l.kind); }
        catch { setTitleErr("情報は登録しましたが、関連リンクの一部を追加できませんでした。詳細から再設定してください。"); }
      }
      onDone();
    } catch (e) {
      if (e instanceof ApiError) {
        const errs = (e.body as { errors?: { field?: string }[] } | null)?.errors ?? [];
        if (errs.some((x) => x.field === "source_url")) setUrlErr("http/https の URL を入力してください");
        else if (errs.some((x) => x.field === "title")) setTitleErr("タイトルを入力してください");
        else setTitleErr("登録に失敗しました。時間をおいて再度お試しください。");
      } else {
        setTitleErr("登録に失敗しました。時間をおいて再度お試しください。");
      }
      setSaving(false);
    }
  };

  const curated = Boolean(priority || impactClass || triage || categories.length);

  return (
    // Fragment で modal__body / modal__footer を panel 直下の flex 子にする（余分な div を挟むと
    // body の flex:1/min-height:0 が効かず本文がスクロールしない）。詳細ビュー・クエスト作成と同方式。
    <>
      <div className="modal__body info-dlg">
        {parent ? (
          <details className="disclosure disclosure--ref" open style={{ marginBottom: "var(--space-3)" }}>
            <summary><span>🧵 続報元の情報を表示：<strong>{parent.title}</strong></span></summary>
            <div className="disclosure__body">
              <div className="rt-view" dangerouslySetInnerHTML={{ __html: parent.body_html ?? "" }} />
              <div style={{ marginTop: 6 }}>
                {parent.source_url ? (
                  <><a href={parent.source_url} target="_blank" rel="noopener noreferrer">🔗 出典を開く</a> <span style={{ color: "var(--color-text-muted)", wordBreak: "break-all" }}>（{parent.source_url}）</span></>
                ) : <span className="muted">出典URLなし</span>}
              </div>
              <div className="hint" style={{ marginTop: 8 }}>この情報の<strong>続報</strong>として登録します。親の<strong>未棄却の関連リンク</strong>は登録時に <code>origin=auto</code> で自動的に引き継がれます（登録後に詳細から編集可）。</div>
            </div>
          </details>
        ) : null}

        <Field id="im-title" label="タイトル" required error={titleErr}>
          <input className="input" id="im-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 生成AIの業務利用が急拡大（○○社レポート）" />
        </Field>

        <Field id="im-body" label="内容・説明（WEBページを書式・画像込みで貼付できます）">
          <div className="rt">
            <div className="rt__bar" role="toolbar" aria-label="書式">
              <button type="button" onClick={() => exec("bold")} title="太字"><b>B</b></button>
              <button type="button" onClick={() => exec("italic")} title="斜体"><i>I</i></button>
              <button type="button" onClick={() => exec("insertUnorderedList")}>• リスト</button>
              <button type="button" onClick={() => exec("formatBlock", "h3")}>見出し</button>
              <button type="button" onClick={() => { const u = prompt("リンク先URL（http/https）"); if (u) exec("createLink", u); }}>🔗 リンク</button>
              <button type="button" onClick={() => imgInputRef.current?.click()} disabled={imgBusy} title="画像を選んで自社ストレージへ再ホスト">🖼️ 画像{imgBusy ? "（再ホスト中…）" : ""}</button>
            </div>
            <input ref={imgInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void insertImageFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            <div className="rt__area" id="im-body" ref={bodyRef} contentEditable suppressContentEditableWarning onPaste={onPaste} data-placeholder="ここに記事本文を貼り付け（Ctrl+V）…" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", marginTop: 6, flexWrap: "wrap" }}>
            <div className="hint">{imgErr ? <span style={{ color: "var(--color-danger)" }}>{imgErr}</span> : "画像は貼付時に自社ストレージへ再ホストします（外部参照は持ち込みません）。"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn btn-outline btn-sm" type="button" onClick={runCloud}>🔑 キーワードを抽出</button>
              <button className="btn btn-outline btn-sm" type="button" onClick={runSummary}>📝 要約を生成</button>
            </div>
          </div>
          <div className={`wc-preview${cloudBusy ? " iq-block" : ""}`}>
            <div className="dialog-label">☁️ この情報の主要語（ワードクラウド）</div>
            {cloud === null ? <span className="hint">「🔑 キーワードを抽出」を押すと、本文から主要語を抽出して表示します。</span>
              : cloud.length ? <div className="wc-mini">{cloud.map(([w, c]) => { const max = Math.max(...cloud.map((x) => x[1]), 1); return <span key={w} className="wc-word" style={{ fontSize: `${(0.85 + (c / max) * 0.9).toFixed(2)}rem` }} title={`${w}（${c}）`}>{w}</span>; })}</div>
                : <span className="hint">本文が空です。記事を貼り付けてから抽出してください。</span>}
            {cloudBusy ? <div className="iq-block__overlay"><span className="iq-loading-badge">抽出中 <span className="dots" /></span></div> : null}
          </div>
          <div className={`wc-preview${summaryBusy ? " iq-block" : ""}`}>
            <div className="dialog-label">📝 要約（選別用・自動生成）</div>
            {summary === null ? <span className="hint">「📝 要約を生成」を押すと、本文から要約を作成します（保存時にも自動生成されます）。</span>
              : summary ? <span>{summary}</span> : <span className="hint">本文が空です。記事を貼り付けてから生成してください。</span>}
            {summaryBusy ? <div className="iq-block__overlay"><span className="iq-loading-badge">要約生成中 <span className="dots" /></span></div> : null}
          </div>
        </Field>

        <Field id="im-url" label="出典URL" hint="出典を明記すると引用性・信頼性の重み付けに使えます。" error={urlErr}>
          <input className="input" id="im-url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…（http/https のみ）" />
        </Field>

        <div className="field">
          <div className="dialog-label">参考資料（任意・複数可）</div>
          <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <div className="dropzone" role="button" tabIndex={0} onClick={() => fileInputRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("is-over"); }} onDragLeave={(e) => e.currentTarget.classList.remove("is-over")}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("is-over"); addFiles(e.dataTransfer.files); }}>📎 クリックまたはドラッグ＆ドロップで添付</div>
          <div className="attach-list">
            {files.map((f, i) => (
              <div key={i} className="attach">
                <span className="attach__icon">{iconFor(f.name)}</span>
                <div className="attach__meta"><div className="attach__name">{f.name}</div><div className="attach__size">{fmtSize(f.size)}</div></div>
                <button type="button" className="attach__remove" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <div className="hint">本文とは別に、PDF・画像・資料ファイルを添付できます（出典の裏付け・引用元の保全）。</div>
        </div>

        <div className="field">
          <div className="dialog-label">関連リンク（アイデア／クエスト）</div>
          {links.length ? (
            <ul className="link-list">
              {links.map((l, i) => (
                <li key={`${l.target_type}:${l.target_id}`} className={`link-item${l.kind === "refuting" ? " is-refuting" : ""}`}>
                  <span className="badge badge-muted lk-type">{LINK_TARGET_LABEL[l.target_type]}</span>
                  <span className="link-item__title">{l.target_title}</span>
                  <span className="badge badge-muted">手動</span>
                  <select className="select link-kind" value={l.kind} aria-label="種別" onChange={(e) => setLinkKindAt(i, e.target.value as InfoLinkKind)}>
                    {Object.entries(LINK_KIND_LABEL).map(([v, lab]) => <option key={v} value={v}>{lab[0]}</option>)}
                  </select>
                  <button type="button" className="link-item__rm" aria-label="削除" title="削除" onClick={() => removeLink(i)}>✕</button>
                </li>
              ))}
            </ul>
          ) : <div className="hint">関連リンクはまだありません。下から追加できます（保存すると類似度で<strong>自動リンク</strong>も生成されます）。</div>}
          <div className="link-add">
            <div className="linkpick">
              <button className="btn btn-outline" type="button" onClick={() => setPickerOpen(true)}>🔍 対象を選ぶ…</button>
              {pending.length ? (
                <div className="linkpick__chips">
                  {pending.map((c) => (
                    <span key={`${c.target_type}:${c.target_id}`} className="linkpick__chip">
                      <span className="badge badge-muted lk-type">{LINK_TARGET_LABEL[c.target_type]}</span>
                      <span className="linkpick__chip-title">{c.title}</span>
                      <button type="button" className="linkpick__chip-rm" aria-label="解除" title="解除" onClick={() => removePending(c)}>✕</button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="link-add__bottom">
              <label className="link-add__field" style={{ flex: 1 }}><span className="link-add__lbl">種別（選んだ対象すべてに適用）</span>
                <select className="select" value={linkKind} onChange={(e) => setLinkKind(e.target.value as InfoLinkKind)}>
                  {Object.entries(LINK_KIND_LABEL).map(([v, lab]) => <option key={v} value={v}>{lab[0]}</option>)}
                </select>
              </label>
              <button className="btn btn-outline" type="button" disabled={!pending.length} onClick={commitStaged}>＋ 追加</button>
            </div>
          </div>
          <div className="hint">種別を<strong>「反証」</strong>にすると、対象の作成者＋評価者へ<strong>通知＋要再評価</strong>が発火します（根底を揺さぶる）。</div>
          <TargetPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={addPicked} />
        </div>

        {canCurate ? (
        <details className="disclosure field">
          <summary>🧭 属性を付与（情報判定権限）＝分類・環境スキャン・判定{curated ? "" : ""}</summary>
          <div className="disclosure__body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <Field id="im-priority" label="優先度"><select className="select" id="im-priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">—</option>{OPT(PRIORITY_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-source" label="情報ソース"><select className="select" id="im-source" value={source} onChange={(e) => setSource(e.target.value)}><option value="">—</option>{OPT(SOURCE_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-class" label="情報分類"><select className="select" id="im-class" value={classification} onChange={(e) => setClassification(e.target.value)}><option value="">—</option>{OPT(CLASSIFICATION_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-scope" label="大分類"><select className="select" id="im-scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">—</option>{OPT(SCOPE_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-biz" label="対象事業"><select className="select" id="im-biz" value={business} onChange={(e) => setBusiness(e.target.value)}><option value="">—</option>{OPT(BUSINESS_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <div className="field">
              <div className="dialog-label">情報カテゴリ（複数可）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                  <label key={v} className="checkbox" style={{ fontSize: "var(--text-xs)" }}><input type="checkbox" checked={categories.includes(v)} onChange={() => toggleCategory(v)} /><span>{l}</span></label>
                ))}
              </div>
            </div>
            <Field id="im-impact" label="影響度"><select className="select" id="im-impact" value={impact} onChange={(e) => setImpact(e.target.value)}><option value="">—</option>{OPT(IMPACT_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-impactclass" label="影響分類"><select className="select" id="im-impactclass" value={impactClass} onChange={(e) => setImpactClass(e.target.value)}><option value="">—</option>{OPT(Object.fromEntries(Object.entries(IMPACT_CLASS_LABEL).map(([v, l]) => [v, l[0]]))).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-timing" label="影響発生時期"><select className="select" id="im-timing" value={timing} onChange={(e) => setTiming(e.target.value)}><option value="">—</option>{OPT(TIMING_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-due" label="期限日（対応/有効期限）"><input className="input" id="im-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            <Field id="im-triageon" label="情報判定日"><input className="input" id="im-triageon" type="date" value={triagedOn} onChange={(e) => setTriagedOn(e.target.value)} /></Field>
            <Field id="im-triage" label="情報判定"><select className="select" id="im-triage" value={triage} onChange={(e) => setTriage(e.target.value)}><option value="">—</option>{OPT(TRIAGE_LABEL).map(({ v, l }) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="im-reason" label="判定理由"><textarea className="input" id="im-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="この判定に至った理由（任意・改行可）" /></Field>
          </div>
        </details>
        ) : null}
      </div>

      <div className="modal__footer">
        <button className="btn btn-outline" type="button" onClick={onCancel} disabled={saving}>キャンセル</button>
        <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>{saving ? "登録中…" : parentId ? "続報を登録する" : "登録する"}</button>
      </div>
    </>
  );
}
