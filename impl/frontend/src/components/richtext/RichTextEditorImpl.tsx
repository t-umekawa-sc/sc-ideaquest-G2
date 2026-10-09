"use client";

// リッチテキスト編集の実体（TipTap/ProseMirror・共有・FR-49 お知らせ／将来の本文系）。
// 値は **PM-JSON**（TipTap getJSON）。保存時にサーバーで許可リスト無害化される（app/core/richtext.sanitize_pm）。
// この実体は `next/dynamic` の ssr:false 経由でのみ読み込む（§4-4=A・RichTextEditor.tsx）＝初期バンドルを局所化。
// 画像＝`uploadImage` を受けた時だけツールバー＋paste/ドロップで自社ホスト(MinIO)へ再ホストし署名URLで挿入する。
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";

import { chatMentionExtension, type MentionItem } from "./mention";
import "./richtext.css";

export type RichTextValue = JSONContent;
export const EMPTY_DOC: RichTextValue = { type: "doc", content: [] };

export type RichTextEditorProps = {
  value: RichTextValue | null;              // 初期 PM-JSON（編集時のプリフィル）
  onChange: (json: RichTextValue) => void;
  preset?: "document" | "chat";             // document=高機能／chat=軽量（既定 document）
  placeholder?: string;
  ariaLabel?: string;
  uploadImage?: (file: File) => Promise<string>;  // 画像を自社ホストへ再ホストし署名URL を返す（渡された時だけ画像対応）
  mentionItems?: MentionItem[];  // @メンション候補（chat プリセット・渡された時だけメンション有効・TT5）
  onSubmit?: () => void;         // Enter 送信（Shift+Enter は改行）。メンション候補が開いている時は候補選択が優先。
};

// 共有リンク設定＝サニタイズと整合（http/https/mailto・rel で tabnabbing/referrer 防止・自動クリック無効）。
const LINK_OPTS = { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"],
  HTMLAttributes: { rel: "noopener noreferrer nofollow" } };

function extensionsFor(preset: "document" | "chat", withPlaceholder: string, mentionGetter?: () => MentionItem[]) {
  const common = [Placeholder.configure({ placeholder: withPlaceholder })];
  if (preset === "chat") {
    // 軽量＝段落/強調/コード/リンク＋メンション（候補が渡された時のみ・TT5）。見出し/リスト/引用/コード/画像/表は外す。
    return [
      StarterKit.configure({
        underline: false, link: LINK_OPTS,
        heading: false, bulletList: false, orderedList: false, listItem: false,
        blockquote: false, codeBlock: false, horizontalRule: false,
      }),
      ...(mentionGetter ? [chatMentionExtension(mentionGetter)] : []),
      ...common,
    ];
  }
  // document＝見出し(1–3)/リスト/強調/リンク/引用/コードブロック＋画像＋表（backend 許可リストと一致）。
  return [
    StarterKit.configure({ underline: false, link: LINK_OPTS, heading: { levels: [1, 2, 3] } }),
    Image.configure({ inline: false, allowBase64: false }),
    TableKit.configure({ table: { resizable: false } }),
    ...common,
  ];
}

type Btn = { label: string; title: string; run: () => void; active?: boolean };

