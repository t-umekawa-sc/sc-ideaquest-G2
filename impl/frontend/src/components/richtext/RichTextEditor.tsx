"use client";

// リッチテキスト編集（共有・FR-49 お知らせ／将来の他フォーム）。contentEditable＋execCommand（デモ水準）。
// 本文は**保存時にサーバーで nh3 サニタイズ**されるので、ここでの入力は無害化前提に委ねる（§N.7/U.4）。
// 画像の再ホストは情報インプット専用APIに依存するため本共有版では非対応（follow-up）。
import { useEffect, useRef } from "react";

import "./richtext.css";

type Cmd = { label: string; title: string; run: () => void };

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;                      // 初期 HTML（編集時のプリフィル）
  onChange: (html: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
      />
    </div>
  );
}
