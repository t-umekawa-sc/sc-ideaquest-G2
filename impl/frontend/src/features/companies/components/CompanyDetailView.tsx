"use client";

// SC-92 会社詳細/設定（システム管理）。system_admin 専用（ページ側でガード）。
// 会社詳細取得＋パンくず＋文脈バナー（メンテ中の会社を明示）＋会社プロフィール（アバター/カラー）＋
// 会社設定トグル（B.1・記名時 hide_voters はサーバーが無効化）＋クエストグループ CRUD＋アカウント管理。
// レイアウト/クラス/コピーの正＝doc/画面設計/mocks/SC-92_会社詳細.html（DoD＝モック一致）。
//
// 会社名の編集はモック SC-92 に無い（名称はバナー/パンくず表示・変更は設けない）＝ここでは扱わない。
// 会社アイコン画像は専用 EP（PUT/DELETE .../icon-image・B.1・MinIO）に接続＝選択で即保存し署名URL 表示。
// 会社カラーは backend 対応済み（CompanyProfileUpdateRequest.color）＝スウォッチ選択で即保存しバナーへ反映。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, Swatches, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { AccountSection } from "@/features/accounts";
import { QuestGroupSection } from "@/features/questgroups";
import { ApiError } from "@/lib/api/client";
import { deleteCompanyIcon, getCompany, setCompanyIcon, updateCompanyProfile, updateCompanySettings } from "../api";
import type { CompanyDetail, CompanySettingsInput } from "../types";
import "../companies.css";

function statusView(status: string): [string, string] {
  return status === "active" ? ["有効", "st-active"] : ["停止", "st-suspended"];
}

