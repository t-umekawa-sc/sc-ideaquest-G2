"use client";

// SC-24 アイデアチャット（E 実接続）＝フラットリスト・コンポーザー（書式/メンション/絵文字/添付）・
// リアクション（通常＋魔法）・引用返信（単一・backend 契約）・編集/削除・既読・活発度。
// 正＝doc/画面設計/mocks/SC-24_アイデアチャット.html・screens/SC-24・API設計 E.1〜E.5/G（魔法解放）。
// 実接続: getChat（一覧＋未読）・getIdea（文脈＋comment 権限＋completed）・getPartyMembers（@候補）・getSpells（魔法）。
// 送信/編集/削除/既読/リアクション/魔法はサーバー権威（403/409/422 は理由トースト）。引用返信は複数可（quoted_message_ids[]・§5.16b）。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, Spinner, useConfirm, useSnackbar, SpellCastFx, SpellDeliveryFx, SpellPersistFx, SpellCanvasFx, type CastRect, type CastPoint } from "@/components/ui";
import { isCanvasEffect } from "@/features/spells/engines";
import { ApiError } from "@/lib/api/client";
import { realtime } from "@/lib/realtime";
import { reduceMotion } from "@/lib/motion";
import { getAttachmentDownloadUrl, getIdea, type IdeaDetail } from "@/features/ideas/api";

import {
  addReaction,
  deleteMessage,
  editMessage,
  getChat,
  getPartyMembers,
  getSpells,
  markRead,
  postMessage,
  removeReaction,
  type ChatMessage,
  type Spell,
} from "../api";
import "../chat.css";

const NORMAL_EMOJIS = ["👍", "❤️", "😄", "🎉", "🙏", "👀"];
const EMOJIS = ["👍", "❤️", "😄", "🎉", "🙏", "👀", "🔥", "✨", "😅", "🙌", "💡", "👏", "🤔", "🚀", "✅", "⚠️", "📌", "🎯"];
// エフェクト種別→CSS（魔法エフェクト・design-system.css の spell-fx--*）。6 種を各々の見た目に（#10 で rainbow/aura を実効化）。
const FX: Record<string, string> = { fire: "spell-fx--fire", ice: "spell-fx--ice", thunder: "spell-fx--thunder", sparkle: "spell-fx--sparkle", rainbow: "spell-fx--rainbow", aura: "spell-fx--aura" };
// 発動者バッジの hover ツールチップ用の属性和名（style-guide.html §17 の「…が【炎】をかけました」に合わせる）。
const SPELL_JA: Record<string, string> = { fire: "炎", ice: "氷", thunder: "雷", sparkle: "キラキラ", rainbow: "虹", aura: "オーラ" };

type Member = { user_id: string; name: string; nospace: string };

