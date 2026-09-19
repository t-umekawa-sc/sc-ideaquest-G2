"use client";

// SC-52 情報の詳細。正＝doc/画面設計/mocks/SC-50_情報インプット.html（DoD＝モック一致）。
// モーダル（RouteModal）／フルページ双方から使う。データ源は api.ts（当面 fixtures）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useConfirm } from "@/components/ui";
import { archiveInfoItem, followUps, getInfoItem, INFO_CHANGED_EVENT, rootOf } from "../api";
import {
  BUSINESS_LABEL, CATEGORY_LABEL, CLASSIFICATION_LABEL, IMPACT_CLASS_LABEL, IMPACT_LABEL, LINK_KIND_LABEL,
  LINK_TARGET_LABEL, PRIORITY_LABEL, SCOPE_LABEL, SOURCE_LABEL, STATUS_LABEL, TIMING_LABEL, TRIAGE_LABEL,
} from "../labels";
import type { InfoItem } from "../types";
import { cloudTokens } from "../wordcloud";
import "../info-input.css";

function Attr({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value ? value : <span className="muted">—</span>}</dd>
    </>
  );
}

export function InfoDetailView({ infoId, onClose }: { infoId: string; onClose: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [item, setItem] = useState<InfoItem | undefined>(() => getInfoItem(infoId));

  const reload = useCallback(() => setItem(getInfoItem(infoId)), [infoId]);
  useEffect(() => {
    reload();
    window.addEventListener(INFO_CHANGED_EVENT, reload);
    return () => window.removeEventListener(INFO_CHANGED_EVENT, reload);
  }, [reload]);

  const parent = useMemo(() => (item?.parent_info_id ? getInfoItem(item.parent_info_id) : undefined), [item]);
  const fus = useMemo(() => (item ? followUps(item.id) : []), [item]);
  const cloud = useMemo(() => (item ? cloudTokens(`${item.title} ${item.body_html.replace(/<[^>]+>/g, " ")} ${item.summary ?? ""}`) : []), [item]);

  if (!item) return <p className="muted">情報が見つかりません。</p>;
  const r = item;
  const activeLinks = r.links.filter((l) => !l.rejected);
  const cloudMax = Math.max(...cloud.map((t) => t[1]), 1);

  const go = (path: string) => { onClose(); setTimeout(() => router.push(path), 0); };

  return (
    <>
      <div className="modal__body">
        {parent ? (
          <div className="field dialog-section">
            <div className="dialog-label">元情報（続報元）</div>
            <div className="info-thread__meta">
              🧵 <strong>{parent.title}</strong> の続報　<a href={`/info-items/${parent.id}`} onClick={(e) => { e.preventDefault(); go(`/info-items/${parent.id}`); }}>元情報を開く</a>
            </div>
          </div>
        ) : null}

        <div className="field dialog-section">
          <div className="dialog-label">タイトル</div>
          <h3 style={{ margin: "0 0 6px" }}>{r.title}</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className={`badge ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</span>
            {r.impact_class ? <span className={`badge ${IMPACT_CLASS_LABEL[r.impact_class][1]}`}>{IMPACT_CLASS_LABEL[r.impact_class][0]}</span> : null}
            {r.priority ? <span className="badge badge-muted">優先度 {PRIORITY_LABEL[r.priority]}</span> : null}
            {r.categories.map((c) => <span key={c} className="badge badge-muted">{CATEGORY_LABEL[c]}</span>)}
          </div>
        </div>

        {r.summary ? (
          <div className="field dialog-section">
            <div className="summary-box"><div className="summary-box__label">要約（選別用・自動生成）</div>{r.summary}</div>
          </div>
        ) : null}

        <div className="field dialog-section">
          <div className="dialog-label">内容・説明</div>
          {/* body_html は保存時＋表示時に nh3 サニタイズ済み（§12-4）。fixtures は信頼済み。 */}
          <div className="rt-view" dangerouslySetInnerHTML={{ __html: r.body_html }} />
          {r.source_url ? (
            <div style={{ marginTop: 6 }}>
              <a href={r.source_url} target="_blank" rel="noopener noreferrer">🔗 出典を開く</a>{" "}
              <span style={{ color: "var(--color-text-muted)", wordBreak: "break-all" }}>（{r.source_url}）</span>
            </div>
          ) : null}
        </div>

        <div className="field dialog-section">
          <div className="dialog-label">☁️ この情報の主要語（ワードクラウド）</div>
          {cloud.length ? (
            <div className="wc-mini">
              {cloud.map(([w, c]) => (
                <span key={w} className="wc-word" style={{ fontSize: `${(0.85 + (c / cloudMax) * 0.9).toFixed(2)}rem`, opacity: (0.6 + (c / cloudMax) * 0.4).toFixed(2) }} title={`${w}（${c}）`}>{w}</span>
              ))}
            </div>
          ) : <p className="muted">主要語がありません。</p>}
        </div>

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
        </div>

        <div className="field dialog-section">
          <div className="dialog-label">この情報から（機会特定→行動）</div>
          <button className="btn btn-primary" type="button" onClick={() => go(`/info-items/${r.id}/new-quest`)}>＋ この情報からクエストを作成</button>
          <div className="hint" style={{ marginTop: 6 }}>判定の結果、新しく取り組む価値があると判断したら、この情報を機会/課題として<strong>クエストを起票</strong>できます。作成したクエストにはこの情報が<strong>関連リンク（関連）</strong>で自動的に紐づきます。</div>
        </div>

        <div className="field dialog-section">
          <div className="dialog-label">関連リンク（成果物との関係・per-link 種別）</div>
          {activeLinks.length ? (
            <ul className="link-list">
              {activeLinks.map((l, i) => (
                <li key={i} className="link-item">
                  <span>{LINK_TARGET_LABEL[l.target_type]}</span>
                  <span className="link-item__title">{l.target_title}</span>
                  <span className={`badge ${LINK_KIND_LABEL[l.kind][1]}`}>{LINK_KIND_LABEL[l.kind][0]}</span>
                  <span className="badge badge-muted">{l.origin === "auto" ? "自動" : "手動"}</span>
                  {l.score != null ? <span className="info-thread__meta">一致 {Math.round(l.score * 100)}%</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="muted">関連リンクはまだありません。</p>}
          <div className="hint" style={{ marginTop: 6 }}>種別を「反証」に変えると、対象の作成者＋評価者へ通知＋要再評価が発火します（根底を揺さぶる）。</div>
        </div>

        <div className="field dialog-section">
          <div className="dialog-label">🧵 続報スレッド</div>
          {fus.length ? (
            <ul className="info-thread">
              {fus.map((f) => (
                <li key={f.id}>
                  <div className="info-thread__title">{f.title}</div>
                  <div className="info-thread__meta">{f.created_by}・{f.created_at}　<a href={`/info-items/${f.id}`} onClick={(e) => { e.preventDefault(); go(`/info-items/${f.id}`); }}>開く</a></div>
                </li>
              ))}
            </ul>
          ) : <p className="muted">続報はまだありません。</p>}
        </div>
      </div>

      <div className="modal__footer">
        <button className="btn btn-outline dialog-close-left" type="button" onClick={onClose}>閉じる</button>
        <button className="btn btn-outline" type="button" onClick={() => go(`/info-items/new?parent=${r.id}`)}>続報を登録</button>
        {r.status !== "raw" ? (
          <button className="btn btn-outline" type="button" onClick={async () => { const ok = await confirm({ title: "アーカイブ", msg: `「${r.title}」をアーカイブしますか？（論理削除・監査保持）` }); if (ok) { archiveInfoItem(r.id); onClose(); } }}>アーカイブ</button>
        ) : null}
        <button className="btn btn-primary" type="button" onClick={() => go(`/info-items/${r.id}/edit`)}>属性を編集</button>
      </div>
    </>
  );
}
