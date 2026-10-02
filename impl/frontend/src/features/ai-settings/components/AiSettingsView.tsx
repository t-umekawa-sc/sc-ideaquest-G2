"use client";

// SC-94 会社のLLM設定（FR-45・S.5）。company_account_admin / system_admin 専用（認可はサーバー強制＝二重防御）。
// 踏襲＝SC-92/93 の設定UI（.setting-row/.switch/.card）＋確認モーダル（新規UIを作らない）。
// モデルカタログの ON/OFF・月次予算（有料のみ）・当月利用／利用明細（会社×モデル×月）。
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useConfirm, useSnackbar } from "@/components/ui";

import { fetchAdminModels, fetchAiUsage, patchAdminModel } from "../api";
import { modelMeta } from "../types";
import type { AdminModelItem, AiUsageRow } from "../types";
import "../ai-settings.css";

const yen = (micros: number) => `¥${Math.round(micros / 1_000_000).toLocaleString()}`;
const periodLabel = (ym: number) => `${Math.floor(ym / 100)}年${ym % 100}月`;

export function AiSettingsView() {
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [models, setModels] = useState<AdminModelItem[] | null>(null);
  const [usage, setUsage] = useState<AiUsageRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchAdminModels(ac.signal).then(setModels).catch(() => setErr("モデル一覧の取得に失敗しました。"));
    fetchAiUsage(undefined, ac.signal).then(setUsage).catch(() => {});
    return () => ac.abort();
  }, []);

  const totalCost = useMemo(() => (models ?? []).reduce((s, m) => s + (m.current_month?.cost_micros ?? 0), 0), [models]);
  const totalCount = useMemo(() => usage.reduce((s, u) => s + u.count, 0), [usage]);

  async function setEnabled(m: AdminModelItem, next: boolean) {
    // 有料モデルを ON＝課金合意＋外部送信解禁を同一操作で確認する（§S.7・SC-94 §4.2）。
    if (next && m.billing === "paid") {
      const ok = await confirm({
        title: "有料モデルを有効化",
        msg: "有料モデルを有効化すると、利用量に応じて課金が発生します。外部クラウドへの送信も解禁されます。よろしいですか？",
        variant: "danger",
        confirmLabel: "有効化する",
        cancelLabel: "やめる",
      });
      if (!ok) return;
    }
    try {
      setModels(await patchAdminModel(m.key, { enabled: next }));
      snack({ type: "success", title: next ? "有効にしました" : "無効にしました" });
    } catch {
      snack({ type: "error", title: "更新に失敗しました" });
    }
  }

  async function saveBudget(m: AdminModelItem, raw: string) {
    const trimmed = raw.trim();
    const micros = trimmed === "" ? null : Math.round(Number(trimmed) * 1_000_000);
    if (micros != null && (!Number.isFinite(micros) || micros < 0)) {
      snack({ type: "error", title: "予算は 0 以上の数値で入力してください。" });
      return;
    }
    if (micros === (m.monthly_budget_micros ?? null)) return; // 変更なしは送らない
    try {
      setModels(await patchAdminModel(m.key, { monthly_budget_micros: micros }));
      snack({ type: "success", title: "月次予算を更新しました" });
    } catch {
      snack({ type: "error", title: "更新に失敗しました" });
    }
  }

  if (err) return <p className="hint">{err}</p>;
  if (!models) return <p className="hint">読み込み中…</p>;

  const hasPaid = models.some((m) => m.billing === "paid");

  return (
    <section aria-label="会社のLLM設定">
      <Link className="backlink backlink--float" href="/admin/accounts">← 会社アカウント管理へ戻る</Link>
      <h1 className="page-title">会社のLLM設定</h1>
      <p className="admin-sub">
        自社で使う AI モデルの <strong>ON/OFF</strong>・<strong>月次予算</strong>を管理し、<strong>利用量・コスト</strong>を確認できます。有料モデルの有効化は課金合意が必要です。
      </p>

      <div className="ai-settings__summary card" aria-label="当月サマリ">
        <div className="ai-settings__sum">
          <span className="ai-settings__sum-label">当月の総コスト</span>
          <span className="ai-settings__sum-value">{yen(totalCost)}</span>
        </div>
        <div className="ai-settings__sum">
          <span className="ai-settings__sum-label">当月の実行件数</span>
          <span className="ai-settings__sum-value">{totalCount.toLocaleString()} 件</span>
        </div>
      </div>

      <div className="section-head"><h2>モデル</h2></div>
      <section className="card settings-card" aria-label="モデル一覧">
        {models.map((m) => {
          const meta = modelMeta(m.key);
          const paid = m.billing === "paid";
          const cm = m.current_month;
          const budgetPct = paid && m.monthly_budget_micros ? Math.round((cm.cost_micros / m.monthly_budget_micros) * 100) : null;
          return (
            <div key={m.key} className={`setting-row${m.enabled ? "" : " is-disabled"}`}>
              <div className="setting-row__info">
                <div className="setting-row__name">
                  {meta.name}
                  <span className={`badge ${paid ? "badge-danger" : "badge-muted"}`} style={{ marginLeft: "var(--space-2)" }}>
                    {paid ? "有料（外部・従量）" : "無料（自社ホスト）"}
                  </span>
                </div>
                <div className="setting-row__desc">
                  {meta.feature}
                  <br />
                  用途：{meta.use}
                </div>
                <div className="ai-settings__usage">
                  当月：{cm.tokens.toLocaleString()} トークン ／ {yen(cm.cost_micros)}
                  {budgetPct != null && <>（予算 {yen(m.monthly_budget_micros!)}・消化 {budgetPct}%）</>}
                </div>
                {paid && (
                  <label className="ai-settings__budget">
                    月次予算（円・空＝無制限）：
                    <input
                      type="number"
                      min={0}
                      defaultValue={m.monthly_budget_micros != null ? Math.round(m.monthly_budget_micros / 1_000_000) : ""}
                      onBlur={(e) => saveBudget(m, e.target.value)}
                    />
                  </label>
                )}
              </div>
              <label className="switch">
                <input type="checkbox" aria-label={`${meta.name} を有効にする`} checked={m.enabled} onChange={(e) => setEnabled(m, e.target.checked)} />
                <span className="switch__track"><span className="switch__thumb" /></span>
                <span className="switch__state">{m.enabled ? "ON" : "OFF"}</span>
              </label>
            </div>
          );
        })}
        {!hasPaid && <p className="hint">現在、有料モデルは提供されていません（自社ホストの無料モデルのみ）。</p>}
      </section>

      <div className="section-head"><h2>利用明細（会社 × モデル × 月）</h2></div>
      <section className="card" aria-label="利用明細">
        {usage.length === 0 ? (
          <p className="hint">利用実績はありません。</p>
        ) : (
          <table className="ai-settings__usage-table">
            <thead>
              <tr><th>月</th><th>モデル</th><th>入力 / 出力トークン</th><th>コスト</th><th>実行</th></tr>
            </thead>
            <tbody>
              {usage.map((u, i) => (
                <tr key={i}>
                  <td>{periodLabel(u.period_ym)}</td>
                  <td>{modelMeta(u.model_key).name}</td>
                  <td>{u.input_tokens.toLocaleString()} / {u.output_tokens.toLocaleString()}</td>
                  <td>{yen(u.cost_micros)}</td>
                  <td>{u.count.toLocaleString()} 件</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
