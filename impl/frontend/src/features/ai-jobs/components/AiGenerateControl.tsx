"use client";

// AI生成コントロール（モデル選択＋生成ボタンの一体型・分割ボタン・案A）。見た目/クラスの正＝
// doc/画面設計/mocks/style-guide.html「4e」＋ design-system.css の .aigen*。候補は GET /ai-models 駆動
// （会社で有効なキー・候補1でも常設・設計§9.2）。LLM を使う各機能（SC-81 生成・将来③評価等）で再利用。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AiModelItem } from "../types";

type Props = {
  models: AiModelItem[];
  modelKey: string | null;
  onModelChange: (key: string) => void;
  onGenerate: () => void;
  busy?: boolean;       // 生成中（queued/running）＝ラベルを busyLabel に・操作不可
  disabled?: boolean;   // 生成不可（権限無し等）
  label?: string;       // 主ボタン文言（既定「✨ AI で生成する」）
  busyLabel?: string;   // 生成中の文言（既定「生成中…」）
};

export function AiGenerateControl({
  models, modelKey, onModelChange, onGenerate, busy, disabled,
  label = "✨ AI で生成する", busyLabel = "生成中…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);

  const selectedIndex = useMemo(() => models.findIndex((m) => m.key === modelKey), [models, modelKey]);
  const selected = selectedIndex >= 0 ? models[selectedIndex] : null;

  useEffect(() => { if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0); }, [open, selectedIndex]);

  // 外側クリックで閉じる。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && !t.isConnected) return;
      if (rootRef.current && t && !rootRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = useCallback((i: number) => {
    const m = models[i];
    if (m) onModelChange(m.key);
    setOpen(false);
    caretRef.current?.focus();
  }, [models, onModelChange]);

  function onCaretKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % models.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + models.length) % models.length); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  const hasModels = models.length > 0;

  return (
    <div className="aigen">
      <div className="aigen-split" ref={rootRef}>
        <button type="button" className="btn btn-primary aigen-split__main"
          disabled={busy || disabled} onClick={onGenerate}>
          {busy ? busyLabel : label}
        </button>
        {hasModels && (
          <button type="button" className="btn btn-primary aigen-split__caret"
            aria-haspopup="listbox" aria-expanded={open} aria-label="使用モデルを選ぶ"
            disabled={busy || disabled}
            ref={caretRef}
            onClick={() => { if (!busy && !disabled) setOpen((v) => !v); }}
            onKeyDown={onCaretKeyDown}>
            ▾
          </button>
        )}
        {open && hasModels && (
          <ul className="aigen-menu combobox__list" role="listbox" aria-label="使用モデル">
            {models.map((m, i) => (
              <li key={m.key}
                className={`combobox__option${i === active ? " is-active" : ""}`}
                role="option" aria-selected={m.key === modelKey}
                onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                onMouseMove={() => setActive(i)}>
                <span>{m.label}{m.billing === "paid" ? "（有料）" : ""}</span>
                {m.is_default && <span className="aigen-badge">既定</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected && (
        <div className="aigen-sub">モデル：{selected.label} ・ {selected.description}</div>
      )}
    </div>
  );
}
