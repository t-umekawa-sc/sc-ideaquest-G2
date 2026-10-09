"use client";

// 帳票出力ダイアログ（印刷ダイアログ風・FR-51・ドメイン V.1）＝使用料請求書 PDF の出力。
// 見本＝doc/画面設計/mocks/style-guide.html §3c（②帳票出力ダイアログ・2026-10-09 採用）。
// 左＝書面プレビュー（帳票の雰囲気）／右＝出力オプション（対象期間＝年月・形式）。フッター＝キャンセル→ダウンロード。
// ダウンロードは既存 CSV エクスポートと同じ seam（同一オリジン GET ナビゲーション・Cookie 認証・CSRF 不要）＝
// Jasper の URL はフロントに出さない（backend が唯一の窓口）。他社の請求書は backend が自社限定で 404（自社のみ）。
// 一過性の出力アクションのため共通 Modal（ローカル state）で開く（登録/編集の URL モーダルとは別用途）。
import { useState } from "react";

import { Modal, ModalBody, ModalFooter } from "@/components/ui";
import { invoiceUrl } from "@/features/companies/api";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function InvoiceOutputModal({
  open,
  onClose,
  companyId,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
}) {
  const [period, setPeriod] = useState(currentMonth);

  function download() {
    if (!period) return;
    // 同一オリジン GET ナビゲーション＝attachment なので画面遷移せずダウンロードが始まる（CSV と同 seam）。
    window.location.href = invoiceUrl(companyId, period);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="使用料請求書の出力" size="md">
      <ModalBody>
        <p className="muted text-sm" style={{ marginTop: 0 }}>
          対象期間と形式を選んで出力します。他社の請求書は取得できません（自社のみ）。
        </p>
        {/* ダミーデータ注意書き＝明細・金額は固定のサンプル値（MVP）。実データ連携は今後（台帳 F10）。
            テキストは1つの span にまとめる（flex 直下に素のテキスト/strong を置くと flex item に分断され折返しが崩れる）。 */}
        <p className="report-note" role="note">
          <span className="report-note__icon" aria-hidden="true">⚠️</span>
          <span>現在はダミーデータ（固定のサンプル値）で生成されます。明細・金額は<strong>実際の請求内容ではありません</strong>。</span>
        </p>
        <div className="report-dialog">
          {/* 書面プレビュー（帳票の雰囲気を出す飾り・内容は固定モチーフ） */}
          <div className="report-doc" aria-hidden="true">
            <div className="report-doc__page">
              <div className="report-doc__h" />
              <div className="report-doc__l report-doc__l--m" />
              <div className="report-doc__l" />
              <div className="report-doc__l report-doc__l--s" />
              <div className="report-doc__l report-doc__l--m" />
              <div className="report-doc__l" />
              <div className="report-doc__total" />
              <span className="report-doc__badge">PDF</span>
            </div>
          </div>
          <div className="report-fields">
            <div className="field">
              <label htmlFor="invoice-period">対象期間</label>
              <input
                id="invoice-period"
                className="input"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <div className="field">
              <label>形式</label>
              <div className="report-fmts">
                {/* 現状 PDF のみ（将来 xlsx/csv）。選択済みチップとして表示。 */}
                <label className="report-fmt is-on">
                  <input type="radio" name="invoice-format" checked readOnly /> PDF
                </label>
                <span className="muted text-sm">※ Excel / CSV は今後対応</span>
              </div>
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        {/* フッター順＝閉じる（左・dialog-close-left）→ 主要（右）＝ダイアログ標準（デザイン標準 §4）。 */}
        <button type="button" className="btn btn-outline dialog-close-left" onClick={onClose}>
          キャンセル
        </button>
        <button type="button" className="btn btn-primary" disabled={!period} onClick={download}>
          <span aria-hidden="true">⬇</span> ダウンロード
        </button>
      </ModalFooter>
    </Modal>
  );
}
