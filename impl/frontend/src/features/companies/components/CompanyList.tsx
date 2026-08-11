"use client";

// SC-91 システム管理（会社一覧）。system_admin 専用（ページ側でガード）。
// 一覧取得＋会社作成（B.1）。業務層クリーン＝表示/UX のみ、判定はサーバー（403/409/422 を文言化）。
import { useCallback, useEffect, useState } from "react";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { createCompany, listCompanies } from "../api";
import type { Company } from "../types";
import "../companies.css";

function createErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "conflict") {
      const field = (err.body as { errors?: { field?: string }[] } | null)?.errors?.[0]?.field;
      if (field === "company_code") return "この会社コードは既に使われています。";
      if (field === "db_identifier") return "この DB 識別子は既に使われています。";
      return "指定された値は既に使われています。";
    }
    if (err.code === "validation_error") {
      return "入力内容をご確認ください（会社コードは英大文字始まり・A-Z/0-9/- ・4〜20 字）。";
    }
    if (err.code === "forbidden") return "この操作を行う権限がありません。";
  }
  return "エラーが発生しました。時間をおいて再度お試しください。";
}

export function CompanyList() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [dbIdentifier, setDbIdentifier] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listCompanies({ per_page: 50 });
      setCompanies(res?.data ?? []);
      setTotal(res?.page_info.total ?? 0);
    } catch (err) {
      setLoadError(err instanceof ApiError && err.code === "forbidden"
        ? "この画面を表示する権限がありません。"
        : "一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    try {
      await createCompany({ name, company_code: companyCode, db_identifier: dbIdentifier });
      setName("");
      setCompanyCode("");
      setDbIdentifier("");
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(createErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="会社一覧">
      <div className="admin-toolbar">
        <h1>システム管理 — 会社一覧</h1>
        <Button type="button" variant="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "閉じる" : "＋ 会社作成"}
        </Button>
      </div>

      {showForm && (
        <form className="admin-create card" onSubmit={onCreate} noValidate>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <Field id="c_name" label="会社名" required>
            <input id="c_name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field id="c_code" label="会社コード" required>
            <input
              id="c_code"
              className="input"
              placeholder="例: ACME-01"
              value={companyCode}
              onChange={(e) => setCompanyCode(e.target.value)}
              required
            />
          </Field>
          <Field id="c_db" label="DB 識別子" required>
            <input
              id="c_db"
              className="input"
              placeholder="例: ideaquest_company_acme"
              value={dbIdentifier}
              onChange={(e) => setDbIdentifier(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "作成中…" : "作成する（準備中で作成）"}
          </Button>
        </form>
      )}

      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {loading ? (
        <p className="admin-muted">読み込み中…</p>
      ) : (
        <>
          <p className="admin-muted">{total} 件</p>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">会社名</th>
                <th scope="col">会社コード</th>
                <th scope="col">状態</th>
                <th scope="col">アカウント数</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.company_id}>
                  <td>{c.name}</td>
                  <td className="admin-code">{c.company_code}</td>
                  <td>{c.status === "active" ? "有効" : "準備中"}</td>
                  <td>{c.account_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {companies.length === 0 && <p className="admin-muted">会社がありません。</p>}
        </>
      )}
    </section>
  );
}
