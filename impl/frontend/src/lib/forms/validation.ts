// 入力検証エラー表示の共通ヘルパ（デザイン標準 §4.7・確定 2026-08-22）。
// 標準＝インライン中心（枠赤 aria-invalid＋.field__error）＋上部サマリ（.form-summary）併用／
// 検証は送信時＋blur／**エラー項目へのフォーカス移動はしない**／i18n（ja/en）。
//
// 本モジュールは (1) ロケール別メッセージカタログ、(2) サーバー problem+json（§1.7）→ フィールド別
// エラー＋サマリへの写像、(3) クライアント必須チェックの土台を提供する。impl の全体 i18n 機構は
// 未整備のため、まず検証メッセージ層で ja/en を用意する（画面ラベルの英語化は別途）。

import { ApiError } from "@/lib/api/client";

export type Locale = "ja" | "en";
export type FieldErrors = Record<string, string>;

type Msg = Record<Locale, string>;

const CATALOG: Record<string, Msg> = {
  "field.required": { ja: "この項目は必須です。", en: "This field is required." },
  "summary.title": { ja: "入力内容をご確認ください。", en: "Please review your input." },
  "error.generic": {
    ja: "エラーが発生しました。時間をおいて再度お試しください。",
    en: "Something went wrong. Please try again later.",
  },
  "error.forbidden": {
    ja: "この操作を行う権限がありません。",
    en: "You don't have permission to perform this action.",
  },
  "error.conflict": {
    ja: "現在の状態では実行できません。",
    en: "This action can't be performed in the current state.",
  },
  "error.edit_conflict": {
    ja: "他の編集と競合しました。ページを再読み込みして最新を取得してから、編集し直してください。",
    en: "Your edit conflicts with another change. Reload to get the latest, then edit again.",
  },
  "error.validation": { ja: "入力内容をご確認ください。", en: "Please review your input." },
};

export function t(locale: Locale, key: string): string {
  const m = CATALOG[key];
  return m ? m[locale] ?? m.ja : key;
}

/** サーバー problem+json（§1.7）の errors[].field を1件ずつ引くための型。 */
type ProblemBody = { errors?: { field?: string; reason?: string }[] } | null;

/**
 * ApiError（RFC7807）を「フィールド別エラー＋サマリ行」に写像する（§4.7）。
 * fieldMessages＝画面固有のフィールド別メッセージ（field 名→表示文）。未指定フィールドは汎用文。
 * フォーカス移動はしない（呼び出し側も自動フォーカスしない）。
 */
export function mapServerErrors(
  err: unknown,
  locale: Locale,
  fieldMessages: Record<string, string> = {},
): { fieldErrors: FieldErrors; summary: string[] } {
  if (err instanceof ApiError) {
    if (err.code === "validation_error") {
      const errors = (err.body as ProblemBody)?.errors ?? [];
      const fieldErrors: FieldErrors = {};
      const summary: string[] = [];
      for (const e of errors) {
        if (!e.field) continue;
        const msg = fieldMessages[e.field] ?? t(locale, "error.validation");
        fieldErrors[e.field] = msg;
        summary.push(msg);
      }
      if (summary.length === 0) summary.push(t(locale, "error.validation"));
      return { fieldErrors, summary };
    }
    if (err.code === "forbidden") return { fieldErrors: {}, summary: [t(locale, "error.forbidden")] };
    // 並行編集の後着＝最新再取得を促す実行可能メッセージ（D.2 楽観ロック・edit_conflict）。
    if (err.code === "edit_conflict") return { fieldErrors: {}, summary: [t(locale, "error.edit_conflict")] };
    if (err.code === "conflict") return { fieldErrors: {}, summary: [t(locale, "error.conflict")] };
  }
  return { fieldErrors: {}, summary: [t(locale, "error.generic")] };
}
