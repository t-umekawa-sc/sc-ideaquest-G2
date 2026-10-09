"use client";

// リッチテキスト編集の公開エントリ（共有）。§4-4=A＝TipTap 本体は `next/dynamic` の ssr:false で遅延ロードし、
// 初期バンドルをエディタ搭載画面に局所化する（閲覧の RichTextView は SSR 可・別ファイル）。
// 消費側の import パス（@/components/richtext/RichTextEditor）は不変。
import dynamic from "next/dynamic";

import type { RichTextEditorProps } from "./RichTextEditorImpl";

export type { RichTextValue, RichTextEditorProps } from "./RichTextEditorImpl";
export { EMPTY_DOC } from "./RichTextEditorImpl";

const RichTextEditorLazy = dynamic(
  () => import("./RichTextEditorImpl").then((m) => m.RichTextEditor),
  { ssr: false, loading: () => <div className="rt rt--loading" aria-busy="true">エディタを読み込み中…</div> },
);

export function RichTextEditor(props: RichTextEditorProps) {
  return <RichTextEditorLazy {...props} />;
}
