// 一覧の「複製」標準（デザイン標準 §4.5 複製・方針改定 2026-09-06）＝登録（追加）ダイアログを追加モードで開き、
// 選択行の値を初期表示にプリフィルする共通の仕組み。URL モーダルの作成ルートには `?dup=<JSON>` を
// 付与して渡し、作成フォーム側が読み取ってフォーム初期値に反映する。
//
// **原則＝ユーザーが入力する項目は一意キー/重複禁止項目も含めて全部 prefill に載せる**（会社コード・DB識別子・
// ログインID・メール・各種コード・所属クエストグループ等）。空にしても保存時の一意検証（409）でエラーになるのは
// 同じで、空にすると再入力の手間が増えるだけのため（例＝連番部だけ付け直す）。**例外＝サーバー自動採番/システム生成列**
// （主キー `id`・作成日時/作成者・パスワード等）は載せない（§2.2 Mass Assignment）。
// 状態モーダル（URL を持たない作成）ではこのヘルパを使わず、直接フォーム state に prefill を流し込む。

export function buildDuplicateHref(base: string, prefill: Record<string, unknown>): string {
  const enc = encodeURIComponent(JSON.stringify(prefill));
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}dup=${enc}`;
}

export function readDuplicatePrefill<T = Record<string, unknown>>(
  search: string | URLSearchParams | null | undefined,
): Partial<T> | null {
  if (!search) return null;
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = sp.get("dup");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : null;
  } catch {
    return null; // 壊れた dup は無視して素の追加モードにフォールバック
  }
}
