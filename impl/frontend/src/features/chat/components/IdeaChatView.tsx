"use client";

// SC-24 アイデアチャット＝フラットリスト・コンポーザー（書式/メンション/絵文字/添付）・リアクション（通常＋魔法）・
// ホバーアクション（引用/編集/削除）・複数引用返信・画像ライトボックス・入力欄最小化。
// 正＝doc/画面設計/mocks/SC-24_アイデアチャット.html・doc/画面設計/screens/SC-24_アイデアチャット.md。
// チャット backend 未実装＝デモ fixtures（フロントエンド実装フロー規約＝画面モック先行）。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import "../chat.css";

// パーティーメンバー（@メンション候補）。自分＝山田 太郎
const MEMBERS = ["山田 太郎", "鈴木 花子", "田中 一郎", "佐藤 大輔", "伊藤 彩"];
const ME = "山田 太郎";
const SAMPLE_FILES = ["補足メモ.pdf", "比較表.xlsx", "現地写真.png"];
const EMOJIS = ["👍", "❤️", "😄", "🎉", "🙏", "👀", "🔥", "✨", "😅", "🙌", "💡", "👏", "🤔", "🚀", "✅", "⚠️", "📌", "🎯", "😊", "😢", "🥳", "💪", "🙇", "👌"];
const NORMAL_EMOJIS = ["👍", "❤️", "😄", "🎉", "🙏", "👀"];
type Spell = { id: string; label: string; icon: string; fx: string };
const SPELLS: Spell[] = [
  { id: "fire", label: "炎", icon: "🔥", fx: "spell-fx--fire" },
  { id: "ice", label: "氷", icon: "❄️", fx: "spell-fx--ice" },
  { id: "thunder", label: "雷", icon: "⚡", fx: "spell-fx--thunder" },
  { id: "sparkle", label: "キラキラ", icon: "✨", fx: "spell-fx--sparkle" },
];

type FileChip = { name: string; size?: string; icon?: string };
type GalleryImg = { src: string; alt: string; full: string };
type Reaction = { emoji: string; count: number; mine: boolean; names: string[] };
type Magic = { spellId: string; mine: boolean; by?: string };
type Quote = { name: string; text: string; id: string }; // id＝引用元メッセージのアンカー
type Msg = {
  id: string;
  name: string;
  initial: string;
  isMe: boolean;
  time: string;
  raw: string;
  files: FileChip[];
  gallery: GalleryImg[];
  quotes: Quote[];
  reactions: Reaction[];
  magic?: Magic;
  edited?: boolean;
  deleted?: boolean;
  dayBefore?: string;
  unreadBefore?: boolean;
};

const INITIAL: Msg[] = [
  { id: "m1", name: "田中 一郎", initial: "田", isMe: false, time: "14:20", raw: "積載率の現状値ってどれくらいですか？試算の前提が知りたいです。", files: [], gallery: [], quotes: [], reactions: [], dayBefore: "2026/07/15" },
  { id: "m2", name: "鈴木 花子", initial: "鈴", isMe: false, time: "15:02", raw: "@田中一郎 平均62%です。集約後は80%超を見込んでいます。根拠は添付の試算シート参照。", files: [{ name: "夜間配送_試算シート.xlsx", size: "248KB", icon: "📄" }], gallery: [], quotes: [], reactions: [{ emoji: "👍", count: 2, mine: false, names: ["田中 一郎", "佐藤 大輔"] }, { emoji: "🎉", count: 1, mine: false, names: ["伊藤 彩"] }] },
  { id: "m3", name: "山田 太郎", initial: "山", isMe: true, time: "15:20", raw: "80%はかなり効きますね。パイロットの3拠点はどこを想定していますか？", files: [], gallery: [], quotes: [], reactions: [], magic: { spellId: "thunder", mine: false, by: "田中 一郎" } },
  { id: "m4", name: "鈴木 花子", initial: "鈴", isMe: false, time: "09:12", raw: "@山田太郎 首都圏の東京・川崎・さいたまの3拠点です。距離が近く効果検証しやすいので。イメージ図も貼っておきます。", files: [], gallery: [{ src: "/assets/login-bg.jpg", alt: "ルート集約イメージ図", full: "/assets/login-bg.jpg" }], quotes: [], reactions: [], dayBefore: "2026/07/16", unreadBefore: true },
  { id: "m5", name: "佐藤 大輔", initial: "佐", isMe: false, time: "10:05", raw: "委託先の稼働シフトとの整合だけ **先に確認** したいです。ルート生成 API（`/routes/generate`）は情シスに相談済みですか？ 参考: [ルート生成メモ](https://example.com/route-memo)", files: [], gallery: [], quotes: [], reactions: [], magic: { spellId: "fire", mine: true } },
];

