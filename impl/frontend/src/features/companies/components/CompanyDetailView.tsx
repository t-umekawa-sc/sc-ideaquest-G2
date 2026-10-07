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

import { Button, Swatches, LoadingOverlay, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { AccountSection, InfoCuratorSection } from "@/features/accounts";
import { QuestGroupSection } from "@/features/questgroups";
import { ApiError } from "@/lib/api/client";
import { backToListOr } from "@/lib/nav";
import { deleteCompanyIcon, getCompany, provisionCompany, setCompanyIcon, updateCompanyProfile, updateCompanySettings } from "../api";
import type { CompanyDetail, CompanySettingsInput } from "../types";
import "../companies.css";

function statusView(status: string): [string, string] {
  return status === "active" ? ["有効", "st-active"] : ["停止", "st-suspended"];
}

export function CompanyDetailView({ companyId, isOwnCompany = false }: { companyId: string; isOwnCompany?: boolean }) {
  const router = useRouter();
  const snack = useSnackbar();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState("#2563EB");
  const [provisioning, setProvisioning] = useState(false);
  // 一致率しきい値の表示値（%・スライダー↔数値の共有 state）。会社ロード/保存で server 値に同期。
  const [thPct, setThPct] = useState(12);
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

  // 公開/非公開モード（FR-48 §8.0・system_admin のみ）＝public はコンテスト専用テナント（業務EPを 403・SC-50 着地）。
  async function saveAccessMode(mode: "private" | "public") {
    setError(null);
    try {
      const updated = await updateCompanySettings(companyId, { access_mode: mode });
      setCompany(updated);
      snack({ type: "success", title: mode === "public" ? "公開（コンテスト専用）モードにしました" : "非公開モードにしました" });
    } catch {
      const msg = "公開モードの更新に失敗しました。";
      setError(msg);
      snack({ type: "error", title: msg });
    }
  }

  // 会社ロード/保存後に server の一致率しきい値（比率 0..1）を % 表示へ同期（スライダー/数値の初期・確定値）。
  useEffect(() => {
    if (company) setThPct(Math.round((company.auto_link_threshold ?? 0.12) * 100));
  }, [company?.auto_link_threshold]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自動関連付けの一致率しきい値（N.6・§5.36b）＝UI は %、値は比率（0..1）で保存。0〜100 の範囲外は弾く。
  async function saveThreshold(pct: number) {
    setError(null);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      const msg = "一致率は 0〜100% の範囲で指定してください。";
      setError(msg);
      snack({ type: "error", title: msg });
      return;
    }
    try {
      const updated = await updateCompanySettings(companyId, { auto_link_threshold: Math.round(pct) / 100 });
      setCompany(updated);
      snack({ type: "success", title: "一致率しきい値を更新しました" });
    } catch {
      const msg = "設定の更新に失敗しました。";
      setError(msg);
      snack({ type: "error", title: msg });
    }
  }

  // 経営資料整合の類似度方式（FR-44・A-2）＝キーワード/意味/ハイブリッドの3択。変更で整合率が再計算される。
  async function saveAlignmentMethod(method: string) {
    setError(null);
    try {
      const updated = await updateCompanySettings(companyId, { alignment_method: method });
      setCompany(updated);
      snack({ type: "success", title: "整合方式を更新しました" });
    } catch {
      const msg = "整合方式の更新に失敗しました。";
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

  // 会社DB プロビジョニング（DB作成→マイグレーション→ミラー→active 化・B.1）。冪等・system_admin。
  async function onProvision() {
    setError(null);
    setProvisioning(true);
    try {
      const updated = await provisionCompany(companyId);
      setCompany(updated);
      snack({ type: "success", title: "会社DBを準備しました", msg: "DB作成・マイグレーション・有効化が完了しました。" });
    } catch {
      const msg = "会社DBのプロビジョニングに失敗しました。";
      setError(msg);
      snack({ type: "error", title: "プロビジョニングに失敗しました", msg });
    } finally {
      setProvisioning(false);
    }
  }

  // 一覧へ戻る＝履歴を戻す（一覧は検索/絞込/ページを URL に持つため、ブラウザ戻ると同様に絞込付きで復帰）。
  // 詳細に直接アクセスした場合（履歴なし）は素の一覧へ（共通 backToListOr・デザイン標準 §4.5 ⑨）。
  const backToList = () => backToListOr(router, "/admin/companies");

  if (loadError) return <div className="form-error" role="alert">{loadError}</div>;
  if (!company) return <LoadingOverlay variant="clean" />;

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

      {/* 会社DB（プロビジョニング＝DB作成・マイグレーション・有効化。MVP 手動運用の管理操作・B.1/§8-⑫） */}
      <div className="section-head"><h2>会社DB</h2></div>
      <section className="card" aria-label="会社DB">
        <p className="admin-sub" style={{ marginTop: 0 }}>
          会社DB（識別子 <code className="db-id">{company.db_identifier}</code>）を作成し、テーブルを最新化してからこの会社を<strong>有効化</strong>します。
          有効化されるまで一般ユーザーはこの会社のデータを利用できません（メンテナンス中）。この操作は<strong>繰り返し実行しても安全</strong>です。
        </p>
        <div className="row" style={{ alignItems: "center", gap: "var(--space-3)" }}>
          <span>状態: {company.status === "active"
            ? <span className="badge st-active">有効</span>
            : <span className="badge st-suspended">停止（DB未整備）</span>}</span>
          <Button type="button" variant="primary" onClick={onProvision} loading={provisioning}>
            {provisioning ? "準備中…" : company.status === "active" ? "会社DBを再準備" : "会社DBを作成して有効化"}
          </Button>
        </div>
      </section>

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

        {/* ゲームモード会社既定（レビュー#2・§4.11）＝会社全体のゲーム層UIの既定 ON/OFF。個人は SC-03 で上書き可。 */}
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">ゲームモード（会社既定）</div>
            <div className="setting-row__desc">ON=ショップ/きせかえ/魔法・実績・ランキング・演出・ゲーム系通知を表示（既定）／OFF=ゲーム層を隠す。各メンバーはプロフィールで個別に上書きできます。ゲームのロジック（XP/コイン）は据え置きです。</div>
          </div>
          <label className="switch">
            <input type="checkbox" aria-label="ゲームモード（会社既定）" checked={company.game_mode_default} onChange={(e) => toggle("game_mode_default", e.target.checked)} />
            <span className="switch__track"><span className="switch__thumb" /></span>
            <span className="switch__state">{company.game_mode_default ? "ON" : "OFF"}</span>
          </label>
        </div>

        {/* 公開/非公開モード（FR-48 §8.0・system_admin のみ）＝public はデモ用コンテスト専用テナント。 */}
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">公開（コンテスト専用）モード</div>
            <div className="setting-row__desc">ON=デモ用の公開テナント。一般ユーザーは<strong>コンテストのみ操作可</strong>（クエスト等の業務機能はサーバーで 404＝存在秘匿・ホームは SC-50 コンテスト一覧に着地）。管理者も業務機能は使えずコンテスト＋管理のみ。OFF（既定）=通常の社内モード。</div>
          </div>
          <label className="switch">
            <input type="checkbox" aria-label="公開（コンテスト専用）モード" checked={company.access_mode === "public"} onChange={(e) => saveAccessMode(e.target.checked ? "public" : "private")} />
            <span className="switch__track"><span className="switch__thumb" /></span>
            <span className="switch__state">{company.access_mode === "public" ? "公開" : "非公開"}</span>
          </label>
        </div>

        {/* 業務通知メール（FR-40・§4）＝参加リクエスト等の業務通知メールの会社既定。セキュリティ系メールは対象外＝常時送信。 */}
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">業務通知メール</div>
            <div className="setting-row__desc">ON=参加リクエストなどの業務通知をメールでも送る（既定）／OFF=アプリ内通知のみ。パスワード/セキュリティのメールは本設定に関わらず常に送信します。</div>
          </div>
          <label className="switch">
            <input type="checkbox" aria-label="業務通知メール" checked={company.notify_email_enabled} onChange={(e) => toggle("notify_email_enabled", e.target.checked)} />
            <span className="switch__track"><span className="switch__thumb" /></span>
            <span className="switch__state">{company.notify_email_enabled ? "ON" : "OFF"}</span>
          </label>
        </div>

        {/* 自動関連付けの一致率しきい値（N.6・§5.36b）＝情報と成果物を自動で紐づける最小の一致率（%）。 */}
        <div className="setting-row">
          <div className="setting-row__info">
            <div className="setting-row__name">自動関連付けの一致率しきい値</div>
            <div className="setting-row__desc">情報インプットと成果物（アイデア/コンセプト/クエスト/前提）を自動で紐づける最小の一致率。高いほど厳しく（紐づけが減る）、低いほど緩い（増える）。既定 12%。</div>
          </div>
          {/* スライダー（つまみ）＋数値入力の双方向同期（style-guide §4d 由来）。ドラッグ中は表示のみ更新し、
              確定（pointer/keyup・数値は blur）で保存＝比率 0..1 へ丸め。--pct で塗り/吹き出しを駆動。 */}
          <div className="threshold" style={{ ["--pct" as string]: thPct } as React.CSSProperties}>
            <div className="threshold__control">
              <div className="threshold__slider-wrap">
                <output className="threshold__bubble" htmlFor="auto-link-threshold">{thPct}%</output>
                <input
                  className="threshold__slider"
                  id="auto-link-threshold"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={thPct}
                  aria-label="自動関連付けの一致率しきい値（パーセント）"
                  onChange={(e) => setThPct(Number(e.target.value))}
                  onPointerUp={(e) => void saveThreshold(Number(e.currentTarget.value))}
                  onKeyUp={(e) => void saveThreshold(Number(e.currentTarget.value))}
                />
              </div>
              <div className="threshold__num">
                <input
                  className="threshold__input"
                  type="number"
                  aria-label="一致率しきい値（数値・パーセント）"
                  min={0}
                  max={100}
                  step={1}
                  value={thPct}
                  onChange={(e) => setThPct(Number(e.target.value))}
                  onBlur={(e) => void saveThreshold(Number(e.currentTarget.value))}
                />
                <span aria-hidden="true">%</span>
              </div>
            </div>
            <div className="threshold__scale"><span>← 緩い（紐づけ多い）</span><span>厳しい（少ない）→</span></div>
          </div>
        </div>

        {/* 経営資料整合の類似度方式（FR-44・A-2）＝アイデアと経営資料の「整合率」の測り方。縦ラジオ（共有 .radio-list・ユーザー要望）。 */}
        <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="setting-row__info">
            <div className="setting-row__name">経営資料との整合の測り方</div>
            <div className="setting-row__desc">アイデアと経営資料の「整合率」の算出方式。変更すると既存アイデアの整合率が再計算されます。既定＝キーワード。</div>
          </div>
          <div className="radio-list" role="radiogroup" aria-label="経営資料との整合の測り方" style={{ marginTop: "var(--space-2)" }}>
            {([
              ["keyword", "キーワード（語の一致）", "語の一致で測る。速く決定的（同じ語が多いほど整合率が高い）。"],
              ["embedding", "意味（埋め込み）", "言い回しが違っても意味が近ければ高い（埋め込みベクトルの類似度）。"],
              ["hybrid", "ハイブリッド（両方）", "キーワードと意味の両方を組み合わせて測る。"],
            ] as const).map(([val, title, desc]) => {
              const sel = (company.alignment_method ?? "keyword") === val;
              return (
                <label key={val} className={"radio-opt" + (sel ? " is-sel" : "")}>
                  <input type="radio" name="alignment_method" value={val} checked={sel} onChange={() => void saveAlignmentMethod(val)} />
                  <span>
                    <span className="radio-opt__title">{title}</span>
                    <span className="radio-opt__desc">{desc}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="provision-note">
          <strong>DB接続識別子:</strong> <code>{company.db_identifier}</code>
        </div>
      </section>

      <QuestGroupSection scope="company" companyId={company.company_id} />
      <AccountSection companyId={company.company_id} />
      {/* 情報判定権限（info_curator）＝自社（セッション会社＝表示中会社）のときのみ。
          info-curators API はセッション会社固定なので自社詳細でのみ正しく効く（他社はクロステナント未対応）。 */}
      {isOwnCompany && <InfoCuratorSection />}
    </section>
  );
}