export function CompanyDetailView({ companyId }: { companyId: string }) {
  const router = useRouter();
  const snack = useSnackbar();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState("#2563EB");
  const iconInputRef = useRef<HTMLInputElement>(null);

  const ctxRef = useRef<HTMLElement>(null);
  const miniRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const c = await getCompany(companyId);
      setCompany(c);
      if (c) setColor(c.color);
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404
        ? "会社が見つかりません。"
        : "会社情報の取得に失敗しました。");
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 細い会社識別バー（狭幅・スクロールで全バナーが隠れたら上部へ貼り付く）。正＝mocks/SC-92。
  useEffect(() => {
    const ctxEl = ctxRef.current;
    const miniEl = miniRef.current;
    if (!ctxEl || !miniEl || !("IntersectionObserver" in window)) return;
    const headerH = getComputedStyle(document.documentElement).getPropertyValue("--header-h").trim() || "56px";
    const io = new IntersectionObserver(
      ([e]) => miniEl.classList.toggle("is-visible", !e.isIntersecting),
      { rootMargin: `-${headerH} 0px 0px 0px`, threshold: 0 },
    );
    io.observe(ctxEl);
    return () => io.disconnect();
  }, [company]);

  async function toggle(field: keyof CompanySettingsInput, value: boolean) {
    setError(null);
    try {
      const updated = await updateCompanySettings(companyId, { [field]: value });
      setCompany(updated); // サーバー整合後の値で反映（記名時 hide_voters=false 等）
      snack({ type: "success", title: "設定を更新しました" });
    } catch {
      const msg = "設定の更新に失敗しました。";
      setError(msg);
      snack({ type: "error", title: msg });
    }
  }

  async function onPickColor(next: string) {
    setColor(next); // スウォッチの即時反映（バナー左帯・アイコンタイル）
    setError(null);
    try {
      const updated = await updateCompanyProfile(companyId, { color: next });
      setCompany(updated);
      snack({ type: "success", title: "会社カラーを更新しました" });
    } catch {
      const msg = "会社カラーの更新に失敗しました。";
      setError(msg);
      snack({ type: "error", title: msg });
    }
  }

  async function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (iconInputRef.current) iconInputRef.current.value = ""; // 同じファイル再選択でも onChange が発火するように
    if (!file) return;
    setError(null);
    try {
      const updated = await setCompanyIcon(companyId, file); // 即保存＝応答は署名URL 込みの会社詳細
      setCompany(updated);
      snack({ type: "success", title: "アイコン画像を更新しました" });
    } catch (err) {
      const msg = err instanceof ApiError && err.code === "validation_error"
        ? "画像は PNG/JPEG/WebP/GIF・5MB 以下でお願いします。"
        : "アイコン画像の更新に失敗しました。";
      setError(msg);
      snack({ type: "error", title: "更新できませんでした", msg });
    }
  }
  async function onClearIcon() {
    setError(null);
    try {
      await deleteCompanyIcon(companyId); // 既定（頭文字＋会社カラー）へ戻す
      await load();
      snack({ type: "success", title: "アイコン画像を削除しました" });
    } catch {
      const msg = "アイコン画像の削除に失敗しました。";
      setError(msg);
      snack({ type: "error", title: msg });
    }
  }

  // 一覧へ戻る＝履歴を戻す（一覧は検索/絞込/ページを URL に持つため、ブラウザ戻ると同様に絞込付きで復帰）。
  // 詳細に直接アクセスした場合（履歴なし）は素の一覧へ。
  function backToList() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/admin/companies");
  }

  if (loadError) return <div className="form-error" role="alert">{loadError}</div>;
  if (!company) return <p className="admin-muted">読み込み中…</p>;

  const [stLabel, stCls] = statusView(company.status);

  return (
    <section aria-label="会社詳細" style={{ ["--ctx-color" as string]: color } as React.CSSProperties}>
      <div className="crumbs">
        <Link href="/admin/companies">システム管理</Link> ›{" "}
        <Link href="/admin/companies">会社一覧</Link> › <b>{company.name}</b>
      </div>

      {/* 細い会社識別バー（狭幅・スクロール時）。JS が .is-visible を付与。 */}
      <div className="ctx-mini" ref={miniRef} aria-hidden="true">
        <QuestIcon name={company.name} color={color} imageUrl={company.icon_image_url} size="sm" />
        <span className="ctx-mini__name">{company.name}</span>
        <span className={`badge ${stCls}`}>{stLabel}</span>
      </div>

      {/* 文脈バナー（メンテ中の会社を明示） */}
      <section className="ctx" aria-label="メンテナンス中の会社" ref={ctxRef}>
        <QuestIcon name={company.name} color={color} imageUrl={company.icon_image_url} size="lg" />
        <div>
          <div className="ctx__label">メンテナンス中の会社</div>
          <div className="ctx__name">{company.name}</div>
          <div className="ctx__meta">
            <span className={`badge ${stCls}`}>{stLabel}</span>
            {/* 狭幅ではメタが縦積み＝コード＋DB を1行にグループ化（.ctx__metaline）。件数は別行。 */}
            <span className="ctx__metaline">
              <span className="ctx__db">コード: {company.company_code}</span>
              <span className="ctx__db">DB: {company.db_identifier}</span>
            </span>
            <span>アカウント {company.account_count} / グループ —</span>
          </div>
        </div>
        <div className="ctx__actions">
          <button type="button" className="btn btn-outline" onClick={backToList}>← 会社一覧へ戻る</button>
        </div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}

      {/* 会社プロフィール（アバター・カラー） */}
      <div className="section-head"><h2>会社プロフィール</h2></div>
      <section className="card" aria-label="会社プロフィール">
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">会社アバター / アイコン</div>
            <div className="setting-row__desc">一覧・バナー・（将来）ログイン画面などに表示。未設定時は「頭文字＋会社カラー」で表示。PNG/JPEG/WebP/GIF・5MB まで。</div>
          </div>
          <div className="icon-field">
            <QuestIcon name={company.name} color={color} imageUrl={company.icon_image_url} size="lg" />
            <div className="icon-actions">
              <Button type="button" variant="outline" onClick={() => iconInputRef.current?.click()}>
                画像を選ぶ
              </Button>
              {company.icon_image_url && (
                <Button type="button" variant="outline" onClick={onClearIcon}>
                  クリア
                </Button>
              )}
              <input ref={iconInputRef} type="file" accept="image/*" hidden onChange={onPickIcon} />
            </div>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">会社カラー</div>
            <div className="setting-row__desc">会社アイコンのタイル色・バナーのアクセント（左帯）に反映。</div>
          </div>
          <Swatches value={color} onChange={onPickColor} ariaLabel="会社カラー" />
        </div>
      </section>

      {/* 会社設定 */}
      <div className="section-head"><h2>会社設定</h2></div>
      <section className="card settings-card" aria-label="会社設定">
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">投票の匿名化</div>
            <div className="setting-row__desc">ON=集計数のみ表示（匿名モード・既定）／OFF=賛成・反対したユーザーのアバターを表示（記名モード）。</div>
          </div>
          <label className="switch">
            {/* 設定名は隣の setting-row__name（視覚）だが、スイッチ本体の accessible name も aria-label で担保する（a11y）。 */}
            <input type="checkbox" aria-label="投票の匿名化" checked={company.vote_anonymized} onChange={(e) => toggle("vote_anonymized", e.target.checked)} />
            <span className="switch__track"><span className="switch__thumb" /></span>
            <span className="switch__state">{company.vote_anonymized ? "ON" : "OFF"}</span>
          </label>
        </div>
        <div className={`setting-row${company.vote_anonymized ? "" : " is-disabled"}`}>
          <div className="setting-row__info">
            <div className="setting-row__name">匿名時に所有者/管理者へ投票者を隠す</div>
            <div className="setting-row__desc">
              ON=管理者にも投票者を開示しない（既定）／OFF=所有者・クエスト管理者だけは投票者を確認できる。
              {!company.vote_anonymized && (
                <span style={{ color: "var(--color-warning)" }}>（記名モードのため無効。投票者は全員に表示されます）</span>
              )}
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              aria-label="匿名時に所有者/管理者へ投票者を隠す"
              checked={company.hide_voters_from_managers}
              disabled={!company.vote_anonymized}
              onChange={(e) => toggle("hide_voters_from_managers", e.target.checked)}
            />
            <span className="switch__track"><span className="switch__thumb" /></span>
            <span className="switch__state">{company.hide_voters_from_managers ? "ON" : "OFF"}</span>
          </label>
        </div>
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">MFA（多要素認証）を必須にする</div>
            <div className="setting-row__desc">ON=ログイン時にメールOTPを要求（信頼済み端末はスキップ・既定）／OFF=ID＋パスワードのみ。</div>
          </div>
          <label className="switch">
            <input type="checkbox" aria-label="MFA（多要素認証）を必須にする" checked={company.mfa_required} onChange={(e) => toggle("mfa_required", e.target.checked)} />
            <span className="switch__track"><span className="switch__thumb" /></span>
            <span className="switch__state">{company.mfa_required ? "ON" : "OFF"}</span>
          </label>
        </div>

        <div className="provision-note">
          <strong>DB接続識別子:</strong> <code>{company.db_identifier}</code>
        </div>
      </section>

      <QuestGroupSection companyId={company.company_id} />
      <AccountSection companyId={company.company_id} />
    </section>
  );
}