function iconFor(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (ext === "pdf") return "📕";
  if (["doc", "docx"].includes(ext)) return "📄";
  return "📎";
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function autoGrow(ta: HTMLTextAreaElement | null, max = 180) {
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, max) + "px";
}
// エスケープ→簡易書式（太字/コード/リンク）→メンション（members に一致する @token を強調）。
function renderTextHtml(raw: string, members: Member[]): string {
  let s = (raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  const names = members.map((m) => m.nospace);
  s = s.replace(/@([^\s@]+)/g, (m, name) => (names.includes(name) ? `<span class="mention">@${name}</span>` : m));
  return s;
}

type Pos = { top: number; left: number };

export function IdeaChatView({ ideaId }: { ideaId: string }) {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstUnread, setFirstUnread] = useState<string | null>(null);
  const [chatGroupId, setChatGroupId] = useState<string | null>(null);
  const [ctxOpen, setCtxOpen] = useState(true); // 上部の文脈パネルの開閉（たたむと右に戻るリンクだけ残す）
  const [hintOpen, setHintOpen] = useState(false);   // 使い方ヒントの開閉（SC-24 モック）
  const [composerMin, setComposerMin] = useState(false); // 入力欄の最小化（SC-24 モック）
  const [emojiOpen, setEmojiOpen] = useState(false);  // コンポーザーの絵文字ピッカー
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [replyTargets, setReplyTargets] = useState<{ id: string; name: string; text: string }[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mention, setMention] = useState<{ pos: Pos; matches: Member[]; active: number } | null>(null);
  const [picker, setPicker] = useState<{ pos: Pos; msgId: string } | null>(null);
  // #10: 魔法発動の瞬間演出（対象メッセージ矩形に one-shot・自分の発動のみ・reduce-motion 尊重）。
  const [casts, setCasts] = useState<{ id: number; rect: CastRect; effect: string; rarity: string }[]>([]);
  // Phase B: 発射元→対象メッセージへ飛ぶデリバリー（属性別・GF-AC-091 §17）。着弾で one-shot(SpellCastFx) に接続。
  const [delivers, setDelivers] = useState<{ id: number; from: CastPoint; to: CastPoint; effect: string; rarity: string }[]>([]);
  // Phase E: canvas 化済み effect（sparkle 等）の能動発動＝そのメッセージ canvas に「発射→着弾→永続」を再生させる。
  // key=msgId が存在＝今セッションで能動発動した（発射を再生する）／値＝発射元の画面座標。CSS の deliver/cast は使わない。
  const [canvasCast, setCanvasCast] = useState<Record<string, CastPoint | null>>({});
  const castId = useRef(0);
  const fireCast = (msgId: string, effect: string, rarity: string) => {
    if (reduceMotion()) return;
    const el = typeof document !== "undefined" ? document.getElementById(msgId) : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const id = ++castId.current;
    setCasts((c) => [...c, { id, rect: { top: r.top, left: r.left, width: r.width, height: r.height }, effect, rarity }]);
    setTimeout(() => setCasts((c) => c.filter((z) => z.id !== id)), 1000);
  };
  // 発射元 from（発動した魔法ボタン位置）→対象メッセージ中央へ飛ばし、着弾(約420ms)で fireCast を発火。
  const DELIVER_MS = 420;
  const fireDelivery = (from: CastPoint, msgId: string, effect: string, rarity: string) => {
    if (reduceMotion()) { fireCast(msgId, effect, rarity); return; }
    const el = typeof document !== "undefined" ? document.getElementById(msgId) : null;
    if (!el) { fireCast(msgId, effect, rarity); return; }
    const r = el.getBoundingClientRect();
    const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const id = ++castId.current;
    setDelivers((d) => [...d, { id, from, to, effect, rarity }]);
    setTimeout(() => setDelivers((d) => d.filter((z) => z.id !== id)), DELIVER_MS + 260);
    setTimeout(() => fireCast(msgId, effect, rarity), DELIVER_MS); // 着弾＝一撃＋永続へ
  };
  // 発動起点＝ヘッダーのログインユーザーアバター中心（画面座標）。ログインユーザが「新規に」魔法を発動した瞬間の
  // 発射元（style-guide.html §17 の「自分が放つ」演出／起点ポリシーは doc/画面設計/screens/SC-24_アイデアチャット.md）。
  const headerAvatarPoint = (): CastPoint | null => {
    if (typeof document === "undefined") return null;
    const el = document.querySelector(".usermenu__trigger .avatar") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mentionTaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollNextRef = useRef(false);

  const completed = idea?.quest?.status === "completed";
  const canPost = !completed && !!idea && (idea.my_permissions?.includes("comment") ?? false);
  const unlockedSpellIds = new Set(spells.filter((s) => s.unlocked).map((s) => s.id));
  const myMagicSpellIds = new Set(
    messages.filter((m) => m.reactions && (m.reactions as { magic?: { mine?: boolean; spell_id?: string } }).magic?.mine)
      .map((m) => (m.reactions as { magic?: { spell_id?: string } }).magic!.spell_id!),
  );

  const load = useCallback(async () => {
    try {
      const [d, chat] = await Promise.all([getIdea(ideaId), getChat(ideaId)]);
      if (!d || !chat) {
        setLoadError("このチャットは見つからないか、参照する権限がありません。");
        return;
      }
      setIdea(d);
      setMessages(chat.data);
      setChatGroupId(chat.chat_group_id);
      setFirstUnread(chat.unread?.first_unread_message_id ?? null);
      setLoadError(null);
      // メンション候補・魔法カタログ（非致命）。
      void getPartyMembers(d.quest.id).then((r) =>
        // 応答は `{ user: {user_id, display_name} }`（ネスト）。以前フラット想定で name が undefined になり @ でクラッシュしていた。
        setMembers((r?.data ?? []).map((m) => ({ user_id: m.user.user_id, name: m.user.display_name ?? "", nospace: (m.user.display_name || "").replace(/\s/g, "") }))),
      ).catch(() => {});
      void getSpells().then((r) => setSpells(r?.data ?? [])).catch(() => {});
      // 既読を最新まで前進。
      const last = chat.data[chat.data.length - 1];
      if (last) void markRead(ideaId, last.id).catch(() => {});
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 401 ? "セッションが切れています。再ログインしてください。" : "チャットの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [ideaId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!scrollNextRef.current) return;
    scrollNextRef.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages]);

  const refetch = useCallback(async () => {
    const chat = await getChat(ideaId);
    if (chat) setMessages(chat.data);
  }, [ideaId]);

  // リアルタイム（L）＝chat:{chat_group_id} を購読し、新着/編集/削除/リアクションで再取得（REST が真実）。
  useEffect(() => {
    if (!chatGroupId) return;
    realtime.start();
    const topic = `chat:${chatGroupId}`;
    realtime.subscribe(topic);
    const off = realtime.onTopic(topic, () => { void refetch(); });
    return () => { off(); realtime.unsubscribe(topic); };
  }, [chatGroupId, refetch]);

  const updateSendState = useCallback(() => {
    setCanSend((boxRef.current?.value.trim().length ?? 0) > 0 || pendingFiles.length > 0);
  }, [pendingFiles.length]);
  useEffect(() => { updateSendState(); }, [updateSendState]);

  // ---- @メンション候補 ----
  const posAbove = (el: HTMLElement): Pos => {
    const r = el.getBoundingClientRect();
    return { left: window.scrollX + r.left, top: window.scrollY + r.top - 4 };
  };
  const updateMention = useCallback((ta: HTMLTextAreaElement) => {
    mentionTaRef.current = ta;
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = upto.match(/@([^\s@]*)$/);
    if (!m) return setMention(null);
    const q = m[1];
    const matches = members.filter((n) => n.nospace.includes(q));
    if (!matches.length) return setMention(null);
    setMention({ pos: posAbove(ta), matches, active: 0 });
  }, [members]);
  const chooseMention = (mem: Member) => {
    const ta = mentionTaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const replaced = ta.value.slice(0, start).replace(/@([^\s@]*)$/, "@" + mem.nospace + " ");
    ta.value = replaced + ta.value.slice(start);
    ta.focus();
    ta.setSelectionRange(replaced.length, replaced.length);
    setMention(null);
    autoGrow(ta, ta === boxRef.current ? 180 : 200);
    updateSendState();
  };
  // 書式ツールバー＝選択範囲を before/after で囲む（未選択はカーソル位置に挿入）。本文は renderTextHtml が
  // **太字**/`コード`/[text](url)/@メンション を描画するのでそのまま反映される。
  const insertFmt = (before: string, after = "") => {
    const ta = boxRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    const inserted = before + sel + after;
    ta.value = ta.value.slice(0, s) + inserted + ta.value.slice(e);
    ta.focus();
    // 選択があれば末尾、無ければ before の直後（囲みの中）にキャレット。
    const caret = sel ? s + inserted.length : s + before.length;
    ta.setSelectionRange(caret, caret);
    autoGrow(ta, 180);
    updateSendState();
  };
  const insertMentionAt = () => { insertFmt("@"); if (boxRef.current) updateMention(boxRef.current); };
  const insertEmoji = (em: string) => { insertFmt(em); setEmojiOpen(false); };
  const handleMentionKeys = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!mention || !mention.matches.length) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setMention((s) => (s ? { ...s, active: (s.active + 1) % s.matches.length } : s)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setMention((s) => (s ? { ...s, active: (s.active - 1 + s.matches.length) % s.matches.length } : s)); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); chooseMention(mention.matches[mention.active]); return true; }
    else if (e.key === "Escape") { setMention(null); return true; }
    else return false;
    return true;
  };
  // 本文の @token を members の user_id に解決（メンション送信用）。
  const extractMentionIds = (body: string): string[] => {
    const ids = new Set<string>();
    for (const m of body.matchAll(/@([^\s@]+)/g)) {
      const mem = members.find((x) => x.nospace === m[1]);
      if (mem) ids.add(mem.user_id);
    }
    return [...ids];
  };

  // ---- 送信 ----
  const send = async () => {
    const ta = boxRef.current;
    const body = ta?.value.trim() ?? "";
    if ((!body && pendingFiles.length === 0) || sending || !canPost) return;
    setSending(true);
    try {
      await postMessage(ideaId, { body, quotedMessageIds: replyTargets.map((r) => r.id), mentions: extractMentionIds(body), files: pendingFiles });
      if (ta) { ta.value = ""; autoGrow(ta, 180); }
      setPendingFiles([]);
      setReplyTargets([]);
      setCanSend(false);
      scrollNextRef.current = true;
      await refetch();
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      snack({ type: "error", msg: st === 403 ? "投稿する権限がありません。" : st === 409 ? "完了したクエストには投稿できません。" : st === 422 ? "本文か添付が必要です。" : "送信に失敗しました。" });
    } finally {
      setSending(false);
    }
  };

  // ---- 編集 / 削除 ----
  const saveEdit = async (m: ChatMessage) => {
    const v = editRef.current?.value.trim() ?? "";
    try {
      await editMessage(m.id, { body: v, mentions: extractMentionIds(v) });
      setEditingId(null);
      await refetch();
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      snack({ type: "error", msg: st === 403 ? "自分のメッセージのみ編集できます。" : st === 409 ? "完了/削除済みのため編集できません。" : "編集に失敗しました。" });
    }
  };
  const removeMsg = async (m: ChatMessage) => {
    if (!(await confirm({ variant: "danger", title: "メッセージを削除", msg: "このメッセージを削除します。", confirmLabel: "削除する" }))) return;
    try {
      await deleteMessage(m.id);
      await refetch();
      snack({ type: "info", msg: "メッセージを削除しました。" });
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      snack({ type: "error", msg: st === 403 ? "削除する権限がありません。" : st === 409 ? "完了したクエストでは削除できません。" : "削除に失敗しました。" });
    }
  };

  // ---- 添付ダウンロード（署名URL・D.3 共通 EP） ----
  const download = async (attachmentId: string) => {
    try {
      const res = await getAttachmentDownloadUrl(attachmentId);
      if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
    } catch {
      snack({ type: "error", msg: "ダウンロードに失敗しました。" });
    }
  };

  // ---- リアクション（通常） ----
  const toggleReaction = async (m: ChatMessage, emoji: string) => {
    const normal = ((m.reactions as { normal?: Array<{ emoji: string; reacted_by_me: boolean }> })?.normal) ?? [];
    const mine = normal.find((n) => n.emoji === emoji)?.reacted_by_me;
    try {
      const res = mine ? await removeReaction(m.id, { emoji }) : await addReaction(m.id, { type: "normal", emoji });
      if (res) setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x)));
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      snack({ type: "error", msg: st === 409 ? "完了したクエストではリアクションできません。" : "リアクションに失敗しました。" });
    }
    setPicker(null);
  };

  // ---- 魔法 ----
  const castSpell = async (m: ChatMessage, spell: Spell, from?: CastPoint) => {
    try {
      const res = await addReaction(m.id, { type: "magic", spell_id: spell.id });
      if (res) {
        setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x)));
        // 発動の瞬間演出（発火は成功時のみ・種別はサーバー応答の effect 優先→spell.effect）。
        const eff = (res.reactions as { magic?: { effect?: string } })?.magic?.effect ?? spell.effect;
        if (isCanvasEffect(eff)) {
          // canvas 化済み＝そのメッセージの canvas が発射→着弾→永続を1枚で再生（CSS deliver/cast は使わない）。
          // 起点ポリシー（doc/画面設計/screens/SC-24_アイデアチャット.md）＝ログインユーザが「新規に」発動した瞬間は
          // ヘッダーのユーザーアバターから飛来（style-guide.html §17 の「自分が放つ」演出）。取得できなければ
          // エンジン既定の起点（枠の右上＝術者位置）にフォールバック（＝受入済みモック §17L-b の発動を再現）。
          setCanvasCast((c) => ({ ...c, [m.id]: headerAvatarPoint() }));
        } else if (from) {
          // 発射元（発動した魔法ボタン位置）があれば from→対象へ飛ばし着弾で一撃、無ければ即一撃（GF-AC-091）。
          fireDelivery(from, m.id, eff, spell.rarity);
        } else {
          fireCast(m.id, eff, spell.rarity);
        }
      }
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      snack({ type: "error", msg: st === 403 ? "この魔法は未解放です（SC-32 で解放）。" : st === 409 ? "この魔法は使用済みか、既に魔法が付いています。" : "魔法の発動に失敗しました。" });
    }
    setPicker(null);
  };
  const cancelSpell = async (m: ChatMessage) => {
    try {
      const res = await removeReaction(m.id, { magic: true });
      if (res) {
        setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x)));
        setCanvasCast((c) => { if (!(m.id in c)) return c; const n = { ...c }; delete n[m.id]; return n; });
      }
    } catch {
      snack({ type: "error", msg: "魔法の取消に失敗しました。" });
    }
  };

  const openPicker = (msgId: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setPicker({ msgId, pos: { top: window.scrollY + r.bottom + 6, left: window.scrollX + Math.min(r.left, window.innerWidth - 260) } });
  };

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (picker && !t.closest(".reaction-picker") && !t.closest(".reaction-add") && !t.closest('[data-act="react"]')) setPicker(null);
      if (mention && !t.closest(".mention-pop") && t !== mentionTaRef.current) setMention(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [picker, mention]);

  if (loading) {
    return <main className="container chat-main"><Spinner label="読み込み中…" /></main>;
  }
  if (loadError || !idea) {
    return (
      <main className="container chat-main">
        <Link className="backlink" href={`/ideas/${ideaId}`}>← 戻る</Link>
        <div className="form-error" role="alert" style={{ marginTop: "var(--space-4)" }}>{loadError ?? "見つかりません。"}</div>
      </main>
    );
  }

  const pickerTarget = picker ? messages.find((m) => m.id === picker.msgId) : null;
  let lastDay = "";

  return (
    <main className="container chat-main">
      {/* #10/Phase B: 発射元→対象へ飛ぶデリバリー（属性別）＋着弾の瞬間演出（固定オーバーレイ・自分の発動時のみ） */}
      {delivers.map((d) => <SpellDeliveryFx key={d.id} from={d.from} to={d.to} effect={d.effect} rarity={d.rarity} />)}
      {casts.map((c) => <SpellCastFx key={c.id} rect={c.rect} effect={c.effect} rarity={c.rarity} />)}
      {/* 文脈パネル（戻るリンク含む）自体をフローティング（sticky）で常時上部に表示（デザイン標準 §4.10）。
          折りたたみ可能＝たたむと薄いバーになり、右側に戻るリンクだけ残す。 */}
      <section className={`card chat-context chat-context--float${ctxOpen ? "" : " is-collapsed"}`} aria-label="対象アイデア">
        <button
          type="button"
          className="chat-context__toggle"
          aria-expanded={ctxOpen}
          aria-label={ctxOpen ? "パネルをたたむ" : "パネルを開く"}
          onClick={() => setCtxOpen((v) => !v)}
        >
          {ctxOpen ? "▲" : "▼"}
        </button>
        {ctxOpen ? (
          <>
            <div className="chat-context__body">
              <div className="chat-context__quest">{idea.quest.title}{idea.quest.categories?.[0] ? ` ・ ${idea.quest.categories[0]}` : ""}</div>
              <div className="chat-context__title">💬 {idea.title}</div>
              <div className="chat-context__meta">💬 {messages.filter((m) => !m.is_deleted).length}件{completed ? " ・ ⏸ 完了（凍結）" : ""}</div>
            </div>
            <Link className="btn btn-outline btn-sm" href={`/ideas/${ideaId}`}>アイデア詳細を開く</Link>
            <Link className="backlink" href={`/ideas/${ideaId}`}>← 戻る</Link>
          </>
        ) : (
          // たたんだ状態＝コンパクトなタイトル（左）＋右端に戻るリンク。
          <>
            <span className="chat-context__mini">💬 {idea.title}</span>
            <Link className="backlink chat-context__back" href={`/ideas/${ideaId}`}>← 戻る</Link>
          </>
        )}
      </section>

      {/* スレッド */}
      <div className="chat-thread" id="thread">
        {messages.length === 0 && <EmptyState icon="💬" title="まだコメントはありません" hint="最初のコメントを投稿しましょう。" />}
        {messages.map((m) => {
          const day = fmtDay(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const magic = (m.reactions as { magic?: { spell_id: string; effect?: string; icon?: string; actor?: string; mine?: boolean } })?.magic ?? null;
          const normal = ((m.reactions as { normal?: Array<{ emoji: string; count: number; reacted_by_me: boolean; users?: string[] }> })?.normal) ?? [];
          // 自作自演＝発動者==作成者（§17 の4パターン④）。発動者バッジは出さず作成者アバターに✦。
          const selfCast = !!magic && (magic.mine ? m.is_mine : magic.actor != null && magic.actor === m.author?.name);
          const casterName = magic?.actor || (magic?.mine ? "あなた" : "");
          const spellJa = SPELL_JA[magic?.effect ?? ""] ?? "魔法";
          return (
            // #17: key=id なので新着メッセージだけが mount＝CSS で登場（既存は再利用され再生しない）。
            <div key={m.id} className="msg-row">
              {showDay && <div className="chat-day">{day}</div>}
              {firstUnread === m.id && <div className="unread-sep">ここから未読</div>}
              <div id={m.id} className={["msg", m.is_mine ? "is-me" : "", m.is_deleted ? "is-deleted" : "", magic ? "spell-fx " + (FX[magic.effect ?? ""] ?? "") : ""].filter(Boolean).join(" ")}>
                {/* Phase D/E: 属性別の永続装飾を枠に重ねる。基調グロー/ボーダーは spell-fx--* クラスが担う。
                    canvas 化済み effect（sparkle 等）は SpellCanvasFx（発射→着弾→永続を1枚）、それ以外は従来 CSS の SpellPersistFx。 */}
                {magic && (isCanvasEffect(magic.effect ?? "")
                  ? <SpellCanvasFx effect={magic.effect ?? ""} justCast={m.id in canvasCast} castFrom={canvasCast[m.id]} originSelector={selfCast ? ".msg__author" : ".msg__caster"} />
                  : <SpellPersistFx effect={magic.effect ?? ""} />)}
                <span className={"avatar sm msg__author" + (selfCast ? " is-selfcast" : "")}><span className="avatar__img placeholder">{(m.author?.name || "?").charAt(0)}</span></span>
                {/* 発動者アバターバッジ（§17 の「発動者→作成者」＝右上バッジ）。自作自演は出さない（作成者に✦）。 */}
                {magic && !selfCast && (
                  <span className="msg__caster avatar sm" data-name={casterName} title={`${casterName} が【${spellJa}】をかけました`} aria-hidden>
                    <span className="avatar__img placeholder">{(casterName || "?").charAt(0)}</span>
                  </span>
                )}
                <div className="msg__body">
                  <div className="msg__head">
                    <span className="msg__name">{m.is_deleted ? "" : m.author?.name}</span>
                    {m.is_mine && !m.is_deleted && <span className="msg__me">（あなた）</span>}
                    <span className="msg__time">{fmtTime(m.created_at)}</span>
                    {m.is_edited && <span className="msg__edited">（編集済み）</span>}
                  </div>

                  {((m.quotes as Array<{ id: string; author_name?: string; excerpt?: string }> | undefined) ?? []).map((q, i) => (
                    <a className="msg__quote" href={`#${q.id}`} key={i}>
                      <b>{q.author_name}</b> {q.excerpt}
                    </a>
                  ))}

                  {editingId === m.id ? (
                    <div className="msg__editwrap">
                      <div className="composer__field" style={{ position: "relative" }}>
                        <textarea ref={editRef} className="msg__editbox" defaultValue={m.body ?? ""} onInput={(e) => { autoGrow(e.currentTarget, 200); updateMention(e.currentTarget); }} onKeyDown={handleMentionKeys}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus />
                      </div>
                      <div className="msg__editacts" style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => void saveEdit(m)}>保存</button>
                        <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditingId(null)}>キャンセル</button>
                      </div>
                    </div>
                  ) : m.is_deleted ? (
                    <p className="msg__text">🗑 このメッセージは削除されました</p>
                  ) : (
                    <p className="msg__text" dangerouslySetInnerHTML={{ __html: renderTextHtml(m.body ?? "", members) }} />
                  )}

                  {(m.attachments ?? []).length > 0 && (
                    <div className="msg__files">
                      {(m.attachments ?? []).map((f) => (
                        <span className="file-chip" key={f.id}>
                          <span className="file-icon">{f.kind === "image" ? "🖼️" : iconFor(f.original_name)}</span>
                          <button type="button" className="linklike" onClick={() => void download(f.id)}>{f.original_name}</button>
                        </span>
                      ))}
                    </div>
                  )}

                  {!m.is_deleted && (
                    <div className="reaction-bar">
                      {normal.map((r) => (
                        <button key={r.emoji} type="button" className={"reaction" + (r.reacted_by_me ? " is-me" : "")} title={(r.users ?? []).join("、")} disabled={completed} onClick={() => void toggleReaction(m, r.emoji)}>
                          {r.emoji} <span className="reaction__count">{r.count}</span>
                        </button>
                      ))}
                      {magic && (
                        <button type="button" className={"reaction magic" + (magic.mine ? " is-me" : "")} title={magic.mine ? "あなたの魔法・クリックで取消" : `${magic.actor} の魔法`} disabled={completed} onClick={() => (magic.mine ? void cancelSpell(m) : undefined)}>
                          {magic.icon} <span className="reaction__count">1</span>
                        </button>
                      )}
                      {!completed && (
                        <button type="button" className="reaction-add" aria-label="リアクションを追加" onClick={(e) => { e.stopPropagation(); openPicker(m.id, e.currentTarget); }}>＋</button>
                      )}
                    </div>
                  )}
                </div>

                {!m.is_deleted && !completed && (
                  <div className="msg__actions">
                    <button className="msg__act" type="button" data-act="react" aria-label="リアクション" onClick={(e) => { e.stopPropagation(); openPicker(m.id, e.currentTarget); }}>🙂</button>
                    <button className="msg__act" type="button" aria-label="引用返信" onClick={() => { setReplyTargets((rt) => (rt.some((t) => t.id === m.id) ? rt : [...rt, { id: m.id, name: m.author?.name || "", text: (m.body || "").slice(0, 60) }])); boxRef.current?.focus(); }}>💬</button>
                    {m.is_mine && (
                      <>
                        <button className="msg__act" type="button" aria-label="編集" onClick={() => setEditingId(m.id)}>✏️</button>
                        <button className="msg__act" type="button" aria-label="削除" onClick={() => void removeMsg(m)}>🗑</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 入力欄 */}
      <div className={`composer${composerMin ? " is-collapsed" : ""}`} aria-label="メッセージ入力">
        {/* 最小化時のスリムバー（クリックで展開）＝SC-24 モック */}
        {canPost && (
          <button className="composer__mini" type="button" onClick={() => setComposerMin(false)}>＋ メッセージを入力…</button>
        )}
        <div className="composer__full">
          {!canPost && (
            <p className="role-note" style={{ margin: 0 }}>
              {completed ? "このクエストは完了済みのため投稿は締め切られています。" : "投稿するにはコメント作成権限が必要です。"}
            </p>
          )}
          {canPost && (
            <>
              {/* 使い方／最小化（右寄せ・独立行）＝SC-24 モック */}
              <div className="composer__bar">
                <button className="composer__info" type="button" aria-expanded={hintOpen} aria-controls="composerHint" title="使い方を表示" onClick={() => setHintOpen((v) => !v)}>ⓘ 使い方</button>
                <button className="composer__toggle" type="button" title="入力欄を最小化" aria-label="入力欄を最小化" onClick={() => setComposerMin(true)}>⌄ 最小化</button>
              </div>
              {replyTargets.length > 0 && (
                <div className="reply-ctx is-on">
                  <div className="reply-ctx__head">引用返信（{replyTargets.length}件）</div>
                  {replyTargets.map((t, i) => (
                    <div className="reply-ctx__item" key={t.id}>
                      <span className="reply-ctx__body"><b>{t.name}</b> に返信：{t.text}</span>
                      <button className="reply-ctx__cancel" type="button" aria-label="この引用をやめる" onClick={() => setReplyTargets((rt) => rt.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {pendingFiles.length > 0 && (
                <div className="composer__attachments">
                  {pendingFiles.map((f, i) => (
                    <span className="att-chip" key={i}>📎 {f.name}{" "}
                      <button type="button" aria-label="削除" onClick={() => setPendingFiles((a) => a.filter((_, j) => j !== i))}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="composer__field">
                <textarea ref={boxRef} className="composer__box" rows={1} placeholder="メッセージを入力…（@ でメンション、書式は下のツールバー）"
                  onInput={(e) => { autoGrow(e.currentTarget, 180); updateMention(e.currentTarget); updateSendState(); }}
                  onKeyDown={(e) => { if (handleMentionKeys(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                {/* コンポーザーの絵文字ピッカー（本文へ挿入） */}
                {emojiOpen && (
                  <div className="emoji-pop" role="menu" aria-label="絵文字を挿入">
                    {EMOJIS.map((em) => (
                      <button key={em} type="button" onClick={() => insertEmoji(em)}>{em}</button>
                    ))}
                  </div>
                )}
              </div>
              {/* ツールバー: 左＝書式/アクション、右＝送信（SC-24 モック） */}
              <div className="composer__toolbar">
                <div className="composer__tools">
                  <input ref={fileRef} type="file" multiple hidden onChange={(e) => {
                    // ファイルを**先に取り出す**。setPendingFiles の updater は遅延実行で、その前に value="" で
                    // input をクリアすると updater 内の e.target.files が空になり添付が積まれない不具合だった。
                    const picked = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = ""; // 同じファイルを再選択できるようクリア
                    if (picked.length) setPendingFiles((a) => [...a, ...picked]);
                    updateSendState();
                  }} />
                  <button className="tbtn" type="button" aria-label="ファイルを添付" title="ファイルを添付" onClick={() => fileRef.current?.click()}>📎</button>
                  <button className="tbtn" type="button" aria-label="メンション" title="メンション（@）" onClick={insertMentionAt}>@</button>
                  <button className={`tbtn${emojiOpen ? " is-on" : ""}`} type="button" aria-label="絵文字" title="絵文字" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((v) => !v)}>😀</button>
                  <span className="tbar-sep" aria-hidden="true" />
                  <button className="tbtn" type="button" aria-label="太字" title="太字（**）" onClick={() => insertFmt("**", "**")}><b>B</b></button>
                  <button className="tbtn" type="button" aria-label="コード" title="コード（``）" onClick={() => insertFmt("`", "`")}>&lt;/&gt;</button>
                  <button className="tbtn" type="button" aria-label="リンク" title="リンク（[text](url)）" onClick={() => insertFmt("[", "](https://)")}>🔗</button>
                </div>
                <button className="btn btn-primary" type="button" disabled={!canSend || sending} onClick={() => void send()}>{sending ? "送信中…" : "送信"}</button>
              </div>
              {hintOpen && (
                <p className="composer__hint" id="composerHint">
                  <strong>Enter で送信 / Shift+Enter で改行</strong>。パーティー全員が閲覧・投稿できます（コメント作成権限）。投稿で <span className="xp">+5 XP</span>（日次上限あり）。<br />
                  ツールバー: 📎添付 ・ <code>@</code>メンション ・ 😀絵文字 ・ <strong>太字</strong>（<code>**</code>）・ コード（<code>``</code>）・ 🔗リンク。空のメッセージは送信できません。
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* メンション候補 */}
      {mention && (
        <div className="mention-pop" role="listbox" aria-label="メンション候補" style={{ left: mention.pos.left, top: mention.pos.top }}>
          {mention.matches.map((n, i) => (
            <div key={n.user_id} className={"mention-opt" + (i === mention.active ? " is-active" : "")} role="option" aria-selected={i === mention.active} onMouseDown={(e) => { e.preventDefault(); chooseMention(n); }}>
              <span className="avatar sm" style={{ ["--avatar-size" as string]: "22px" } as React.CSSProperties}><span className="avatar__img placeholder">{(n.name || "?").charAt(0)}</span></span>
              <span className="mention-opt__name">{n.name || "（名称未設定）"}</span>
            </div>
          ))}
        </div>
      )}

      {/* リアクションピッカー */}
      {picker && pickerTarget && (() => {
        const magic = (pickerTarget.reactions as { magic?: { mine?: boolean } })?.magic ?? null;
        return (
          <div className="reaction-picker" role="menu" aria-label="リアクションを選ぶ" style={{ left: picker.pos.left, top: picker.pos.top }}>
            <p className="rp__label">リアクション</p>
            <div className="rp__row">
              {NORMAL_EMOJIS.map((em) => (
                <button key={em} type="button" className="rp__emoji" onClick={() => void toggleReaction(pickerTarget, em)}>{em}</button>
              ))}
            </div>
            <p className="rp__label">魔法 <span className="muted">（解放済み・1メッセージ1魔法・1チャット1回）</span></p>
            <div className="rp__row">
              {magic ? (
                <p className="rp__occupied">✦ このメッセージには既に魔法が付いています（1メッセージ＝魔法1個）。</p>
              ) : spells.filter((s) => s.unlocked).length === 0 ? (
                <p className="rp__occupied">✦ 解放済みの魔法がありません（SC-32 で SP 解放）。</p>
              ) : (
                spells.filter((s) => unlockedSpellIds.has(s.id)).map((s) => {
                  const used = myMagicSpellIds.has(s.id);
                  return (
                    <button key={s.id} type="button" className="rp__spell" disabled={used} onClick={(e) => {
                      const b = e.currentTarget.getBoundingClientRect();
                      void castSpell(pickerTarget, s, { x: b.left + b.width / 2, y: b.top + b.height / 2 });
                    }}>
                      {s.icon} {s.name_ja}{used && <span className="cd">使用中</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}
    </main>
  );
}
