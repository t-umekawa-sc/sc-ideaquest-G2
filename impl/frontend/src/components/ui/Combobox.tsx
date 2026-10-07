"use client";

// 単一選択コンボボックス（候補のみ・自由入力なし）。見た目/クラス/挙動の正＝
// doc/画面設計/mocks/style-guide.html の .combobox（カスタム）＋ mocks/shared.js の [data-combobox] 初期化。
// CSS は design-system.css の .combobox__* を再利用（新規スタイルは足さない）。
// 用途＝ネイティブ <select class="select"> の置き換え（候補までポインター/ハイライト制御・デザイン標準）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ComboboxOption = { value: string; label: string };

type Props = {
  id?: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string; // 未選択時に出す文言（省略時は空）
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;   // root .combobox への追加クラス（インライン幅調整等）
  style?: React.CSSProperties; // root .combobox への style（例: ツールバーの width:auto）
};

export function Combobox({ id, options, value, onChange, placeholder = "", ariaLabel, disabled, className, style }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // ハイライト位置（options index）
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listId = id ? `${id}-list` : undefined;

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : "";

  // 開いたらハイライトを現在の選択（無ければ先頭）に合わせる。
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  // 外側クリックで閉じる。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && !target.isConnected) return; // 選択で <li> が外れた直後の誤判定を無視
      if (rootRef.current && target && !rootRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = useCallback(
    (i: number) => {
      const o = options[i];
      if (o) onChange(o.value);
      setOpen(false);
      btnRef.current?.focus();
    },
    [options, onChange],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="combobox" ref={rootRef}>
      <button
        id={id}
        ref={btnRef}
        type="button"
        className="combobox__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        onKeyDown={onKeyDown}
      >
        <span className="combobox__value">{selectedLabel || placeholder}</span>
        <span className="combobox__arrow" aria-hidden="true">▾</span>
      </button>
      {open && !disabled && (
        <ul className="combobox__list" id={listId} role="listbox" aria-label={ariaLabel}>
          {options.map((o, i) => (
            <li
              key={o.value}
              className={`combobox__option${i === active ? " is-active" : ""}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              onMouseMove={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
