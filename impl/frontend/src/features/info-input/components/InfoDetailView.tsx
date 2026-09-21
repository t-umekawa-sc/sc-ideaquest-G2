"use client";

// SC-52 情報の詳細（Phase B＝backend GET /info-items/{id} に結線・読み取り）。
// 正＝doc/画面設計/mocks/SC-50_情報インプット.html（DoD＝モック一致）。モーダル/フルページ双方から使う。
// 内容(作成者)＋属性(curator)＋関連リンク(全員)のインライン編集を実 API へ結線済（Slice 5.2/5.2b/5.3b・can で出し分け）。続報/アーカイブは後続。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useConfirm, useSnackbar } from "@/components/ui";
import {
  addAttachmentsApi, addLinkApi, archiveInfoItemApi, changeLinkKindApi, deleteAttachmentApi, fetchInfoDetail,
  rejectLinkApi, unarchiveInfoItemApi, unrejectLinkApi, updateInfoItemApi,
} from "../api";
import {
  BUSINESS_LABEL, CATEGORY_LABEL, CLASSIFICATION_LABEL, IMPACT_CLASS_LABEL, IMPACT_LABEL, LINK_KIND_LABEL,
  LINK_TARGET_LABEL, PRIORITY_LABEL, SCOPE_LABEL, SOURCE_LABEL, STATUS_LABEL, TIMING_LABEL, TRIAGE_LABEL,
} from "../labels";
import type { InfoDetail, InfoLinkCandidate, InfoLinkKind, InfoThreadItem } from "../types";
import { cloudTokens, demoSummary, plainText } from "../wordcloud";
import { TargetPicker } from "./TargetPicker";
import "../info-input.css";

const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const iconForMime = (mime: string) => (mime.startsWith("image/") ? "🖼️" : mime === "application/pdf" ? "📕"
  : mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv" ? "📊"
  : mime.includes("word") ? "📄" : "📎");

function Attr({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value ? value : <span className="muted">—</span>}</dd>
    </>
  );
}

