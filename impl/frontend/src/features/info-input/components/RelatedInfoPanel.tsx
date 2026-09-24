"use client";

// 成果物→関連情報パネル（FR-41・SC-12 上部ストリップ／SC-22 右レール）。
// info_links の成果物側 read（GET /{quests,ideas}/{id}/related-info・C.8b/D）を横スクロール棚で表示。
// ⚠反証を先頭固定・カードクリックで情報詳細（SC-52＝/info-items/{id}）・「⤢ 全画面で一覧」は Modal で。
// Phase 1＝表示のみ（追加/種別変更/棄却は情報側 SC-50/52＝会社内全員／「＋追加」導線は後続スライス）。
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Avatar, Modal, ModalBody } from "@/components/ui";
import { fetchRelatedInfo, INFO_CHANGED_EVENT } from "../api";
import { DISPOSITION_LABEL, IMPACT_CLASS_LABEL, LINK_KIND_LABEL } from "../labels";
import type { RelatedInfoItem } from "../types";
import { AddRelatedInfoDialog } from "./AddRelatedInfoDialog";
import "../info-input.css";

const KIND_ICON: Record<string, string> = { related: "🔗", supporting: "✅", refuting: "⚠" };

function RelatedInfoCard({ x, compact, from }: { x: RelatedInfoItem; compact?: boolean; from: string }) {
  const disp = DISPOSITION_LABEL[x.disposition];
  // 成果物側コンテキスト（from＝種別:ID）を付けて開く＝SC-52 が採否モードで開く（参照＋扱い入力）。
  const href = `/info-items/${x.info_id}?from=${from}`;
  return (
    <article className={`ri-card${x.kind === "refuting" ? " is-refuting" : ""}${x.disposition === "declined" ? " is-declined" : ""}${compact ? " ri-card--compact" : ""}`}>
      <div className="ri-title"><Link href={href}>{x.title}</Link></div>
      {!compact && x.summary ? <div className="ri-summary">{x.summary}</div> : null}
      {/* 採用の処理・反映メモ（「どう反映したか」＝結果として見せる） */}
      {x.disposition === "adopted" && x.disposition_note ? (
        <div className="ri-note" title="処理・反映メモ">📝 {x.disposition_note}</div>
      ) : null}
      <div className="ri-meta">
        {x.score != null && <span className="ri-score">一致度 {x.score.toFixed(2)}</span>}
        {x.impact_class && <span>{IMPACT_CLASS_LABEL[x.impact_class]?.[0] ?? x.impact_class}</span>}
        {x.source_url && <a className="ri-src" href={x.source_url} target="_blank" rel="noopener noreferrer">🔗 出典</a>}
      </div>
      {/* 種別＋採否バッジ＋関連付けた人＝カード最下段の1行横並び（タイトルを圧迫しない） */}
      <div className="ri-badges">
        <span className={`badge ${LINK_KIND_LABEL[x.kind]?.[1] ?? ""}`}>{KIND_ICON[x.kind] ?? "🔗"} {LINK_KIND_LABEL[x.kind]?.[0] ?? x.kind}</span>
        {x.disposition !== "pending" && disp ? (
          <span className={`badge ${disp[1]}`} title={`採否＝${disp[0]}`}>{disp[2]} {disp[0]}</span>
        ) : null}
        {x.origin === "manual" && x.linked_by ? (
          <span className="ri-by" title="手動で関連付けた人">
            <Avatar name={x.linked_by.display_name} imageUrl={x.linked_by.avatar_image_url ?? undefined} size="sm" noTooltip />
            {x.linked_by.display_name}
          </span>
        ) : (
          <span className="badge badge-muted" title="類似度で自動生成">🤖 自動</span>
        )}
      </div>
    </article>
  );
}