export function RichTextEditor({ value, onChange, preset = "document", placeholder, ariaLabel, uploadImage, mentionItems, onSubmit }: RichTextEditorProps) {
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const lastEmitted = useRef<string>("");
  // 候補/送信ハンドラは再生成されても editor を作り直さないよう ref 経由で最新を読む（useEditor の extensions/props は初期化時固定）。
  const mentionsRef = useRef<MentionItem[]>(mentionItems ?? []);
  mentionsRef.current = mentionItems ?? [];
  const submitRef = useRef<(() => void) | undefined>(onSubmit);
  submitRef.current = onSubmit;
  const mentionEnabled = mentionItems !== undefined;

  const editor = useEditor({
    extensions: extensionsFor(preset, placeholder ?? "本文を入力…", mentionEnabled ? () => mentionsRef.current : undefined),
    content: value ?? EMPTY_DOC,
    immediatelyRender: false,  // Next App Router の hydration mismatch 回避（§4-4）
    editorProps: {
      attributes: { class: "rt__area", role: "textbox", "aria-multiline": "true", "aria-label": ariaLabel ?? "本文" },
      // Enter 送信（Shift+Enter は改行）。メンション候補が開いている間は Enter を送信に使わず候補選択へ譲る
      // （editorProps.handleKeyDown は suggestion プラグインより先に走るため、候補ポップアップの有無で明示ガード）。
      handleKeyDown: (_view, event) => {
        if (submitRef.current && event.key === "Enter" && !event.shiftKey
          && !document.querySelector(".mention-pop")) { event.preventDefault(); submitRef.current(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      lastEmitted.current = JSON.stringify(json);
      onChange(json);
    },
  });

  // 親から value が後追いで入る（例：編集モーダルが詳細を非同期取得）場合に内容を反映。自分の更新は除外（ループ防止）。
  useEffect(() => {
    if (!editor) return;
    const incoming = JSON.stringify(value ?? EMPTY_DOC);
    if (incoming !== lastEmitted.current && incoming !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(value ?? EMPTY_DOC, { emitUpdate: false });
      lastEmitted.current = incoming;
    }
  }, [value, editor]);

  const insertImageFiles = useCallback(async (fl: File[]) => {
    if (!uploadImage || !editor) return;
    const imgs = fl.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setImgErr(null); setImgBusy(true);
    try {
      for (const f of imgs) {
        const url = await uploadImage(f);  // 自社ホスト署名URL（外部 src・data: は持ち込まない）
        editor.chain().focus().setImage({ src: url, alt: "貼付画像" }).run();
      }
    } catch {
      setImgErr("画像の再ホストに失敗しました（形式・サイズをご確認ください）。");
    } finally {
      setImgBusy(false);
    }
  }, [uploadImage, editor]);

  if (!editor) return <div className="rt rt--loading" aria-busy="true" />;

  const doc: Btn[] = [
    { label: "B", title: "太字", run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold") },
    { label: "I", title: "斜体", run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic") },
    { label: "S", title: "打ち消し", run: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive("strike") },
    { label: "<>", title: "コード", run: () => editor.chain().focus().toggleCode().run(), active: editor.isActive("code") },
  ];
  const docOnly: Btn[] = [
    { label: "H2", title: "見出し", run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive("heading", { level: 2 }) },
    { label: "H3", title: "小見出し", run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive("heading", { level: 3 }) },
    { label: "• 箇条書き", title: "箇条書き", run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive("bulletList") },
    { label: "1. 番号", title: "番号付き", run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive("orderedList") },
    { label: "❝ 引用", title: "引用", run: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive("blockquote") },
    { label: "▦ 表", title: "表を挿入", run: () => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run() },
    { label: "{ } コード", title: "コードブロック", run: () => editor.chain().focus().toggleCodeBlock().run(), active: editor.isActive("codeBlock") },
  ];
  const link: Btn = {
    label: "🔗 リンク", title: "リンク", active: editor.isActive("link"),
    run: () => {
      if (editor.isActive("link")) { editor.chain().focus().unsetLink().run(); return; }
      const url = window.prompt("リンク先 URL（http/https）");
      if (url && /^https?:\/\//i.test(url)) editor.chain().focus().setLink({ href: url }).run();
    },
  };
  const btns: Btn[] = preset === "chat" ? [...doc, link] : [...doc, ...docOnly, link];

  return (
    <div className="rt">
      <div className="rt__bar" role="toolbar" aria-label="書式">
        {btns.map((b) => (
          <button key={b.label} type="button" title={b.title} aria-pressed={b.active ?? false}
            className={b.active ? "is-active" : undefined}
            onMouseDown={(e) => e.preventDefault()} onClick={b.run}>{b.label}</button>
        ))}
        {uploadImage ? (
          <button type="button" title="画像を挿入（貼付/ドロップも可）" disabled={imgBusy}
            onMouseDown={(e) => e.preventDefault()} onClick={() => imgInputRef.current?.click()}>
            {imgBusy ? "⏳ 画像…" : "🖼 画像"}
          </button>
        ) : null}
      </div>
      <EditorContent editor={editor as Editor}
        onPaste={uploadImage ? (e) => {
          const files = Array.from(e.clipboardData.items).filter((it) => it.kind === "file" && it.type.startsWith("image/"))
            .map((it) => it.getAsFile()).filter((f): f is File => f != null);
          if (files.length) { e.preventDefault(); void insertImageFiles(files); }
        } : undefined}
        onDrop={uploadImage ? (e) => {
          const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
          if (files.length) { e.preventDefault(); void insertImageFiles(files); }
        } : undefined}
      />
      {uploadImage ? (
        <input ref={imgInputRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => {
            const fl = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";  // 同期 materialize 済（DFT-N-001）→ 連続選択も取りこぼさない
            if (fl.length) void insertImageFiles(fl);
          }} />
      ) : null}
      {imgErr ? <p className="rt__err" role="alert">{imgErr}</p> : null}
    </div>
  );
}