// --- テキスト描画（エスケープ→簡易書式→メンション。mock renderText と同一ロジック） ---
function renderTextHtml(raw: string): string {
  let s = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  const names = MEMBERS.map((n) => n.replace(/\s/g, ""));
  s = s.replace(/@([^\s@]+)/g, (m, name) => {
    if (!names.includes(name)) return m;
    const isMe = name === ME.replace(/\s/g, "");
    return '<span class="mention' + (isMe ? " is-me" : "") + '">@' + name + "</span>";
  });
  return s;
}
function plainText(raw: string): string {
  const html = renderTextHtml(raw);
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
function iconFor(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (ext === "pdf") return "📕";
  if (["doc", "docx"].includes(ext)) return "📄";
  return "📎";
}
function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function autoGrow(ta: HTMLTextAreaElement | null, max = 180) {
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, max) + "px";
}

type Pos = { top: number; left: number };

export function IdeaChatView({ ideaId }: { ideaId: string }) {
  const [messages, setMessages] = useState<Msg[]>(INITIAL);
  const [pendingAtts, setPendingAtts] = useState<string[]>([]);
  const [replyTargets, setReplyTargets] = useState<Quote[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAtts, setEditAtts] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null); // 引用リンクでジャンプした時の一時ハイライト

  // ポップアップ（メンション/絵文字/リアクション）。target はどの textarea/msg を対象にするか。
  const [mention, setMention] = useState<{ pos: Pos; matches: string[]; active: number } | null>(null);
  const [emoji, setEmoji] = useState<{ pos: Pos } | null>(null);
  const [picker, setPicker] = useState<{ pos: Pos; msgId: string } | null>(null);

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const mentionTargetRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiTargetRef = useRef<HTMLTextAreaElement | null>(null);
  const sampleIdxRef = useRef(0);
  const scrollNextRef = useRef(false);

  const mySpellIds = messages.filter((m) => m.magic?.mine).map((m) => m.magic!.spellId);

  // 送信後のみ最下部へスクロール
  useEffect(() => {
    if (!scrollNextRef.current) return;
    scrollNextRef.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages]);

  const updateSendState = useCallback(() => {
    setCanSend((boxRef.current?.value.trim().length ?? 0) > 0 || pendingAtts.length > 0);
  }, [pendingAtts.length]);
  useEffect(() => {
    updateSendState();
  }, [updateSendState]);

  // ---- @メンション候補 ----
  const positionAbove = (el: HTMLElement, h = 0): Pos => {
    const r = el.getBoundingClientRect();
    return { left: window.scrollX + r.left, top: window.scrollY + r.top - h - 4 };
  };
  const updateMention = useCallback((ta: HTMLTextAreaElement) => {
    mentionTargetRef.current = ta;
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = upto.match(/@([^\s@]*)$/);
    if (!m) {
      setMention(null);
      return;
    }
    const q = m[1];
    const matches = MEMBERS.filter((n) => n.replace(/\s/g, "").includes(q));
    if (matches.length === 0) {
      setMention(null);
      return;
    }
    setMention({ pos: positionAbove(ta, 0), matches, active: 0 });
  }, []);
  const hideMention = () => setMention(null);
  const chooseMention = (name: string) => {
    const ta = mentionTargetRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const replaced = ta.value.slice(0, start).replace(/@([^\s@]*)$/, "@" + name.replace(/\s/g, "") + " ");
    ta.value = replaced + ta.value.slice(start);
    ta.focus();
    ta.setSelectionRange(replaced.length, replaced.length);
    hideMention();
    autoGrow(ta, ta === boxRef.current ? 180 : 200);
    updateSendState();
  };
  // 候補が開いている時のキー操作。消費したら true
  const handleMentionKeys = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!mention || !mention.matches.length) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMention((s) => (s ? { ...s, active: (s.active + 1) % s.matches.length } : s));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMention((s) => (s ? { ...s, active: (s.active - 1 + s.matches.length) % s.matches.length } : s));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      chooseMention(mention.matches[mention.active]);
      return true;
    } else if (e.key === "Escape") {
      hideMention();
      return true;
    } else {
      return false;
    }
    return true;
  };

  // ---- 書式ヘルパー（対象 textarea に作用） ----
  const fmtWrap = (ta: HTMLTextAreaElement | null, before: string, after: string, placeholder: string) => {
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || placeholder;
    ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
    ta.focus();
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    autoGrow(ta, ta === boxRef.current ? 180 : 200);
    updateSendState();
  };
  const fmtLink = (ta: HTMLTextAreaElement | null) => {
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || "リンク";
    const ins = "[" + sel + "](https://)";
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
    const urlPos = s + ("[" + sel + "](").length;
    ta.focus();
    ta.setSelectionRange(urlPos, urlPos + "https://".length);
    autoGrow(ta, ta === boxRef.current ? 180 : 200);
    updateSendState();
  };
  const fmtInsert = (ta: HTMLTextAreaElement | null, text: string) => {
    if (!ta) return;
    const s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(s);
    ta.focus();
    ta.setSelectionRange(s + text.length, s + text.length);
    autoGrow(ta, ta === boxRef.current ? 180 : 200);
    updateSendState();
  };

  // ---- 絵文字ピッカー ----
  const toggleEmoji = (anchor: HTMLElement, target: HTMLTextAreaElement | null) => {
    emojiTargetRef.current = target;
    setEmoji((cur) => (cur ? null : { pos: positionAbove(anchor, 240) }));
  };

  // ---- 添付（デモ：サンプルファイルをローテーション） ----
  const nextSample = () => {
    const f = SAMPLE_FILES[sampleIdxRef.current % SAMPLE_FILES.length];
    sampleIdxRef.current++;
    return f;
  };

  // ---- 送信 ----
  const send = () => {
    const ta = boxRef.current;
    const val = ta?.value.trim() ?? "";
    if (!val && pendingAtts.length === 0) return;
    const msg: Msg = {
      id: "u" + Date.now(),
      name: ME,
      initial: "山",
      isMe: true,
      time: nowTime(),
      raw: val,
      files: pendingAtts.map((f) => ({ name: f, icon: "📎" })),
      gallery: [],
      quotes: replyTargets,
      reactions: [],
    };
    scrollNextRef.current = true;
    setMessages((ms) => [...ms, msg]);
    if (ta) {
      ta.value = "";
      autoGrow(ta, 180);
    }
    setPendingAtts([]);
    setReplyTargets([]);
    hideMention();
    setCanSend(false);
  };

  // ---- リアクション（通常） ----
  const toggleReaction = (msgId: string, emojiCh: string) => {
    setMessages((ms) =>
      ms.map((m) => {
        if (m.id !== msgId) return m;
        const idx = m.reactions.findIndex((r) => r.emoji === emojiCh);
        if (idx < 0) return { ...m, reactions: [...m.reactions, { emoji: emojiCh, count: 1, mine: true, names: ["あなた"] }] };
        const r = m.reactions[idx];
        let count = r.count;
        let names = r.names;
        let mine = r.mine;
        if (r.mine) {
          count--;
          mine = false;
          names = names.filter((x) => x !== "あなた");
        } else {
          count++;
          mine = true;
          names = ["あなた", ...names];
        }
        const reactions = [...m.reactions];
        if (count <= 0) reactions.splice(idx, 1);
        else reactions[idx] = { ...r, count, mine, names };
        return { ...m, reactions };
      }),
    );
  };

  // ---- 魔法（各魔法このチャットで1回・1メッセージ1魔法） ----
  const castSpell = (msgId: string, spell: Spell) => {
    if (mySpellIds.includes(spell.id)) return; // その魔法は使用中
    setMessages((ms) =>
      ms.map((m) => (m.id === msgId && !m.magic ? { ...m, magic: { spellId: spell.id, mine: true } } : m)),
    );
  };
  const cancelSpell = (spellId: string) => {
    setMessages((ms) => ms.map((m) => (m.magic?.mine && m.magic.spellId === spellId ? { ...m, magic: undefined } : m)));
  };

  // ---- リアクションピッカー ----
  const openPicker = (msgId: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setPicker({ msgId, pos: { top: window.scrollY + r.bottom + 6, left: window.scrollX + Math.min(r.left, window.innerWidth - 260) } });
  };
  const closePicker = () => setPicker(null);

  // ---- 引用返信（複数可） ----
  const startReply = (m: Msg) => {
    let text = plainText(m.raw);
    if (text.length > 60) text = text.slice(0, 60) + "…";
    // 引用元メッセージ＝リンク先アンカー。同一メッセージの重複引用は避ける（id で判定）。
    setReplyTargets((rt) => (rt.some((t) => t.id === m.id) ? rt : [...rt, { name: m.name, text, id: m.id }]));
    if (collapsed) setCollapsed(false);
    boxRef.current?.focus();
  };
  // 引用文クリックで引用元メッセージへスクロール＋一時ハイライト。二度目も再発火するよう二重 rAF で class を付け直す。
  const jumpToQuote = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    setFlashId(null);
    requestAnimationFrame(() => requestAnimationFrame(() => setFlashId(id)));
  };
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, [flashId]);

  // ---- 編集 / 削除 ----
  const startEdit = (m: Msg) => {
    setEditAtts([]);
    setEditingId(m.id);
  };
  const saveEdit = (m: Msg) => {
    const ta = editRef.current;
    const v = ta?.value.trim() ?? "";
    setMessages((ms) =>
      ms.map((x) => {
        if (x.id !== m.id) return x;
        const files = editAtts.length ? [...x.files, ...editAtts.map((f) => ({ name: f, icon: "📎" }))] : x.files;
        return v ? { ...x, raw: v, edited: true, files } : { ...x, files };
      }),
    );
    setEditingId(null);
    setEditAtts([]);
  };
  const deleteMsg = (m: Msg) => {
    if (!window.confirm("このメッセージを削除しますか？")) return;
    setMessages((ms) =>
      ms.map((x) =>
        x.id === m.id
          ? { ...x, deleted: true, raw: "🗑 このメッセージは削除されました", files: [], gallery: [], quotes: [], reactions: [], magic: undefined }
          : x,
      ),
    );
  };

  // ---- ポップアップの外側クリックで閉じる ----
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (picker && !t.closest(".reaction-picker") && !t.closest(".reaction-add") && !t.closest('[data-act="react"]')) closePicker();
      if (emoji && !t.closest(".emoji-pop") && !t.closest("[data-emoji-anchor]")) setEmoji(null);
      if (mention && !t.closest(".mention-pop") && t !== mentionTargetRef.current) hideMention();
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [picker, emoji, mention]);

  const pickerTarget = picker ? messages.find((m) => m.id === picker.msgId) : null;

  return (
    <main className="container chat-main">
      {/* ============ 文脈バー ============ */}
      <section className="card chat-context" aria-label="対象アイデア">
        <div className="chat-context__body">
          <div className="chat-context__quest">配送ルート最適化 ・ 業務改善</div>
          <div className="chat-context__title">💬 夜間配送の集約による積載率改善</div>
          <div className="chat-context__meta">👥 パーティー6人が参加 ・ 💬 8件</div>
        </div>
        <Link className="btn btn-outline btn-sm" href={`/ideas/${ideaId}`}>
          アイデア詳細を開く
        </Link>
        <Link className="backlink" href={`/ideas/${ideaId}`}>
          ← 戻る
        </Link>
      </section>

      {/* ============ メッセージスレッド ============ */}
      <div className="chat-thread" id="thread">
        {messages.map((m) => (
          <div key={m.id}>
            {m.dayBefore && <div className="chat-day">{m.dayBefore}</div>}
            {m.unreadBefore && <div className="unread-sep">ここから未読</div>}
            <div
              id={m.id}
              className={["msg", m.isMe ? "is-me" : "", m.deleted ? "is-deleted" : "", m.magic ? "spell-fx " + SPELLS.find((s) => s.id === m.magic!.spellId)?.fx : "", flashId === m.id ? "msg--flash" : ""].filter(Boolean).join(" ")}
            >
              <span className="avatar sm">
                <span className="avatar__img placeholder">{m.initial}</span>
              </span>
              <div className="msg__body">
                <div className="msg__head">
                  <span className="msg__name">{m.name}</span>
                  {m.isMe && !m.deleted && <span className="msg__me">（あなた）</span>}
                  <span className="msg__time">{m.time}</span>
                  {m.edited && <span className="msg__edited">（編集済み）</span>}
                </div>

                {/* 引用返信ブロック（複数可）＝引用元メッセージへのアンカーリンク */}
                {m.quotes.map((q, i) => (
                  <a className="msg__quote" href={`#${q.id}`} key={i} onClick={(e) => jumpToQuote(e, q.id)}>
                    <b>{q.name}</b> {q.text}
                  </a>
                ))}

                {/* 本文（編集中はエディタ） */}
                {editingId === m.id ? (
                  <div className="msg__editwrap">
                    {editAtts.length > 0 && (
                      <div className="composer__attachments msg__editatts">
                        {editAtts.map((f, i) => (
                          <span className="att-chip" key={i}>
                            📎 {f}{" "}
                            <button type="button" aria-label="削除" onClick={() => setEditAtts((a) => a.filter((_, j) => j !== i))}>
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="composer__field" style={{ position: "relative" }}>
                      <textarea
                        ref={editRef}
                        className="msg__editbox"
                        defaultValue={m.raw}
                        onInput={(e) => {
                          autoGrow(e.currentTarget, 200);
                          updateMention(e.currentTarget);
                        }}
                        onKeyDown={handleMentionKeys}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                      />
                    </div>
                    <div className="composer__toolbar msg__edittoolbar">
                      <div className="composer__tools">
                        <button className="tbtn" type="button" title="ファイルを添付" aria-label="ファイルを添付" onClick={() => setEditAtts((a) => [...a, nextSample()])}>
                          📎
                        </button>
                        <button className="tbtn" type="button" title="メンション（@）" aria-label="メンション" onClick={(e) => { e.stopPropagation(); fmtInsert(editRef.current, "@"); }}>
                          @
                        </button>
                        <button className="tbtn" type="button" title="絵文字" aria-label="絵文字" data-emoji-anchor onClick={(e) => { e.stopPropagation(); toggleEmoji(e.currentTarget, editRef.current); }}>
                          😀
                        </button>
                        <span className="tbar-sep" aria-hidden="true" />
                        <button className="tbtn" type="button" title="太字（**）" aria-label="太字" onClick={() => fmtWrap(editRef.current, "**", "**", "太字")}>
                          <b>B</b>
                        </button>
                        <button className="tbtn" type="button" title="コード（``）" aria-label="コード" onClick={() => fmtWrap(editRef.current, "`", "`", "code")}>
                          &lt;/&gt;
                        </button>
                        <button className="tbtn" type="button" title="リンク（[text](url)）" aria-label="リンク" onClick={() => fmtLink(editRef.current)}>
                          🔗
                        </button>
                      </div>
                      <div className="msg__editacts">
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => saveEdit(m)}>
                          保存
                        </button>
                        <button className="btn btn-outline btn-sm" type="button" onClick={() => { setEditingId(null); setEditAtts([]); }}>
                          キャンセル
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="msg__text" dangerouslySetInnerHTML={{ __html: renderTextHtml(m.raw) }} />
                )}

                {/* 添付ファイル */}
                {m.files.length > 0 && (
                  <div className="msg__files">
                    {m.files.map((f, i) => (
                      <span className="file-chip" key={i}>
                        <span className="file-icon">{f.icon || iconFor(f.name)}</span>
                        <a href="#">{f.name}</a>
                        {f.size && <span className="muted">{f.size}</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* 添付画像（ギャラリー） */}
                {m.gallery.length > 0 && (
                  <div className="msg__gallery">
                    {m.gallery.map((g, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} className="msg__thumb" src={g.src} alt={g.alt} onClick={() => setLightbox({ src: g.full, alt: g.alt })} />
                    ))}
                  </div>
                )}

                {/* リアクションバー */}
                {!m.deleted && (
                  <div className="reaction-bar">
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        className={"reaction" + (r.mine ? " is-me" : "")}
                        title={r.names.length ? r.names.join("、") + " がリアクション" : "リアクションする"}
                        onClick={() => toggleReaction(m.id, r.emoji)}
                      >
                        {r.emoji} <span className="reaction__count">{r.count}</span>
                      </button>
                    ))}
                    {m.magic && (() => {
                      const spell = SPELLS.find((s) => s.id === m.magic!.spellId)!;
                      return (
                        <button
                          type="button"
                          className={"reaction magic" + (m.magic.mine ? " is-me" : "")}
                          title={m.magic.mine ? spell.label + "魔法（あなた）・クリックで取消" : spell.label + "魔法（" + m.magic.by + "）"}
                          onClick={() =>
                            m.magic!.mine
                              ? cancelSpell(m.magic!.spellId)
                              : window.alert("他の人が付けた魔法は取り消せません。\n1メッセージに付けられる魔法は1個までです。")
                          }
                        >
                          {spell.icon} <span className="reaction__count">1</span>
                        </button>
                      );
                    })()}
                    <button type="button" className="reaction-add" title="リアクション" aria-label="リアクションを追加" onClick={(e) => { e.stopPropagation(); openPicker(m.id, e.currentTarget); }}>
                      ＋
                    </button>
                  </div>
                )}
              </div>

              {/* ホバーアクション */}
              {!m.deleted && (
                <div className="msg__actions">
                  <button className="msg__act" type="button" data-act="react" title="リアクション" aria-label="リアクション" onClick={(e) => { e.stopPropagation(); openPicker(m.id, e.currentTarget); }}>
                    🙂
                  </button>
                  <button className="msg__act" type="button" title="引用返信" aria-label="引用返信" onClick={() => startReply(m)}>
                    💬
                  </button>
                  {m.isMe && (
                    <>
                      <button className="msg__act" type="button" title="編集" aria-label="編集" onClick={() => startEdit(m)}>
                        ✏️
                      </button>
                      <button className="msg__act" type="button" title="削除" aria-label="削除" onClick={() => deleteMsg(m)}>
                        🗑
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ============ 入力欄 ============ */}
      <div className={"composer" + (collapsed ? " is-collapsed" : "")} aria-label="メッセージ入力">
        <button className="composer__mini" type="button" onClick={() => { setCollapsed(false); boxRef.current?.focus(); }}>
          ＋ メッセージを入力…
        </button>

        <div className="composer__full">
          <div className="composer__bar">
            <button className="composer__info" type="button" title="使い方を表示" aria-label="使い方を表示" aria-expanded={hintOpen} onClick={() => setHintOpen((v) => !v)}>
              ⓘ 使い方
            </button>
            <button className="composer__toggle" type="button" title="入力欄を最小化" aria-label="入力欄を最小化" onClick={() => setCollapsed(true)}>
              ⌄ 最小化
            </button>
          </div>

          {/* 引用返信のコンテキスト（複数可・各行✕で個別解除） */}
          {replyTargets.length > 0 && (
            <div className="reply-ctx is-on">
              <div className="reply-ctx__head">引用返信（{replyTargets.length}件）</div>
              {replyTargets.map((t, i) => (
                <div className="reply-ctx__item" key={i}>
                  <span className="reply-ctx__body">
                    <b>{t.name}</b> に返信：{t.text}
                  </span>
                  <button className="reply-ctx__cancel" type="button" aria-label="この引用をやめる" onClick={() => setReplyTargets((rt) => rt.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingAtts.length > 0 && (
            <div className="composer__attachments">
              {pendingAtts.map((f, i) => (
                <span className="att-chip" key={i}>
                  📎 {f}{" "}
                  <button type="button" aria-label="削除" onClick={() => setPendingAtts((a) => a.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="composer__field">
            <textarea
              ref={boxRef}
              className="composer__box"
              rows={1}
              placeholder="メッセージを入力…（@ でメンション、書式は下のツールバー）"
              onInput={(e) => {
                autoGrow(e.currentTarget, 180);
                updateMention(e.currentTarget);
                updateSendState();
              }}
              onKeyDown={(e) => {
                if (handleMentionKeys(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>

          <div className="composer__toolbar">
            <div className="composer__tools">
              <button className="tbtn" type="button" title="ファイルを添付" aria-label="ファイルを添付" onClick={() => setPendingAtts((a) => [...a, nextSample()])}>
                📎
              </button>
              <button className="tbtn" type="button" title="メンション（@）" aria-label="メンション" onClick={(e) => { e.stopPropagation(); fmtInsert(boxRef.current, "@"); }}>
                @
              </button>
              <button className="tbtn" type="button" title="絵文字" aria-label="絵文字" data-emoji-anchor aria-expanded={!!emoji} onClick={(e) => { e.stopPropagation(); toggleEmoji(e.currentTarget, boxRef.current); }}>
                😀
              </button>
              <span className="tbar-sep" aria-hidden="true" />
              <button className="tbtn" type="button" title="太字（**）" aria-label="太字" onClick={() => fmtWrap(boxRef.current, "**", "**", "太字")}>
                <b>B</b>
              </button>
              <button className="tbtn" type="button" title="コード（``）" aria-label="コード" onClick={() => fmtWrap(boxRef.current, "`", "`", "code")}>
                &lt;/&gt;
              </button>
              <button className="tbtn" type="button" title="リンク（[text](url)）" aria-label="リンク" onClick={() => fmtLink(boxRef.current)}>
                🔗
              </button>
            </div>
            <button className="btn btn-primary" type="button" disabled={!canSend} onClick={send}>
              送信
            </button>
          </div>

          {hintOpen && (
            <p className="composer__hint">
              <strong>Enter で送信 / Shift+Enter で改行</strong>。パーティー全員が閲覧・投稿できます（コメント作成権限）。投稿で{" "}
              <span className="xp">+5 XP</span>（日次上限あり）。
              <br />
              ツールバー: 📎添付 ・ <code>@</code>メンション ・ 😀絵文字 ・ <strong>太字</strong>（<code>**</code>）・ コード（<code>``</code>）・ 🔗リンク。空のメッセージは送信できません。
              <br />
              各メッセージにホバーで <strong>アクション</strong>（🙂リアクション/💬引用/自分の投稿は✏️編集・🗑削除）。<strong>魔法リアクション</strong>（SPで解放）はエフェクト付き（例: 🔥炎＝枠が燃える）。<strong>各魔法は1チャットにつき1回</strong>（チップをクリックで取消＝別メッセージへ付け替え可）。<strong>1メッセージに付けられる魔法は1個まで</strong>（他の人が付けていると付けられません）。
            </p>
          )}
        </div>
      </div>

      {/* ============ ポップアップ群 ============ */}
      {mention && (
        <div className="mention-pop" role="listbox" aria-label="メンション候補" style={{ left: mention.pos.left, top: mention.pos.top }}>
          {mention.matches.map((n, i) => (
            <div key={n} className={"mention-opt" + (i === mention.active ? " is-active" : "")} role="option" aria-selected={i === mention.active} onMouseDown={(e) => { e.preventDefault(); chooseMention(n); }}>
              <span className="avatar sm" style={{ ["--avatar-size" as string]: "22px" } as React.CSSProperties}>
                <span className="avatar__img placeholder">{n.charAt(0)}</span>
              </span>
              <span className="mention-opt__name">{n}</span>
            </div>
          ))}
        </div>
      )}

      {emoji && (
        <div className="emoji-pop" role="menu" aria-label="絵文字を挿入" style={{ left: emoji.pos.left, top: emoji.pos.top }}>
          {EMOJIS.map((em) => (
            <button key={em} type="button" onClick={() => { fmtInsert(emojiTargetRef.current, em); setEmoji(null); }}>
              {em}
            </button>
          ))}
        </div>
      )}

      {picker && pickerTarget && (
        <div className="reaction-picker" role="menu" aria-label="リアクションを選ぶ" style={{ left: picker.pos.left, top: picker.pos.top }}>
          <p className="rp__label">リアクション</p>
          <div className="rp__row">
            {NORMAL_EMOJIS.map((em) => (
              <button key={em} type="button" className="rp__emoji" onClick={() => { toggleReaction(picker.msgId, em); closePicker(); }}>
                {em}
              </button>
            ))}
          </div>
          <p className="rp__label">
            魔法 <span className="muted">（各魔法このチャットで1回・1メッセージ1魔法・チップをクリックで取消して付け替え可）</span>
          </p>
          <div className="rp__row">
            {pickerTarget.magic ? (
              <p className="rp__occupied">
                {pickerTarget.magic.mine ? (
                  <>✦ このメッセージには既に<strong>あなたの魔法</strong>が付いています。チップをクリックで取消できます（1メッセージ＝魔法1個）。</>
                ) : (
                  <>✦ このメッセージには既に<strong>他の人の魔法</strong>が付いています。1メッセージに付けられる魔法は1個までです。</>
                )}
              </p>
            ) : (
              SPELLS.map((s) => {
                const used = mySpellIds.includes(s.id);
                return (
                  <button key={s.id} type="button" className="rp__spell" disabled={used} onClick={() => { castSpell(picker.msgId, s); closePicker(); }}>
                    {s.icon} {s.label}
                    {used && <span className="cd">使用中</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 画像ライトボックス */}
      <div className={"lightbox" + (lightbox ? " is-open" : "")} role="dialog" aria-modal="true" aria-label="画像プレビュー" onClick={() => setLightbox(null)}>
        <button className="lightbox__close" type="button" aria-label="閉じる">
          ✕
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {lightbox && <img src={lightbox.src} alt={lightbox.alt} />}
      </div>
    </main>
  );
}