export function RelatedInfoPanel({ targetType, targetId, variant = "strip" }: {
  targetType: "quests" | "ideas"; targetId: string; variant?: "strip" | "rail";
}) {
  const [items, setItems] = useState<RelatedInfoItem[] | null>(null);
  const [maxi, setMaxi] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => fetchRelatedInfo(targetType, targetId).then((d) => { if (alive) setItems(d); }).catch(() => { /* 再試行は次イベント */ });
    load();
    const on = () => load(); // 情報側でリンクが変わったら再取得（双方向整合）
    window.addEventListener(INFO_CHANGED_EVENT, on);
    return () => { alive = false; window.removeEventListener(INFO_CHANGED_EVENT, on); };
  }, [targetType, targetId]);

  // ⚠反証を先頭固定（backend は score 降順で返す＝それ以外の順序は保つ）。
  const sorted = useMemo(() => {
    const xs = items ?? [];
    return [...xs].sort((a, b) => (a.kind === "refuting" ? 0 : 1) - (b.kind === "refuting" ? 0 : 1));
  }, [items]);
  // 採否でグルーピング（既定パネルは不採用を隠して件数のみ・全画面は3グループ・FR-41 Phase2）。
  const pending = sorted.filter((x) => x.disposition === "pending");
  const adopted = sorted.filter((x) => x.disposition === "adopted");
  const declined = sorted.filter((x) => x.disposition === "declined");
  const visible = sorted.filter((x) => x.disposition !== "declined"); // 既定表示＝未処理＋採用
  const refuteCount = visible.filter((x) => x.kind === "refuting").length;
  const existingInfoIds = useMemo(() => new Set((items ?? []).map((x) => x.info_id)), [items]);

  const from = `${targetType}:${targetId}`; // SC-52 を採否モードで開くためのコンテキスト

  if (items === null) return null; // 初回読込中は描画しない（チラつき防止）

  return (
    <section className={`ri-panel ri-panel--${variant}`} aria-label="関連情報">
      <div className="ri-head">
        <span className="ri-head__title">🔗 関連情報 <span className="ri-head__count">{visible.length}件</span>
          {refuteCount > 0 && <span className="ri-head__alert">⚠ 反証 {refuteCount}</span>}
          {declined.length > 0 && <span className="ri-head__declined" title="不採用（全画面で一覧）">🚫 不採用 {declined.length}</span>}
        </span>
        <span className="ri-head__spacer" />
        <button type="button" className="ri-head__btn ri-head__btn--add" onClick={() => setAddOpen(true)}>＋ 関連情報を追加</button>
        {sorted.length > 0 && <button type="button" className="ri-head__btn" onClick={() => setMaxi(true)}>⤢ 全画面で一覧</button>}
      </div>

      {sorted.length === 0 ? (
        <div className="ri-empty">この{targetType === "quests" ? "クエスト" : "アイデア"}に関連づいた情報はまだありません。情報インプット（SC-50）から関連づけできます。</div>
      ) : visible.length === 0 ? (
        <div className="ri-empty">表示できる関連情報はありません（不採用 {declined.length} 件は「⤢ 全画面で一覧」で確認できます）。</div>
      ) : (
        <div className="ri-shelf">
          {visible.map((x) => <div key={x.link_id} className="ri-shelf__item"><RelatedInfoCard x={x} from={from} /></div>)}
        </div>
      )}

      {maxi && (
        <Modal open title={`🔗 関連情報 一覧（${sorted.length}件）`} size="lg" onClose={() => setMaxi(false)}>
          <ModalBody>
            {/* 未処理 / 採用 / 不採用 の3グループ（採用は処理メモ付き＝「結果」相当） */}
            {[["未処理", pending] as const, ["採用", adopted] as const, ["不採用", declined] as const].map(([label, group]) => (
              group.length > 0 ? (
                <div key={label} className="ri-group">
                  <h4 className="ri-group__head">{label} <span className="ri-group__count">{group.length}</span></h4>
                  <div className="ri-grid">{group.map((x) => <RelatedInfoCard key={x.link_id} x={x} from={from} />)}</div>
                </div>
              ) : null
            ))}
          </ModalBody>
        </Modal>
      )}

      {addOpen && (
        <AddRelatedInfoDialog
          open onClose={() => setAddOpen(false)}
          targetType={targetType} targetId={targetId}
          existingInfoIds={existingInfoIds}
          onAdded={() => { /* AddRelatedInfoDialog が INFO_CHANGED_EVENT を発火→本パネルが再取得 */ }}
        />
      )}
    </section>
  );
}
