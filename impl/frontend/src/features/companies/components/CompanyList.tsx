"use client";

// SC-91 システム管理（会社一覧）。system_admin 専用（ページ側でガード）。
// 一覧取得＋会社作成（B.1）。業務層クリーン＝表示/UX のみ、判定はサーバー（403/409/422 を文言化）。
// レイアウト/クラスは正＝doc/画面設計/mocks/SC-91_システム管理.html（DoD＝モック一致）。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, Field, Modal, ModalBody, ModalFooter, Pager, Swatches } from "@/components/ui";
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
const DEFAULT_COLOR = "#2563EB"; // 会社カラー既定（swatches の先頭＝ブルー）

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
  const [color, setColor] = useState(DEFAULT_COLOR);
  // アイコン画像は MinIO 基盤前提（別スライス）＝ここではローカルプレビューのみ（送信しない仮実装）。
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
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

  function resetForm() {
    setName("");
    setCompanyCode("");
    setDbIdentifier("");
    setColor(DEFAULT_COLOR);
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
    setFormError(null);
  }
  function openForm() {
    resetForm();
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    resetForm();
  }
  function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(URL.createObjectURL(file));
  }
  function onClearIcon() {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    try {
      // アイコン画像は未接続（MinIO 待ち）＝color のみ送信。
      await createCompany({ name, company_code: companyCode, db_identifier: dbIdentifier, color });
      closeForm();
      await reload();
    } catch (err) {
      setFormError(createErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="会社一覧">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="page-title">システム管理（運営）</h1>
      <p className="admin-sub">
        会社（テナント）の一覧・作成。<strong>各会社の設定・アカウント/所属の管理は、会社を選ぶと会社詳細で行います</strong>。
        <strong>システム管理者のみ</strong>。
      </p>

      <div className="section-head">
        <h2>会社（テナント）</h2>
        <Button type="button" variant="primary" onClick={openForm}>
          ＋ 会社を作成
        </Button>
      </div>

      <Modal open={showForm} onClose={closeForm} title="会社（テナント）を作成" size="md">
        <form onSubmit={onCreate} noValidate>
          <ModalBody>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <Field id="c_name" label="会社名" required>
              <input id="c_name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field
              id="c_code"
              label="会社コード"
              required
              hint="対人向けの会社識別コード。英大文字/数字/ハイフン・4〜20文字・全社で一意（大文字に正規化）。作成後は変更不可。"
            >
              <input
                id="c_code"
                className="input db-id"
                placeholder="例: ACROSS"
                maxLength={20}
                style={{ textTransform: "uppercase" }}
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
                required
              />
            </Field>
            <Field id="c_db" label="DB 識別子" required hint="会社DBの参照キー。接続情報の実体は .env。">
              <input
                id="c_db"
                className="input"
                placeholder="例: db_across"
                value={dbIdentifier}
                onChange={(e) => setDbIdentifier(e.target.value)}
                required
              />
            </Field>

            <Field id="c_icon" label="会社アバター / アイコン">
              <div className="icon-field">
                <span className="quest-icon lg" style={{ ["--accent" as string]: color } as React.CSSProperties}>
                  {iconPreview ? (
                    // 送信しないローカルプレビュー（objectURL）＝next/image を通さず素の img で描画。
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="quest-icon__img" src={iconPreview} alt="" />
                  ) : (
                    <span className="quest-icon__char">{name.trim().charAt(0) || "会"}</span>
                  )}
                </span>
                <div className="icon-actions">
                  <Button type="button" variant="outline" onClick={() => iconInputRef.current?.click()}>
                    画像を選ぶ
                  </Button>
                  {iconPreview && (
                    <Button type="button" variant="outline" onClick={onClearIcon}>
                      クリア
                    </Button>
                  )}
                  <input ref={iconInputRef} id="c_icon" type="file" accept="image/*" hidden onChange={onPickIcon} />
                  <span className="hint">未設定時は「頭文字＋会社カラー」で表示（画像アップロードは今後対応）</span>
                </div>
              </div>
            </Field>

            <Field id="c_color" label="会社カラー">
              <Swatches value={color} onChange={setColor} ariaLabel="会社カラー" />
            </Field>

            <p className="provision-note">
              作成すると会社が登録され、最初は「停止（メンテナンス）」の状態です。会社DBの準備が整うと「有効」になり、利用できるようになります。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={closeForm}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "作成中…" : "作成する"}
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
              <option value="suspended">停止</option>
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
                      <span className="co">
                        <QuestIcon name={c.name} color={c.color} imageUrl={c.icon_image_path} size="sm" />
                        <strong>{c.name}</strong>
                      </span>
                    </td>
                    <td className="db-id">{c.company_code}</td>
                    <td className="db-id">{c.db_identifier}</td>
                    <td>
                      {c.status === "active" ? (
                        <span className="badge st-active">有効</span>
                      ) : (
                        <span className="badge st-suspended">停止</span>
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

      <p className="role-note">
        ※ 各会社のデータは会社ごとに分けて管理されます。一覧の「DB識別子」は会社を識別するための参照キーです。
        会社を選ぶと<strong>会社詳細</strong>で設定・アカウント/所属を管理します。
      </p>
    </section>
  );
}
