"use client";

// SC-91 システム管理（会社一覧）。system_admin 専用（ページ側でガード）。
// 一覧取得＋会社作成（B.1）。業務層クリーン＝表示/UX のみ、判定はサーバー（403/409/422 を文言化）。
// レイアウト/クラスは正＝doc/画面設計/mocks/SC-91_システム管理.html（DoD＝モック一致）。
//
// 一覧の操作標準は DataTable（client モード）に委譲＝検索/絞込/複数ソート/列設定/CSV/ピン/カードは
// 全件クライアント保持で処理（管理系＝小規模。§5 の設計フォークは (a) を採用）。
// サーバー駆動モード（アイデア/クエスト一覧・§4.5 契約後）は将来拡張＝computeRows() 境界で差し替え。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, DataTable, Field, Modal, ModalBody, ModalFooter, Swatches } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
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

const DEFAULT_COLOR = "#2563EB"; // 会社カラー既定（swatches の先頭＝ブルー）
const FETCH_PER_PAGE = 100; // 全件取得のバッチ（backend 上限＝100）。会社は小規模で通常1回。

// 状態バッジ（会社状態＝2値。有効/停止）。
function statusBadge(status: string): ReactNode {
  return status === "active" ? (
    <span className="badge st-active">有効</span>
  ) : (
    <span className="badge st-suspended">停止</span>
  );
}

// 列定義（正＝mocks/SC-91 の DataTable columns）。render は ReactNode（HTML 文字列でない）。
// グループ数・作成日は CompanyListItem 未提供（group_count＝ドメインC／created_at＝backend 拡張）＝
// 構造を mock と揃えて列は残すが、実データが無いため sortable/filter は付けず「—」プレースホルダ。
// backend が値を提供したら sortable/filter/sortVal を有効化する。
const COLUMNS: DataTableColumn<Company>[] = [
  {
    key: "name",
    label: "会社名",
    locked: true,
    width: 240,
    sortable: true,
    filter: { type: "text" },
    sortVal: (r) => r.name,
    searchVal: (r) => r.name,
    render: (r) => (
      <span className="co">
        <QuestIcon name={r.name} color={r.color} imageUrl={r.icon_image_path} size="sm" />
        <strong>{r.name}</strong>
      </span>
    ),
  },
  {
    key: "company_code",
    label: "会社コード",
    width: 130,
    cellClass: "db-id",
    sortable: true,
    filter: { type: "text" },
    sortVal: (r) => r.company_code,
    searchVal: (r) => r.company_code,
    render: (r) => r.company_code,
  },
  {
    key: "db_identifier",
    label: "DB識別子",
    width: 150,
    cellClass: "db-id",
    sortable: true,
    filter: { type: "text" },
    sortVal: (r) => r.db_identifier,
    searchVal: (r) => r.db_identifier,
    render: (r) => r.db_identifier,
  },
  {
    key: "status",
    label: "状態",
    width: 110,
    sortable: true,
    filter: { type: "enum", options: [["active", "有効"], ["suspended", "停止"]] },
    sortVal: (r) => r.status,
    filterVal: (r) => r.status,
    csvVal: (r) => (r.status === "active" ? "有効" : "停止"),
    render: (r) => statusBadge(r.status),
  },
  {
    key: "account_count",
    label: "アカウント",
    width: 110,
    align: "num",
    sortable: true,
    filter: { type: "number" },
    sortVal: (r) => r.account_count,
    filterVal: (r) => r.account_count,
    render: (r) => r.account_count,
  },
  { key: "groups", label: "グループ", width: 100, align: "num", render: () => "—", csvVal: () => "—" },
  { key: "created", label: "作成日", width: 130, render: () => "—", csvVal: () => "—" },
  {
    key: "_actions",
    label: "",
    actions: true,
    locked: true,
    width: 130,
    render: (r) => (
      <Link
        href={`/admin/companies/${r.company_id}`}
        className="btn btn-outline btn-sm"
        onClick={(e) => e.stopPropagation()}
      >
        管理する →
      </Link>
    ),
  },
];

// カード表示（🔲カード/☰リスト 切替）。会社アイコン＋名称を活かす。操作は actions 列が右上に自動表示。
function companyCard(c: Company): ReactNode {
  return (
    <>
      <div className="dt-card__title co">
        <QuestIcon name={c.name} color={c.color} imageUrl={c.icon_image_path} size="sm" />
        <span>{c.name}</span>
      </div>
      <div className="dt-card__meta">
        {statusBadge(c.status)}
        <span className="badge badge-muted">{c.company_code}</span>
        <span className="db-id">{c.db_identifier}</span>
      </div>
      <div className="dt-card__stats">
        <span>👥 {c.account_count}</span>
        <span>🗂️ —</span>
        <span>作成 —</span>
      </div>
    </>
  );
}

export function CompanyList() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  // 全件取得（(a) client モード）＝backend 上限 100 でループ。会社は小規模で通常1回。
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const all: Company[] = [];
      let page = 1;
      for (;;) {
        const res = await listCompanies({ page, per_page: FETCH_PER_PAGE });
        const batch = res?.data ?? [];
        all.push(...batch);
        const total = res?.page_info.total ?? all.length;
        if (batch.length === 0 || all.length >= total) break;
        page += 1;
      }
      setCompanies(all);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.code === "forbidden"
          ? "この画面を表示する権限がありません。"
          : "一覧の取得に失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

      {loadError && <div className="form-error" role="alert">{loadError}</div>}
      {loading ? (
        <p className="list-empty">読み込み中…</p>
      ) : (
        <DataTable<Company>
          storageKey="sc91-companies"
          data={companies}
          columns={COLUMNS}
          rowId={(r) => r.company_id}
          unit="社"
          perPage={5}
          perPageOptions={[5, 10, 20, 50]}
          maxPins={5}
          searchFields="会社名・会社コード・DB識別子"
          exportName="会社一覧"
          onRowClick={(r) => router.push(`/admin/companies/${r.company_id}`)}
          emptyText="該当する会社がありません。"
          card={companyCard}
        />
      )}

      <p className="role-note">
        ※ 各会社のデータは会社ごとに分けて管理されます。一覧の「DB識別子」は会社を識別するための参照キーです。
        会社を選ぶと<strong>会社詳細</strong>で設定・アカウント/所属を管理します。
      </p>
    </section>
  );
}