function AttrSelect({ label, k, map, attrs, onSet }: {
  label: string; k: string; map: Record<string, string>; attrs: Record<string, string>; onSet: (k: string, v: string) => void;
}) {
  return (
    <div>
      <label className="dialog-label" htmlFor={`dm-${k}`}>{label}</label>
      <select className="select" id={`dm-${k}`} value={attrs[k] ?? ""} onChange={(e) => onSet(k, e.target.value)}>
        <option value="">—</option>
        {Object.entries(map).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export function InfoDetailView({ infoId, onClose }: { infoId: string; onClose: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [item, setItem] = useState<InfoDetail | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  // 内容インライン編集（作成者・can.edit_content）。属性=curator インラインは後続（5.2b）。
  const bodyRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [contentDirty, setContentDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 主要語（ワードクラウド）／要約のインラインプレビュー＝登録ダイアログ（InfoFormPanel）と同位置・同 UI。
  // クライアント派生（../wordcloud）。初期値はサーバー派生済みの tokens_top/summary で埋め、ボタンで本文から再抽出/生成できる。
  const [cloud, setCloud] = useState<[string, number][] | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [summaryPrev, setSummaryPrev] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  // キュレーション（属性）インライン編集（curator・can.curate）。
  const EMPTY_ATTRS = { priority: "", source: "", classification: "", scope: "", target_business: "", impact_level: "", impact_class: "", impact_timing: "", triaged_on: "", triage: "", triage_reason: "", due_date: "" };
  const [attrs, setAttrs] = useState<Record<string, string>>(EMPTY_ATTRS);
  const [cats, setCats] = useState<string[]>([]);
  const [curationDirty, setCurationDirty] = useState(false);
  const setAttr = (k: string, v: string) => { setAttrs((a) => ({ ...a, [k]: v })); setCurationDirty(true); };
  const toggleCat = (c: string) => { setCats((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c])); setCurationDirty(true); };
  // 関連リンクのインライン編集（全員・即時コミット→詳細再取得）。対象選択は共通 TargetPicker。
  const [linkEditing, setLinkEditing] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<InfoLinkCandidate[]>([]); // ピッカーで選び呼び元にストックした候補（種別を選んで追加）
  const [addKind, setAddKind] = useState<InfoLinkKind>("related");
  // 参考資料（内容群・作成者のみ・§5.33）＝追加/削除は即時コミット→詳細再取得。
  const attInputRef = useRef<HTMLInputElement>(null);
  const [attBusy, setAttBusy] = useState(false);
  const [attErr, setAttErr] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setState("loading");
    fetchInfoDetail(infoId, ac.signal)
      .then((d) => { if (d) { setItem(d); setState("ok"); } else { setState("notfound"); } })
      .catch(() => setState("notfound"));
    return () => ac.abort();
  }, [infoId]);

  // 取得/保存のたびに編集初期値を同期（内容編集可のとき本文 contenteditable も初期化）。
  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setSourceUrl(item.source_url ?? "");
    setContentDirty(false);
    setAttrs({
      priority: item.priority ?? "", source: item.source ?? "", classification: item.classification ?? "",
      scope: item.scope ?? "", target_business: item.target_business ?? "", impact_level: item.impact_level ?? "",
      impact_class: item.impact_class ?? "", impact_timing: item.impact_timing ?? "", triaged_on: item.triaged_on ?? "",
      triage: item.triage ?? "", triage_reason: item.triage_reason ?? "", due_date: item.due_date ?? "",
    });
    setCats(item.categories);
    setCurationDirty(false);
    // 主要語/要約プレビューの初期値＝サーバー派生済みの値（tokens_top / summary）。
    setCloud(item.tokens_top.length ? item.tokens_top.map((t) => [t.token, t.count] as [string, number]) : null);
    setSummaryPrev(item.summary ?? null);
    if (item.can.edit_content && bodyRef.current) bodyRef.current.innerHTML = item.body_html ?? "";
  }, [item]);

  // 主要語を本文から再抽出（登録ダイアログと同じ＝クライアント派生・保存時はサーバーが再派生する）。
  const runCloud = () => {
    setCloudBusy(true);
    const text = `${title} ${plainText(bodyRef.current?.innerHTML ?? "")}`.trim();
    setCloud(text ? cloudTokens(text) : []);
    setCloudBusy(false);
  };
  // 要約を本文から生成（同上・クライアント派生プレビュー）。
  const runSummary = () => {
    setSummaryBusy(true);
    const text = plainText(bodyRef.current?.innerHTML ?? "");
    setSummaryPrev(text ? demoSummary(text) : "");
    setSummaryBusy(false);
  };

  const save = async () => {
    if (!item) return;
    const patch: Record<string, unknown> = {};
    if (contentDirty) {
      const t = title.trim();
      if (!t) return;
      patch.title = t; patch.body_html = bodyRef.current?.innerHTML ?? ""; patch.source_url = sourceUrl.trim() || null;
    }
    if (curationDirty) {
      for (const k of Object.keys(EMPTY_ATTRS)) patch[k] = attrs[k] || null;
      patch.categories = cats;
    }
    // 無変更で保存＝グレースフルに処理（API を呼ばず版を増やさない・IdeaForm と同じ体裁／style-guide §10）。
    if (!contentDirty && !curationDirty) {
      snack({ type: "info", title: "変更はありません", msg: "内容・属性とも変更がなかったため、保存しませんでした。" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updateInfoItemApi(item.id, patch);
      setItem(updated); // 再取得＝再派生（要約/トークン）・版・raw→curated を反映
    } catch { /* 失敗時は編集内容を保持（再試行可） */ }
    setSaving(false);
  };

  // リンク操作＝即時コミット→詳細を再取得して反映。
  const linkOp = async (fn: () => Promise<unknown>) => {
    setLinkBusy(true);
    try { await fn(); const d = await fetchInfoDetail(infoId); if (d) setItem(d); } catch { /* 再試行可 */ }
    setLinkBusy(false);
  };

  // 反証（refuting）化は確認ダイアログ（SC-50 §84＝根底を揺さぶる＝作成者/評価者/クエスト管理者へ通知が飛ぶ）。
  const REFUTE_CONFIRM = { title: "反証として設定", msg: "反証は「根底を揺さぶる」シグナルです。対象の作成者・評価者・クエスト管理者へ通知が飛びます。反証として設定しますか？", variant: "danger" as const };
  const changeKind = async (linkId: string, prevKind: InfoLinkKind, next: InfoLinkKind) => {
    if (next === prevKind) return;
    if (next === "refuting" && !(await confirm(REFUTE_CONFIRM))) {
      const d = await fetchInfoDetail(infoId); if (d) setItem(d); // 取消＝select を現状へ戻す
      return;
    }
    await linkOp(() => changeLinkKindApi(linkId, next));
  };
  // 対象ピッカーで選んだ対象（複数可）を呼び元にストック（種別は後で選ぶ・モック 10d 準拠）。重複除外。
  const addPicked = (picked: InfoLinkCandidate[]) => {
    setPickerOpen(false);
    setPending((ps) => {
      const seen = new Set(ps.map((c) => `${c.target_type}:${c.target_id}`));
      return [...ps, ...picked.filter((c) => !seen.has(`${c.target_type}:${c.target_id}`))];
    });
  };
  // ストックした候補を、選択中の種別でまとめて追加（反証はまとめて1回確認）→ 詳細再取得・ストック解消。
  const commitLinks = async () => {
    if (!pending.length) return;
    if (addKind === "refuting" && !(await confirm(REFUTE_CONFIRM))) return;
    await linkOp(async () => {
      for (const c of pending) await addLinkApi(infoId, c.target_type, c.target_id, addKind);
    });
    setPending([]);
  };

  // 参考資料の追加/削除（作成者のみ・即時コミット→詳細再取得）。
  const addAtts = async (fl: FileList | null) => {
    if (!item || !fl || !fl.length) return;
    setAttErr(null); setAttBusy(true);
    try { await addAttachmentsApi(item.id, Array.from(fl)); const d = await fetchInfoDetail(infoId); if (d) setItem(d); }
    catch { setAttErr("参考資料を追加できませんでした（形式・サイズ・件数〔1情報10件まで〕をご確認ください）。"); }
    setAttBusy(false);
  };
  const delAtt = async (id: string) => {
    if (!item) return;
    setAttBusy(true);
    try { await deleteAttachmentApi(item.id, id); const d = await fetchInfoDetail(infoId); if (d) setItem(d); } catch { /* 再試行可 */ }
    setAttBusy(false);
  };

  // アーカイブ／解除（curator・N.2）＝確認→即時コミット。アーカイブは一覧から消えるので閉じて一覧へ戻す。
  const [archiveBusy, setArchiveBusy] = useState(false);
  const doArchive = async () => {
    if (!item) return;
    const ok = await confirm({ title: "アーカイブ", msg: `「${item.title}」をアーカイブしますか？（論理削除・監査保持）` });
    if (!ok) return;
    setArchiveBusy(true);
    try { await archiveInfoItemApi(item.id); onClose(); } catch { setArchiveBusy(false); }
  };
  const doUnarchive = async () => {
    if (!item) return;
    setArchiveBusy(true);
    try { await unarchiveInfoItemApi(item.id); const d = await fetchInfoDetail(infoId); if (d) setItem(d); } catch { /* 再試行可 */ }
    setArchiveBusy(false);
  };

  const go = (path: string) => { onClose(); setTimeout(() => router.push(path), 0); };
  // スレッド内の移動（元情報/続報）は現在のモーダルURLを replace で差し替え＝履歴を積まない。
  // これで「閉じる」は常に一覧へ戻る（詳細を渡り歩いても呼び元の詳細に戻らない・ユーザー要望）。
  const swap = (path: string) => router.replace(path);

  if (state === "loading") return <div className="modal__body"><p className="muted">読み込み中…</p></div>;
  if (state === "notfound" || !item) return <div className="modal__body"><p className="muted">情報が見つかりません。</p></div>;
  const r = item;
  const activeLinks = r.links.filter((l) => !l.rejected);
  const cloudMax = Math.max(...r.tokens_top.map((t) => t.count), 1);
  // 項目区切り＝デザイン標準 §4.1: 参照系（このユーザーが編集できない項目）は仕切り線／入力・操作系は余白。
  const refCls = "field dialog-section";                       // 常に参照＝要約/主要語/属性(read)/続報スレッド
  const contentCls = r.can.edit_content ? "field" : refCls;    // 作成者が編集する項目＝タイトル/内容/参考資料
  // 続報スレッド＝根→続報1→続報2… の時系列（SC-50 §80）。根＝続報を開いていれば thread.parent、根を開いていれば自身。
  // 開いているアイテムは「表示中」で強調（リンクにしない）。thread.follow_ups は根の子（backend が root 基準で返す）。
  const threadRoot: InfoThreadItem = r.thread.parent ?? {
    id: r.id, title: r.title, created_by: r.created_by.display_name, created_at: r.created_at,
  };
  const threadItems: InfoThreadItem[] = [threadRoot, ...r.thread.follow_ups];
  const hasThread = r.thread.follow_ups.length > 0 || r.thread.parent != null;

  return (
    <>
      <div className="modal__body">
        {/* 元情報（続報元）＝下部の「続報スレッド」タイムラインに根として統合表示（SC-50 §80）＝ここには別掲しない。 */}
        <div className={contentCls}>
          <div className="dialog-label">タイトル</div>
          {r.can.edit_content ? (
            <input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setContentDirty(true); }} style={{ marginBottom: 6 }} />
          ) : (
            <h3 style={{ margin: "0 0 6px" }}>{r.title}</h3>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className={`badge ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</span>
            {r.impact_class ? <span className={`badge ${IMPACT_CLASS_LABEL[r.impact_class][1]}`}>{IMPACT_CLASS_LABEL[r.impact_class][0]}</span> : null}
            {r.priority ? <span className="badge badge-muted">優先度 {PRIORITY_LABEL[r.priority]}</span> : null}
            {r.categories.map((c) => <span key={c} className="badge badge-muted">{CATEGORY_LABEL[c] ?? c}</span>)}
          </div>
        </div>

        {!r.can.edit_content && r.summary ? (
          <div className={refCls}>
            <div className="summary-box"><div className="summary-box__label">要約（選別用・自動生成）</div>{r.summary}</div>
          </div>
        ) : null}

        <div className={contentCls}>
          <div className="dialog-label">内容・説明</div>
          {r.can.edit_content ? (
            <>
              {/* 内容は作成者のみ編集可（status 非依存）。保存時にサーバーがサニタイズ→再派生（body_text/要約/トークン）＋版記録。 */}
              <div className="rt">
                <div className="rt__area" ref={bodyRef} contentEditable suppressContentEditableWarning
                  onInput={() => setContentDirty(true)} data-placeholder="内容・説明を編集…" />
              </div>
              {/* 抽出/生成ボタン＋主要語/要約プレビュー＝登録ダイアログ（InfoFormPanel）と同位置・同 UI。 */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <button className="btn btn-outline btn-sm" type="button" onClick={runCloud}>🔑 キーワードを抽出</button>
                <button className="btn btn-outline btn-sm" type="button" onClick={runSummary}>📝 要約を生成</button>
              </div>
              <div className={`wc-preview${cloudBusy ? " iq-block" : ""}`}>
                <div className="dialog-label">☁️ この情報の主要語（ワードクラウド）</div>
                {cloud === null ? <span className="hint">「🔑 キーワードを抽出」を押すと、本文から主要語を抽出して表示します。</span>
                  : cloud.length ? <div className="wc-mini">{cloud.map(([w, c]) => { const max = Math.max(...cloud.map((x) => x[1]), 1); return <span key={w} className="wc-word" style={{ fontSize: `${(0.85 + (c / max) * 0.9).toFixed(2)}rem` }} title={`${w}（${c}）`}>{w}</span>; })}</div>
                    : <span className="hint">本文が空です。記事を貼り付けてから抽出してください。</span>}
                {cloudBusy ? <div className="iq-block__overlay"><span className="iq-loading-badge">抽出中 <span className="dots" /></span></div> : null}
              </div>
              <div className={`wc-preview${summaryBusy ? " iq-block" : ""}`} style={{ marginTop: 8 }}>
                <div className="dialog-label">📝 要約（選別用・自動生成）</div>
                {summaryPrev === null ? <span className="hint">「📝 要約を生成」を押すと、本文から要約を作成します（保存時にも自動生成されます）。</span>
                  : summaryPrev ? <span>{summaryPrev}</span> : <span className="hint">本文が空です。記事を貼り付けてから生成してください。</span>}
                {summaryBusy ? <div className="iq-block__overlay"><span className="iq-loading-badge">要約生成中 <span className="dots" /></span></div> : null}
              </div>
              <label className="dialog-label" htmlFor="dm-url" style={{ marginTop: 8 }}>出典URL（http/https）</label>
              <input className="input" id="dm-url" value={sourceUrl} onChange={(e) => { setSourceUrl(e.target.value); setContentDirty(true); }} placeholder="https://…" />
            </>
          ) : (
            <>
              {/* body_html はサーバー側で nh3 サニタイズ済み（§12-4）。 */}
              <div className="rt-view" dangerouslySetInnerHTML={{ __html: r.body_html ?? "" }} />
              {r.source_url ? (
                <div className="hint" style={{ marginTop: 6 }}>
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer">🔗 出典を開く</a>{" "}
                  <span style={{ wordBreak: "break-all" }}>（{r.source_url}）</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {(r.attachments.length || r.can.edit_content) ? (
          <div className={contentCls}>
            <div className="dialog-label">参考資料（出典の裏付け・引用元の保全）</div>
            {r.attachments.length ? (
              <div className="attach-list">
                {r.attachments.map((a) => (
                  <div key={a.id} className="attach">
                    <span className="attach__icon">{iconForMime(a.mime_type)}</span>
                    <div className="attach__meta">
                      <div className="attach__name"><a href={a.url} target="_blank" rel="noopener noreferrer">{a.original_name}</a></div>
                      <div className="attach__size">{fmtSize(a.size_bytes)}</div>
                    </div>
                    {r.can.edit_content ? (
                      <button type="button" className="attach__remove" aria-label="削除" title="削除" disabled={attBusy} onClick={() => delAtt(a.id)}>✕</button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <p className="muted">参考資料はまだありません。</p>}
            {r.can.edit_content ? (
              <>
                <input ref={attInputRef} type="file" multiple hidden onChange={(e) => { void addAtts(e.target.files); e.target.value = ""; }} />
                <div className="dropzone" role="button" tabIndex={0} aria-disabled={attBusy}
                  onClick={() => { if (!attBusy) attInputRef.current?.click(); }}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !attBusy) { e.preventDefault(); attInputRef.current?.click(); } }}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("is-over"); }} onDragLeave={(e) => e.currentTarget.classList.remove("is-over")}
                  onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("is-over"); void addAtts(e.dataTransfer.files); }}>
                  {attBusy ? "アップロード中…" : "📎 クリックまたはドラッグ＆ドロップで参考資料を追加"}
                </div>
                {attErr ? <div className="hint" style={{ color: "var(--color-danger)" }}>{attErr}</div> : null}
              </>
            ) : null}
          </div>
        ) : null}

        {/* 主要語は編集不可（参照）モードだけ下部に表示。作成者（編集）は内容欄の直下にインライン表示（登録ダイアログと同位置）。 */}
        {!r.can.edit_content ? (
          <div className={refCls}>
            <div className="dialog-label">☁️ この情報の主要語（ワードクラウド）</div>
            {r.tokens_top.length ? (
              <div className="wc-mini">
                {r.tokens_top.map((t) => (
                  <span key={t.token} className="wc-word" style={{ fontSize: `${(0.85 + (t.count / cloudMax) * 0.9).toFixed(2)}rem`, opacity: (0.6 + (t.count / cloudMax) * 0.4).toFixed(2) }} title={`${t.token}（${t.count}）`}>{t.token}</span>
                ))}
              </div>
            ) : <p className="muted">主要語がありません。</p>}
          </div>
        ) : null}

        {r.can.curate ? (
          <div className="field">
            <div className="dialog-label">属性（環境スキャン・判定）＝情報判定権限</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <AttrSelect label="優先度" k="priority" map={PRIORITY_LABEL} attrs={attrs} onSet={setAttr} />
              <AttrSelect label="情報ソース" k="source" map={SOURCE_LABEL} attrs={attrs} onSet={setAttr} />
              <AttrSelect label="情報分類" k="classification" map={CLASSIFICATION_LABEL} attrs={attrs} onSet={setAttr} />
              <AttrSelect label="大分類" k="scope" map={SCOPE_LABEL} attrs={attrs} onSet={setAttr} />
              <AttrSelect label="対象事業" k="target_business" map={BUSINESS_LABEL} attrs={attrs} onSet={setAttr} />
              <div>
                <div className="dialog-label">情報カテゴリ（複数可）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                    <label key={v} className="checkbox" style={{ fontSize: "var(--text-xs)" }}><input type="checkbox" checked={cats.includes(v)} onChange={() => toggleCat(v)} /><span>{l}</span></label>
                  ))}
                </div>
              </div>
              <AttrSelect label="影響度" k="impact_level" map={IMPACT_LABEL} attrs={attrs} onSet={setAttr} />
              <AttrSelect label="影響分類" k="impact_class" map={Object.fromEntries(Object.entries(IMPACT_CLASS_LABEL).map(([v, l]) => [v, l[0]]))} attrs={attrs} onSet={setAttr} />
              <AttrSelect label="影響発生時期" k="impact_timing" map={TIMING_LABEL} attrs={attrs} onSet={setAttr} />
              <div><label className="dialog-label" htmlFor="dm-due">期限日（対応/有効期限）</label><input className="input" id="dm-due" type="date" value={attrs.due_date} onChange={(e) => setAttr("due_date", e.target.value)} /></div>
              <div><label className="dialog-label" htmlFor="dm-tron">情報判定日</label><input className="input" id="dm-tron" type="date" value={attrs.triaged_on} onChange={(e) => setAttr("triaged_on", e.target.value)} /></div>
              <AttrSelect label="情報判定" k="triage" map={TRIAGE_LABEL} attrs={attrs} onSet={setAttr} />
              <div><label className="dialog-label" htmlFor="dm-reason">判定理由</label><textarea className="input" id="dm-reason" rows={3} value={attrs.triage_reason} onChange={(e) => setAttr("triage_reason", e.target.value)} /></div>
            </div>
          </div>
        ) : (
          // 非 curator の属性は「参照」＝常に仕切り線（編集モードの作成者でも属性は編集不可＝参照扱い）。
          <div className="field dialog-section">
            <div className="dialog-label">属性（環境スキャン・判定）</div>
            <dl className="attr-grid">
              <Attr label="情報ソース" value={r.source ? SOURCE_LABEL[r.source] : null} />
              <Attr label="情報分類" value={r.classification ? CLASSIFICATION_LABEL[r.classification] : null} />
              <Attr label="大分類" value={r.scope ? SCOPE_LABEL[r.scope] : null} />
              <Attr label="対象事業" value={r.target_business ? BUSINESS_LABEL[r.target_business] : null} />
              <Attr label="影響度" value={r.impact_level ? IMPACT_LABEL[r.impact_level] : null} />
              <Attr label="影響発生時期" value={r.impact_timing ? TIMING_LABEL[r.impact_timing] : null} />
              <Attr label="情報判定" value={r.triage ? TRIAGE_LABEL[r.triage] : null} />
              <Attr label="期限日" value={r.due_date} />
              {r.triage_reason ? <Attr label="判定理由" value={r.triage_reason} /> : null}
            </dl>
            <div className="hint" style={{ marginTop: 6 }}>属性の付与・情報判定は<strong>情報判定権限（info_curator）</strong>の領分です。</div>
          </div>
        )}

        <div className="field">
          <div className="dialog-label">この情報から（機会特定→行動）</div>
          <button className="btn btn-primary" type="button" onClick={() => go(`/info-items/${r.id}/new-quest`)}>＋ この情報からクエストを作成</button>
          <div className="hint" style={{ marginTop: 6 }}>判定の結果、新しく取り組む価値があると判断したら、この情報を機会/課題として<strong>クエストを起票</strong>できます。作成したクエストにはこの情報が<strong>関連リンク（関連）</strong>で自動的に紐づきます。</div>
        </div>

        {/* アーカイブ／解除＝curator のみ（論理削除・監査保持・N.2）。フッターは閉じる/保存に絞るため本文に置く（SC-50 §8）。 */}
        {r.can.curate ? (
          <div className="field">
            <div className="dialog-label">アーカイブ（情報判定権限）</div>
            {r.status === "archived" ? (
              <>
                <button className="btn btn-outline" type="button" onClick={doUnarchive} disabled={archiveBusy || saving}>{archiveBusy ? "処理中…" : "↩ アーカイブを解除する"}</button>
                <div className="hint" style={{ marginTop: 6 }}>解除すると一覧（既定表示）に戻ります（属性があれば判定済み、無ければ未判定へ）。</div>
              </>
            ) : (
              <>
                <button className="btn btn-outline btn-danger" type="button" onClick={doArchive} disabled={archiveBusy || saving}>{archiveBusy ? "処理中…" : "🗄 アーカイブする"}</button>
                <div className="hint" style={{ marginTop: 6 }}>論理削除です（監査のため保持・物理削除はしません）。既定の一覧から外れ、「アーカイブ」タブから解除できます。</div>
              </>
            )}
          </div>
        ) : null}

        <div className="field">
          <div className="dialog-label">関連リンク（成果物との関係・per-link 種別）</div>
          {!linkEditing ? (
            <>
              {activeLinks.length ? (
                <ul className="link-list">
                  {activeLinks.map((l) => (
                    <li key={l.id} className="link-item">
                      <span>{LINK_TARGET_LABEL[l.target_type]}</span>
                      <span className="link-item__title">{l.target_title ?? <span className="muted">（対象未解決）</span>}</span>
                      <span className={`badge ${LINK_KIND_LABEL[l.kind][1]}`}>{LINK_KIND_LABEL[l.kind][0]}</span>
                      <span className="badge badge-muted">{l.origin === "auto" ? "自動" : "手動"}</span>
                      {l.score != null ? <span className="info-thread__meta">一致 {Math.round(l.score * 100)}%</span> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">関連リンクはまだありません。</p>}
              {r.can.add_link ? (
                <div style={{ marginTop: 8 }}><button className="btn btn-outline" type="button" onClick={() => setLinkEditing(true)}>🔗 リンクを編集（追加・種別変更・棄却）</button></div>
              ) : null}
              <div className="hint" style={{ marginTop: 6 }}>情報側のリンク編集は会社内の全員が可能。採否・統制は成果物側の管理者に委ねます。種別「反証」で対象の作成者＋評価者へ通知＋要再評価。</div>
            </>
          ) : (
            <>
              {/* インライン編集＝各操作は即時 API（/info-links）→ 詳細を再取得。マークアップは実装クラスに一致。 */}
              <ul className="link-list">
                {r.links.map((l) => l.rejected ? (
                  <li key={l.id} className="link-item is-rejected">
                    <span>{LINK_TARGET_LABEL[l.target_type]}</span>
                    <span className="link-item__title" style={{ textDecoration: "line-through", color: "var(--color-text-subtle)" }}>{l.target_title ?? "（対象未解決）"}</span>
                    <span className="badge badge-muted">棄却済み・再リンクされません</span>
                    <button type="button" className="btn btn-outline btn-sm" disabled={linkBusy} onClick={() => linkOp(() => unrejectLinkApi(l.id))}>戻す</button>
                  </li>
                ) : (
                  <li key={l.id} className="link-item">
                    <span>{LINK_TARGET_LABEL[l.target_type]}</span>
                    <span className="link-item__title">{l.target_title ?? "（対象未解決）"}</span>
                    <span className="badge badge-muted">{l.origin === "auto" ? "自動" : "手動"}</span>
                    <select className="select link-kind" aria-label="種別" value={l.kind} disabled={linkBusy} onChange={(e) => changeKind(l.id, l.kind, e.target.value as InfoLinkKind)}>
                      {Object.entries(LINK_KIND_LABEL).map(([v, lab]) => <option key={v} value={v}>{lab[0]}</option>)}
                    </select>
                    <button type="button" className="link-item__rm" aria-label="棄却" title="棄却（今後この情報から自動リンクしない・復活しない）" disabled={linkBusy} onClick={() => linkOp(() => rejectLinkApi(l.id))}>✕</button>
                  </li>
                ))}
              </ul>
              <div className="link-add">
                <div className="linkpick">
                  <button className="btn btn-outline" type="button" disabled={linkBusy} onClick={() => setPickerOpen(true)}>🔍 対象を選ぶ…</button>
                  {pending.length ? (
                    <div className="linkpick__chips">
                      {pending.map((c) => (
                        <span key={`${c.target_type}:${c.target_id}`} className="linkpick__chip">
                          <span className="badge badge-muted lk-type">{LINK_TARGET_LABEL[c.target_type]}</span>
                          <span className="linkpick__chip-title">{c.title}</span>
                          <button type="button" className="linkpick__chip-rm" aria-label="解除" title="解除"
                            onClick={() => setPending((ps) => ps.filter((x) => !(x.target_type === c.target_type && x.target_id === c.target_id)))}>✕</button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="link-add__bottom">
                  <label className="link-add__field" style={{ flex: 1 }}><span className="link-add__lbl">種別（選んだ対象すべてに適用）</span>
                    <select className="select" value={addKind} onChange={(e) => setAddKind(e.target.value as InfoLinkKind)}>
                      {Object.entries(LINK_KIND_LABEL).map(([v, lab]) => <option key={v} value={v}>{lab[0]}</option>)}
                    </select>
                  </label>
                  <button className="btn btn-outline" type="button" disabled={!pending.length || linkBusy} onClick={commitLinks}>＋ 追加</button>
                </div>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>その場で編集し即時反映します。採否・統制は成果物側の管理者に委ねます。種別「反証」で対象の作成者＋評価者へ通知＋要再評価。</div>
              <div style={{ marginTop: 8 }}><button className="btn btn-outline btn-sm" type="button" onClick={() => setLinkEditing(false)}>編集を終える</button></div>
            </>
          )}
        </div>

        <div className={refCls}>
          <div className="dialog-label">🧵 続報スレッド</div>
          {hasThread ? (
            <ul className="info-thread">
              {threadItems.map((t, i) => {
                const current = t.id === r.id;
                return (
                  <li key={t.id}>
                    <div className="info-thread__title">
                      {i === 0 ? "🧭 " : "↳ "}{t.title}
                      {current ? <span className="badge badge-muted" style={{ marginLeft: 6 }}>表示中</span> : null}
                    </div>
                    <div className="info-thread__meta">
                      {(t.created_by ?? "")}・{t.created_at.slice(0, 10)}
                      {current ? null : <>　<a href={`/info-items/${t.id}`} onClick={(e) => { e.preventDefault(); swap(`/info-items/${t.id}`); }}>開く</a></>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">続報はまだありません。</p>}
          <div style={{ marginTop: 8 }}>
            {/* 続報は常にスレッドの根に紐づける（§12-1・フラットなスレッド）。登録時に親の未棄却リンクを自動複製。 */}
            <button className="btn btn-outline btn-sm" type="button" onClick={() => go(`/info-items/new?parent=${threadRoot.id}`)}>＋ 続報を登録</button>
          </div>
        </div>
      </div>

      <div className="modal__footer">
        <button className="btn btn-outline dialog-close-left" type="button" onClick={onClose} disabled={saving || archiveBusy}>閉じる</button>
        {/* フッターは「閉じる／保存する」に絞る（SC-50 §8・ボタン過多の解消）。アーカイブ/解除は本文の curator ブロックへ。 */}
        {(r.can.edit_content || r.can.curate) ? (
          <button className="btn btn-primary" type="button" onClick={save} disabled={saving || archiveBusy}>{saving ? "保存中…" : "保存する"}</button>
        ) : null}
      </div>
      <TargetPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={addPicked} />
    </>
  );
}
