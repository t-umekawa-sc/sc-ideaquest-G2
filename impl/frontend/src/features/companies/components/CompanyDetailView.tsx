"use client";

// SC-92 会社詳細/設定（システム管理）。system_admin 専用（ページ側でガード）。
// 会社詳細取得＋設定トグル（B.1・記名時 hide_voters はサーバーが無効化）＋会社名編集。
// アカウント管理・クエストグループ CRUD・所属エディタは後続サブスライスで追加。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Button, Field } from "@/components/ui";
import { AccountSection } from "@/features/accounts";
import { QuestGroupSection } from "@/features/questgroups";
import { ApiError } from "@/lib/api/client";
import { getCompany, updateCompanyProfile, updateCompanySettings } from "../api";
import type { CompanyDetail, CompanySettingsInput } from "../types";
import "../companies.css";

export function CompanyDetailView({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const c = await getCompany(companyId);
      setCompany(c);
      setName(c?.name ?? "");
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404
        ? "会社が見つかりません。"
        : "会社情報の取得に失敗しました。");
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(field: keyof CompanySettingsInput, value: boolean) {
    setError(null);
    try {
      const updated = await updateCompanySettings(companyId, { [field]: value });
      setCompany(updated); // サーバー整合後の値で反映（記名時 hide_voters=false 等）
    } catch {
      setError("設定の更新に失敗しました。");
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingName(true);
    try {
      const updated = await updateCompanyProfile(companyId, { name });
      setCompany(updated);
    } catch {
      setError("会社名の更新に失敗しました。");
    } finally {
      setSavingName(false);
    }
  }

  if (loadError) return <div className="form-error" role="alert">{loadError}</div>;
  if (!company) return <p className="admin-muted">読み込み中…</p>;

  return (
    <section aria-label="会社詳細">
      <p><Link href="/admin/companies">← 会社一覧へ戻る</Link></p>
      <h1>{company.name}</h1>
      <p className="admin-muted">
        <span className="admin-code">{company.company_code}</span>
        {" ・ "}{company.status === "active" ? "有効" : "停止"}
        {" ・ DB: "}<span className="admin-code">{company.db_identifier}</span>
        {" ・ アカウント "}{company.account_count}
      </p>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="card admin-create">
        <h2>会社プロフィール</h2>
        <form onSubmit={saveName}>
          <Field id="d_name" label="会社名" required>
            <input id="d_name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" disabled={savingName}>
            {savingName ? "保存中…" : "会社名を保存"}
          </Button>
        </form>
      </div>

      <div className="card admin-create">
        <h2>会社設定</h2>
        <label>
          <input
            type="checkbox"
            checked={company.vote_anonymized}
            onChange={(e) => toggle("vote_anonymized", e.target.checked)}
          />{" "}投票の匿名化
        </label>
        <label>
          <input
            type="checkbox"
            checked={company.hide_voters_from_managers}
            disabled={!company.vote_anonymized}
            onChange={(e) => toggle("hide_voters_from_managers", e.target.checked)}
          />{" "}匿名時に所有者/管理者へ投票者を隠す
          {!company.vote_anonymized && <span className="admin-muted">（記名モードのため無効）</span>}
        </label>
        <label>
          <input
            type="checkbox"
            checked={company.mfa_required}
            onChange={(e) => toggle("mfa_required", e.target.checked)}
          />{" "}MFA を必須にする
        </label>
      </div>

      <QuestGroupSection companyId={company.company_id} />
      <AccountSection companyId={company.company_id} />
    </section>
  );
}
