"use client";

// 複数選択コンボボックス（候補のみ・自由入力なし）。見た目/クラス/挙動の正＝
// doc/画面設計/mocks/style-guide.html の .multiselect（候補のみ）＋ mocks/shared.js の初期化ロジック。
// CSS は design-system.css の .multiselect__* を再利用（新規スタイルは足さない）。
// 用途: SC-11 追加グループ（他部署）／既存マスタからの複数選択（自由入力は不可）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MultiselectOption = { value: string; label: string };

type Props = {
  id?: string;
  options: MultiselectOption[];
  value: string[]; // 選択済みの value 配列
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
  emptyText?: string; // 候補ゼロ時の文言
  disabled?: boolean;
};

export function Multiselect({ id, options, value, onChange, placeholder, ariaLabel, emptyText = "候補がありません", disabled }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // 可視候補内のハイライト位置
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = id ? `${id}-list` : undefined;

  const selectedSet = useMemo(() => new Set(value), [value]);
  const labelByValue = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) m[o.value] = o.label;
    return m;
  }, [options]);

  // 可視候補＝未選択かつクエリ部分一致（大小文字無視）。
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => !selectedSet.has(o.value) && (!q || o.label.toLowerCase().includes(q)));
  }, [options, selectedSet, query]);

  useEffect(() => {
    // クエリ/候補が変わったらハイライトを先頭へ戻す。
    setActive(0);
  }, [query, options, value]);

  // 外側クリックで閉じる。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      // 候補選択で当該 <li> が即座に外れる（React18 は discrete イベントを同期 flush）と、その後に document
      // まで伝播した mousedown の target が「切り離し済み＝外側」と誤判定される。切り離し済みは無視して
      // リストを開いたままにする（モック挙動＝選んでも閉じない）。
      if (target && !target.isConnected) return;
      if (rootRef.current && target && !rootRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = useCallback(
    (v: string) => {
      if (!selectedSet.has(v)) onChange([...value, v]);
      setQuery("");
      inputRef.current?.focus();
    },
    [selectedSet, onChange, value],
  );
  const removeAt = useCallback((v: string) => onChange(value.filter((x) => x !== v)), [onChange, value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (visible.length === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % visible.length : (i - 1 + visible.length) % visible.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = visible[active];
      if (o) choose(o.value);
    } else if (e.key === "Backspace" && query === "") {
      if (value.length) removeAt(value[value.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="multiselect" ref={rootRef}>
      <div
        className="multiselect__control"
        onClick={() => { if (!disabled) { inputRef.current?.focus(); setOpen(true); } }}
      >
        {value.map((v) => (
          <span key={v} className="multiselect__chip">
            <span className="multiselect__chip-label">{labelByValue[v] ?? v}</span>
            <button
              type="button"
              className="multiselect__chip-remove"
              aria-label={`「${labelByValue[v] ?? v}」を解除`}
              onClick={(e) => { e.stopPropagation(); removeAt(v); inputRef.current?.focus(); }}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          className="multiselect__input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          placeholder={value.length === 0 ? placeholder : undefined}
          value={query}
          disabled={disabled}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && !disabled && (
        <ul className="multiselect__list" id={listId} role="listbox">
          {visible.map((o, i) => (
            <li
              key={o.value}
              className={`multiselect__option${i === active ? " is-active" : ""}`}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => { e.preventDefault(); choose(o.value); }}
              onMouseMove={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
          {visible.length === 0 && <li className="multiselect__empty" role="presentation">{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}
