"use client";

// リッチテキスト編集（共有・FR-49 お知らせ／将来の他フォーム）。contentEditable＋execCommand（デモ水準）。
// 本文は**保存時にサーバーで nh3 サニタイズ**されるので、ここでの入力は無害化前提に委ねる（§N.7/U.4）。
// 画像＝任意の `uploadImage` 注入を受けた時だけ「🖼 画像」挿入＋paste/ドロップで自社ホストへ再ホストする
// （未指定なら従来どおり画像無し）。`data:`/外部 URL は持ち込まず、返却署名URL で img を挿入（U-8・§12-4）。
import { useCallback, useEffect, useRef, useState } from "react";

import "./richtext.css";

type Cmd = { label: string; title: string; run: () => void };

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  uploadImage,
}: {
  value: string;                      // 初期 HTML（編集時のプリフィル）
  onChange: (html: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  uploadImage?: (file: File) => Promise<string>;  // 画像を自社ホストへ再ホストし署名URL を返す（渡された時だけ画像対応）
}) {
  const ref = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  // 初期値をマウント時に流し込む（uncontrolled＝以降はユーザー入力を正とし、再レンダーで上書きしない）。
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value ?? "")) {
      ref.current.innerHTML = value ?? "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  };
  const link = () => {
    const url = window.prompt("リンク先 URL（http/https）");
    if (url && /^https?:\/\//i.test(url)) exec("createLink", url);
  };

  // 貼付/選択/ドロップ画像の再ホスト（§12-4）＝blob を uploadImage へ送り、返った自社ホスト URL で img を挿入する。
  // 外部 img src・data: は持ち込まない（トラッキング/referer 漏れ防止・保存時 sanitize で data: は落ちるため）。
  const insertImageFiles = useCallback(async (fl: File[]) => {
    if (!uploadImage) return;
    const imgs = fl.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setImgErr(null); setImgBusy(true);
    try {
      for (const f of imgs) {
        const url = await uploadImage(f);
        ref.current?.focus();
        document.execCommand("insertHTML", false, `<img src="${url}" alt="貼付画像">`);
        onChange(ref.current?.innerHTML ?? "");
      }
    } catch {
      setImgErr("画像の再ホストに失敗しました（形式・サイズをご確認ください）。");
    } finally {
      setImgBusy(false);
    }
  }, [uploadImage, onChange]);

  // paste＝クリップボードに画像 blob があれば横取りして再ホスト（スクショ/コピー画像）。無ければ既定の貼付に委ねる。
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!uploadImage) return;
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length) { e.preventDefault(); void insertImageFiles(files); }
  }, [uploadImage, insertImageFiles]);

  // ドラッグ＆ドロップ＝画像ファイルを再ホスト（ブラウザ既定のナビゲーションは抑止）。
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!uploadImage) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); void insertImageFiles(files); }
  }, [uploadImage, insertImageFiles]);

  const cmds: Cmd[] = [
    { label: "B", title: "太字", run: () => exec("bold") },
    { label: "I", title: "斜体", run: () => exec("italic") },
    { label: "H2", title: "見出し", run: () => exec("formatBlock", "h2") },
    { label: "H3", title: "小見出し", run: () => exec("formatBlock", "h3") },
    { label: "• 箇条書き", title: "箇条書き", run: () => exec("insertUnorderedList") },
    { label: "1. 番号", title: "番号付き", run: () => exec("insertOrderedList") },
    { label: "🔗 リンク", title: "リンク", run: link },
    { label: "本文", title: "段落に戻す", run: () => exec("formatBlock", "p") },
  ];

  return (
    <div className="rt">
      <div className="rt__bar" role="toolbar" aria-label="書式">
        {cmds.map((c) => (
          <button key={c.label} type="button" title={c.title} onMouseDown={(e) => e.preventDefault()} onClick={c.run}>{c.label}</button>
        ))}
        {uploadImage ? (
          <button
            type="button"
            title="画像を挿入（貼付/ドロップも可）"
            disabled={imgBusy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => imgInputRef.current?.click()}
          >
            {imgBusy ? "⏳ 画像…" : "🖼 画像"}
          </button>
        ) : null}
      </div>
      <div
        className="rt__area"
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel ?? "本文"}
        data-placeholder={placeholder ?? "本文を入力…"}
        onInput={() => onChange(ref.current?.innerHTML ?? "")}
        onPaste={uploadImage ? onPaste : undefined}
        onDrop={uploadImage ? onDrop : undefined}
      />
      {uploadImage ? (
        <input
          ref={imgInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const fl = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";  // 同期 materialize 済（DFT-N-001）→ 連続選択も取りこぼさない
            if (fl.length) void insertImageFiles(fl);
          }}
        />
      ) : null}
      {imgErr ? <p className="rt__err" role="alert">{imgErr}</p> : null}
    </div>
  );
}
