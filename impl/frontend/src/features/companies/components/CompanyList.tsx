"use client";

// SC-91 システム管理（会社一覧）。system_admin 専用（ページ側でガード）。
// 一覧取得＋会社作成（B.1）。業務層クリーン＝表示/UX のみ、判定はサーバー（403/409/422 を文言化）。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, Field, Modal, ModalBody, ModalFooter, Pager } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
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

const PER_PAGE = 20; // 一覧の1ページ件数（backend 既定と一致・最大 100）

export function CompanyList() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState(""); // "" = 全件 / active / suspended
  const [page, setPage] = useState(1);
  const [qDraft, setQDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");

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
      const res = await listCompanies({ q: q || undefined, status: status || undefined, page, per_page: PER_PAGE });
      setCompanies(res?.data ?? []);
      setTotal(res?.page_info.total ?? 0);
    } catch (err) {
      setLoadError(err instanceof ApiError && err.code === "forbidden"
        ? "この画面を表示する権限がありません。"
        : "一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 検索/フィルタ適用時は先頭ページへ戻す（絞り込みで現在ページが範囲外になるのを防ぐ）。
  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setQ(qDraft.trim());
    setStatus(statusDraft);
    setPage(1);
  }
  function onClearSearch() {
    setQDraft("");
    setStatusDraft("");
    setQ("");
    setStatus("");
    setPage(1);
  }

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
        <Button type="button" variant="primary" onClick={() => setShowForm(true)}>
          ＋ 会社作成
        </Button>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="会社（テナント）を作成" size="md">
        <form onSubmit={onCreate} noValidate>
          <ModalBody>
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
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "作成中…" : "作成する（準備中で作成）"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <form className="list-toolbar" role="search" aria-label="会社検索" onSubmit={onSearch}>
        <div className="filters">
          <input
            type="search"
            className="input"
            aria-label="検索（会社名・会社コード）"
            placeholder="会社名・会社コード・DB識別子で検索"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
          <label>
            状態{" "}
            <select className="select" aria-label="状態で絞り込み" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)}>
              <option value="">すべて</option>
              <option value="active">有効</option>
              <option value="suspended">準備中</option>
            </select>
          </label>
          <Button type="submit" variant="outline" size="sm">検索</Button>
          {(q || status) && (
            <Button type="button" size="sm" onClick={onClearSearch}>絞り込みをクリア</Button>
          )}
        </div>
        <div className="tools">
          <span className="list-count">{total} 社</span>
        </div>
      </form>

      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {loading ? (
        <p className="list-empty">読み込み中…</p>
      ) : companies.length === 0 ? (
        <p className="list-empty">該当する会社がありません。</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">会社名</th>
                  <th scope="col">会社コード</th>
                  <th scope="col">DB識別子</th>
                  <th scope="col">状態</th>
                  <th scope="col" className="num">アカウント</th>
                  <th scope="col" className="num">グループ</th>
                  <th scope="col">作成日</th>
                  <th scope="col" className="col-actions" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.company_id} className="row-link" onClick={() => router.push(`/admin/companies/${c.company_id}`)}>
                    <td>
                      <span className="poster">
                        <QuestIcon name={c.name} color={c.color} imageUrl={c.icon_image_path} size="sm" />
                        <span className="name">{c.name}</span>
                      </span>
                    </td>
                    <td className="admin-code">{c.company_code}</td>
                    <td className="admin-code">{c.db_identifier}</td>
                    <td>
                      {c.status === "active" ? (
                        <span className="badge badge-success">有効</span>
                      ) : (
                        <span className="badge badge-muted">準備中</span>
                      )}
                    </td>
                    <td className="num">{c.account_count}</td>
                    {/* グループ数・作成日は CompanyListItem 未提供（group_count＝ドメインC／created_at＝backend 拡張）＝暫定「—」 */}
                    <td className="num">—</td>
                    <td>—</td>
                    <td className="col-actions">
                      <Link
                        href={`/admin/companies/${c.company_id}`}
                        className="btn btn-outline btn-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        管理する →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} perPage={PER_PAGE} total={total} onPageChange={setPage} />
        </>
      )}
    </section>
  );
}
