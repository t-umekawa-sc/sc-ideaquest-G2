"use client";

// SC-61 §4.4 前提カード＝重要度/現在判定/stale＋検証履歴（時系列）＋実績入力導線＋前提スレッド議論導線。
// 検証履歴は展開時に遅延取得（GET /assumptions/{id}/validations）。実績入力/リンク解除は owner/quest_admin。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { listValidations, type ConceptAssumption, type Validation } from "../api";

const CRITICALITY_LABEL: Record<string, string> = { critical: "致命的", major: "重要", minor: "補助" };
const VERDICT_LABEL: Record<string, [string, string]> = {
  inconclusive: ["保留", "badge badge-muted"], supported: ["支持", "badge badge-success"], refuted: ["反証", "badge badge-danger"],
};

export function AssumptionCard({ a, threadHref, canManage, onValidate, onEditValidation, onDeleteValidation, onUnlink, reloadToken }: {
  a: ConceptAssumption;
  threadHref: string | null;
  canManage: boolean;
  onValidate: () => void;
  onEditValidation: (v: Validation) => void;
  onDeleteValidation: (v: Validation) => void;
  onUnlink: () => void;
  reloadToken: number; // bump で検証履歴を再取得（実績追加/編集/削除後）
}) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Validation[] | null>(null);
  const [loadedToken, setLoadedToken] = useState(-1);
  const [vl, vc] = VERDICT_LABEL[a.current_verdict] ?? [a.current_verdict, "badge badge-muted"];

  const load = useCallback(() => {
    setVals(null);
    listValidations(a.assumption_id).then((r) => { setVals(r?.items ?? []); setLoadedToken(reloadToken); }).catch(() => setVals([]));
  }, [a.assumption_id, reloadToken]);

  // 開いている間に reloadToken が変わったら（＝実績の追記/編集/削除後）自動で再取得＝リロード不要で反映。
  useEffect(() => {
    if (open && loadedToken !== reloadToken) load();
  }, [open, reloadToken, loadedToken, load]);

  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    setOpen((e.currentTarget as HTMLDetailsElement).open);
  };

  return (
    <li className="assumption-card">
      <div className="assumption-top">
        <span className="badge badge-muted">{CRITICALITY_LABEL[a.criticality] ?? a.criticality}</span>
        <span className={vc}>{vl}</span>
        {a.is_stale && <span className="badge badge-danger">⚠ 要再評価</span>}
        {canManage && <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={onUnlink}>リンク解除</button>}
      </div>
      <div className="assumption-statement">{a.statement}</div>
      <div className="assumption-actions">
        {threadHref
          ? <Link className="btn btn-outline btn-sm" href={threadHref}>💬 前提スレッド →</Link>
          : <span className="muted text-xs">スレッド準備中…</span>}
        {canManage && <button type="button" className="btn btn-outline btn-sm" onClick={onValidate}>📝 実績を入力</button>}
      </div>
      {/* 検証履歴＝時系列（新しい順）＝検証方法/結果/判定/実施日/規模（§4.4）。 */}
      <details className="disclosure" style={{ marginTop: "var(--space-2)" }} onToggle={onToggle}>
        <summary>🕘 検証履歴{open && vals ? `（${vals.length}）` : ""}</summary>
        <div className="disclosure__body">
          {vals === null ? (
            <p className="muted text-sm" style={{ margin: 0 }}>読み込み中…</p>
          ) : vals.length === 0 ? (
            <p className="muted text-sm" style={{ margin: 0 }}>まだ検証（実績）がありません。{canManage && "「📝 実績を入力」から追記できます。"}</p>
          ) : (
            <ul className="validation-list">
              {vals.map((v) => {
                const [pl, pc] = VERDICT_LABEL[v.verdict] ?? [v.verdict, "badge badge-muted"];
                return (
                  <li key={v.id} className="validation-item">
                    <div className="validation-head">
                      <span className={pc}>{pl}</span>
                      <span className="validation-method">{v.method}</span>
                      <span className="validation-meta muted text-xs">{v.validated_on}{v.scale ? `・規模: ${v.scale}` : ""}</span>
                      {canManage && (
                        <span className="validation-tools">
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => onEditValidation(v)}>編集</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => onDeleteValidation(v)}>削除</button>
                        </span>
                      )}
                    </div>
                    {v.result && <div className="validation-result text-sm">{v.result}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}
