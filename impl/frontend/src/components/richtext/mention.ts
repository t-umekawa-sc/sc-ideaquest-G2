// 共有 TipTap メンション拡張（チャット＝TT5）。候補はホスト側が渡す（パーティメンバー＋「全員」番兵）。
// サニタイズ中核（app/core/richtext.sanitize_pm）の mention ノード `{id,label}` と整合＝保存時に id/label のみ残る。
// 候補ポップアップは依存を増やさず素の DOM で実装（chat.css の .mention-pop/.mention-opt を再利用）。
import Mention from "@tiptap/extension-mention";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";

export type MentionItem = { id: string; label: string };

// 候補の getter を受け、TipTap Mention を構成して返す（getter は最新候補を返す＝メンバー遅延ロードに追従）。
export function chatMentionExtension(getItems: () => MentionItem[]) {
  return Mention.configure({
    HTMLAttributes: { class: "mention" },
    suggestion: {
      char: "@",
      items: ({ query }) => {
        const q = query.trim().toLowerCase();
        const all = getItems();
        return (q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all).slice(0, 8);
      },
      // 既定 command を上書き（suggestion を差し替えると既定が失われるため）＝mention ノード＋末尾スペースを挿入。
      command: ({ editor, range, props }) => {
        editor.chain().focus().insertContentAt(range, [
          { type: "mention", attrs: { id: props.id, label: props.label } },
          { type: "text", text: " " },
        ]).run();
      },
      render: () => {
        let el: HTMLDivElement | null = null;
        let cur: MentionItem[] = [];
        let active = 0;
        let pick: ((item: MentionItem) => void) | null = null;

        const paint = () => {
          if (!el) return;
          el.innerHTML = "";
          cur.forEach((it, i) => {
            const opt = document.createElement("div");
            opt.className = "mention-opt" + (i === active ? " is-active" : "");
            opt.setAttribute("role", "option");
            opt.setAttribute("aria-selected", String(i === active));
            const av = document.createElement("span");
            av.className = "avatar sm";
            av.style.setProperty("--avatar-size", "22px");
            const ph = document.createElement("span");
            ph.className = "avatar__img placeholder";
            ph.textContent = (it.label || "?").charAt(0);
            av.appendChild(ph);
            const nm = document.createElement("span");
            nm.className = "mention-opt__name";
            nm.textContent = it.label || "（名称未設定）";
            opt.appendChild(av);
            opt.appendChild(nm);
            opt.addEventListener("mousedown", (e) => { e.preventDefault(); pick?.(it); });
            el!.appendChild(opt);
          });
        };
        const place = (rect?: DOMRect | null) => {
          if (!el || !rect) return;
          // キャレット位置の上に出す（下に候補が隠れがちな入力欄＝コンポーザー想定）。
          el.style.position = "absolute";
          el.style.left = `${window.scrollX + rect.left}px`;
          el.style.top = `${window.scrollY + rect.top}px`;
          el.style.transform = "translateY(-100%)";
        };

        return {
          onStart: (props: SuggestionProps<MentionItem, MentionItem>) => {
            cur = props.items; active = 0;
            pick = (it) => props.command(it);
            el = document.createElement("div");
            el.className = "mention-pop";
            el.setAttribute("role", "listbox");
            el.setAttribute("aria-label", "メンション候補");
            document.body.appendChild(el);
            paint();
            place(props.clientRect?.());
          },
          onUpdate: (props: SuggestionProps<MentionItem, MentionItem>) => {
            cur = props.items; active = 0;
            pick = (it) => props.command(it);
            paint();
            place(props.clientRect?.());
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
            if (!cur.length) return false;
            const k = props.event.key;
            if (k === "ArrowDown") { active = (active + 1) % cur.length; paint(); return true; }
            if (k === "ArrowUp") { active = (active - 1 + cur.length) % cur.length; paint(); return true; }
            if (k === "Enter" || k === "Tab") { pick?.(cur[active]); return true; }
            if (k === "Escape") { return true; }
            return false;
          },
          onExit: () => { el?.remove(); el = null; cur = []; pick = null; },
        };
      },
    },
  });
}
