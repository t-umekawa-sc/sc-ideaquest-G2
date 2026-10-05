// リッチテキスト表示（共有・FR-49 お知らせ／情報インプット等）。body_html は**サーバーで nh3 サニタイズ済**
// 前提なので dangerouslySetInnerHTML で安全に描画（§2.2④・保存時無害化）。
import "./richtext.css";

export function RichTextView({ html, className }: { html: string | null | undefined; className?: string }) {
  return <div className={`rt-view${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
}
