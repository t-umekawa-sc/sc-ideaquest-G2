"use client";

// SC-93「情報判定権限（info_curator）」の管理（N.5）＝会社アカウント管理者/system_admin。
// 情報インプットの属性付与・情報判定・アーカイブを行える権限。account_id で付与/剥奪する（会社アカウント管理に同居）。
import { useCallback, useEffect, useMemo, useState } from "react";

import { Multiselect, useConfirm, useSnackbar } from "@/components/ui";
import type { MultiselectOption } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { grantInfoCurator, listInfoCurators, listOwnAccounts, revokeInfoCurator } from "../api";
import type { InfoCurator } from "../api";
import { useAllAccounts } from "../useAllAccounts";
import "@/features/companies/companies.css"; // admin-create/admin-toolbar（SC-93 の他セクションと同居）

export function InfoCuratorSection() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const { accounts } = useAllAccounts(listOwnAccounts);
  const [curators, setCurators] = useState<InfoCurator[]>([]);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { const res = await listInfoCurators(); setCurators(res?.data ?? []); }
    catch { /* 403 等は空表示（画面自体は管理者のみ到達） */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const curatorIds = useMemo(() => new Set(curators.map((c) => c.account_id)), [curators]);
  // 付与候補＝有効（active）かつ未付与のアカウント。
  const options: MultiselectOption[] = useMemo(
    () => accounts
      .filter((a) => a.status === "active" && !curatorIds.has(a.account_id))
      .map((a) => ({ value: a.account_id, label: `${a.display_name}（${a.login_id}）` })),
    [accounts, curatorIds],
  );

  const grant = async () => {
    const id = pick[0];
    if (!id) return;
    setBusy(true);
    try {
      const res = await grantInfoCurator(id);
      setCurators(res?.data ?? curators);
      setPick([]);
      snack({ type: "success", title: "情報判定権限を付与しました" });
    } catch (e) {
      snack({ type: "error", title: "付与できませんでした", msg: e instanceof ApiError && e.status === 409 ? "既に付与済みです。" : "時間をおいて再度お試しください。" });
      void reload();
    } finally { setBusy(false); }
  };

  const revoke = async (c: InfoCurator) => {
    const ok = await confirm({ title: "情報判定権限を剥奪", msg: `「${c.display_name}」の情報判定権限を剥奪しますか？` });
    if (!ok) return;
    setBusy(true);
    try { await revokeInfoCurator(c.account_id); snack({ type: "success", title: "剥奪しました" }); }
    catch { snack({ type: "error", title: "剥奪できませんでした", msg: "時間をおいて再度お試しください。" }); }
    finally { setBusy(false); void reload(); }
  };

  return (
    <section className="card admin-create" aria-label="情報判定権限の管理" style={{ marginTop: "var(--space-4)" }}>
      <div className="admin-toolbar"><h2>情報判定権限（情報インプット）</h2></div>
      <p className="hint" style={{ marginTop: 0 }}>
        情報インプットの<strong>属性付与・情報判定（triage）・アーカイブ</strong>を行える権限です。内容の作成・関連リンクは全員が可能で、この権限は<strong>キュレーション</strong>に限られます。
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", flexWrap: "wrap", marginTop: "var(--space-3)" }}>
        <label style={{ flex: 1, minWidth: 260 }}>
          <span className="dialog-label">権限を付与するアカウント</span>
          <Multiselect options={options} value={pick} onChange={(next) => setPick(next.slice(-1))} placeholder="氏名・ログインIDで検索して選択…" ariaLabel="付与するアカウント" />
        </label>
        <button className="btn btn-primary" type="button" onClick={grant} disabled={!pick.length || busy}>＋ 権限を付与</button>
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        {loading ? <p className="muted">読み込み中…</p>
          : curators.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {curators.map((c) => (
                <li key={c.account_id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <strong style={{ minWidth: 140 }}>{c.display_name}</strong>
                  <span className="badge badge-muted">付与: {c.granted_by ?? "—"}・{c.granted_at.slice(0, 10)}</span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => revoke(c)} style={{ marginLeft: "auto" }}>剥奪</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">情報判定権限を持つユーザーはまだいません。</p>}
      </div>
    </section>
  );
}
