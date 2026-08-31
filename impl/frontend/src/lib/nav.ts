// 一覧→詳細→戻る の共通「一覧へ戻る」操作（デザイン標準 §4.5 ⑨・line 191）。
// 一覧は検索/ソート/絞込/ページを URL クエリに持つため、履歴を戻す（router.back）と
// 絞込・ページ・スクロール位置ごと元の一覧に復帰する。直接アクセス（履歴なし）は
// 素の一覧 href へフォールバック。client/server どちらの一覧モードでも同一挙動。
// useRouter() の戻り値（back/push を持つ）をそのまま渡せる構造的型で受ける。
type BackRouter = { back: () => void; push: (href: string) => void };

export function backToListOr(router: BackRouter, fallbackHref: string): void {
  if (typeof window !== "undefined" && window.history.length > 1) router.back();
  else router.push(fallbackHref);
}
