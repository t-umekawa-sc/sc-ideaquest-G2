// 一覧の「複製」標準（デザイン標準 §4.5 複製）＝登録（追加）ダイアログを追加モードで開き、
// 選択行の値を初期表示にプリフィルする共通の仕組み。URL モーダルの作成ルートには `?dup=<JSON>` を
// 付与して渡し、作成フォーム側が読み取ってフォーム初期値に反映する。
//
// **一意キー/サーバー採番列は呼び出し側で prefill に載せない**（会社コード・DB識別子・ログインID・メール・
// 各種コード等＝複製直後の保存で UNIQUE 衝突を避ける／新規レコードであることを明確にする）。
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
