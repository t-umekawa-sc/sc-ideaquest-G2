// 汎用オフセットページャ（業務層・list-toolbar 系で共用）。page_info（total/page/per_page・README §1.8）を受けて
// 「前へ / 現在ページ / 次へ」を出す。判定（範囲・件数）はサーバーの page_info に従い、UI は表示と onPageChange のみ。
type Props = {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (next: number) => void;
};

export function Pager({ page, perPage, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return (
    <nav className="pager" aria-label="ページ送り">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        前へ
      </button>
      <span className="pager-status" aria-live="polite">
        {page} / {totalPages}（{total} 件）
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        次へ
      </button>
    </nav>
  );
}
