"use client";

// SC-91 会社（テナント）作成フォーム（B.1）。URL 付きモーダル（intercept）とフルページ（直アクセス）で共有する。
// 業務層クリーン＝表示/UX のみ、判定はサーバー（409/422/403 を文言化）。レイアウト/コピーの正＝mocks/SC-91。
// 成功時は onDone() を呼ぶ（呼び出し側が「モーダルを閉じて一覧更新」or「一覧へ遷移」を担う）。
import { useRef, useState } from "react";

import { Button, Field, ModalBody, ModalFooter, Swatches } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { createCompany, setCompanyIcon } from "../api";
import "../companies.css";

const DEFAULT_COLOR = "#2563EB"; // 会社カラー既定（swatches の先頭＝ブルー）

function createErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "conflict") {
      const field = (err.body as { errors?: { field?: string }[] } | null)?.errors?.[0]?.field;
      if (field === "company_code") return "この会社コードは既に使われています。";
      if (field === "db_identifier") return "この DB 識別子は既に使われています。";
      return "指定された値は既に使われています。";
    }
    if (err.code === "validation_error") {
      const field = (err.body as { errors?: { field?: string }[] } | null)?.errors?.[0]?.field;
      if (field === "file") return "画像は PNG/JPEG/WebP/GIF・5MB 以下でお願いします。";
      return "入力内容をご確認ください（会社コードは英大文字始まり・A-Z/0-9/- ・4〜20 字）。";
    }
    if (err.code === "forbidden") return "この操作を行う権限がありません。";
  }
  return "エラーが発生しました。時間をおいて再度お試しください。";
}

export function CompanyCreateForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [dbIdentifier, setDbIdentifier] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  // アイコン画像は会社作成後に専用 EP（PUT .../icon-image・B.1）へアップロードする（会社は先に実在が必要）。
  // 選択直後はローカルプレビュー（objectURL）で見せ、送信するファイル本体は iconFile に保持する。
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(URL.createObjectURL(file));
    setIconFile(file);
  }
  function onClearIcon() {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    setIconFile(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    try {
      // 作成（会社は status=suspended で作られる）→ 画像が選択されていれば作成会社にアイコンを設定（2段・B.1）。
      const created = await createCompany({ name, company_code: companyCode, db_identifier: dbIdentifier, color });
      if (iconFile && created) await setCompanyIcon(created.company_id, iconFile);
      if (iconPreview) URL.revokeObjectURL(iconPreview);
      onDone();
    } catch (err) {
      setFormError(createErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <Field id="c_name" label="会社名" required>
          <input id="c_name" className="input" placeholder="例: システムコンシェルジュ" value={name} onChange={(e) => setName(e.target.value)} required />
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
            placeholder="例: db_sc"
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
              <span className="hint">未設定時は「頭文字＋会社カラー」で表示。PNG/JPEG/WebP/GIF・5MB まで（作成時に保存）。</span>
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
        <Button type="button" variant="outline" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "作成中…" : "作成する"}
        </Button>
      </ModalFooter>
    </form>
  );
}
