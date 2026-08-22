// 送信ボタン近く（常時見えるフッター）の検証エラーヒント（デザイン標準 §4.7）。
// スクロールで上部サマリが隠れても「入力エラーがある」ことがフッターで分かる。文言はサマリの要約。
type Props = { show: boolean };

export function FormFooterError({ show }: Props) {
  if (!show) return null;
  return (
    <span className="form-footer-error" role="alert">
      ⚠ 入力エラーがあります。内容をご確認ください。
    </span>
  );
}
