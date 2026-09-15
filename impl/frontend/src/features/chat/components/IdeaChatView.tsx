"use client";

// SC-24 アイデアチャット（E 実接続）＝フラットリスト・コンポーザー（書式/メンション/絵文字/添付）・
// リアクション（通常＋魔法）・引用返信（単一・backend 契約）・編集/削除・既読・活発度。
// 正＝doc/画面設計/mocks/SC-24_アイデアチャット.html・screens/SC-24・API設計 E.1〜E.5/G（魔法解放）。
// 実接続: getChat（一覧＋未読）・getIdea（文脈＋comment 権限＋completed）・getPartyMembers（@候補）・getSpells（魔法）。
// 送信/編集/削除/既読/リアクション/魔法はサーバー権威（403/409/422 は理由トースト）。引用返信は複数可（quoted_message_ids[]・§5.16b）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, LoadingOverlay, useConfirm, useSnackbar, SpellCastFx, SpellDeliveryFx, SpellPersistFx, SpellCanvasFx, type CastRect, type CastPoint } from "@/components/ui";
import { isCanvasEffect } from "@/features/spells/engines";
import { QuestIcon } from "@/components/layout";
import { ApiError } from "@/lib/api/client";
import { backToListOr, consumeChatFromDashboard } from "@/lib/nav";
import { realtime } from "@/lib/realtime";
import { reduceMotion } from "@/lib/motion";
import { renderTextHtml, resolveMagic, type Member } from "../render";
import { flashClassFor, scrollTopForTarget } from "../jump";
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
  setMessagePin,
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
type Pos = { top: number; left: number };

export function IdeaChatView({ ideaId, gameEnabled = true }: { ideaId: string; gameEnabled?: boolean }) {
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
  const [ctxOpen, setCtxOpen] = useState(false); // 上部の文脈パネルの開閉。既定＝閉じる（ユーザー要望・▼で開く）
  const [hintOpen, setHintOpen] = useState(false);   // 使い方ヒントの開閉（SC-24 モック）
  const [composerMin, setComposerMin] = useState(true); // 入力欄の最小化（SC-24 モック）。既定＝最小化（ユーザー要望・スリムバーをクリックで展開）
  const router = useRouter();
  // 戻る＝履歴を戻す（デザイン標準 §4.5⑨）＝来た画面へ戻る（ダッシュボード直行→ダッシュボード／詳細→詳細）。
  // 直アクセス/リロードは fallback＝アイデア詳細。固定リンクの相互参照によるループを構造的に回避。
  const [backToDash, setBackToDash] = useState(false); // ダッシュボード直行時だけラベルを出し分け（one-shot）
  useEffect(() => { setBackToDash(consumeChatFromDashboard()); }, []);
  const [emojiOpen, setEmojiOpen] = useState(false);  // コンポーザーの絵文字ピッカー
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [replyTargets, setReplyTargets] = useState<{ id: string; name: string; text: string }[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 編集中メッセージの引用（新規コンポーザーの replyTargets とは別管理・保存で置換）。編集開始時に既存引用で初期化。
  const [editQuotes, setEditQuotes] = useState<{ id: string; name: string; text: string }[]>([]);
  const [mention, setMention] = useState<{ pos: Pos; matches: Member[]; active: number } | null>(null);
  const [picker, setPicker] = useState<{ pos: Pos; msgId: string } | null>(null);
  // #10: 魔法発動の瞬間演出（対象メッセージ矩形に one-shot・自分の発動のみ・reduce-motion 尊重）。
  const [casts, setCasts] = useState<{ id: number; rect: CastRect; effect: string; rarity: string }[]>([]);
  // Phase B: 発射元→対象メッセージへ飛ぶデリバリー（属性別・GF-AC-091 §17）。着弾で one-shot(SpellCastFx) に接続。
  const [delivers, setDelivers] = useState<{ id: number; from: CastPoint; to: CastPoint; effect: string; rarity: string }[]>([]);
  // Phase E: canvas 化済み effect（sparkle 等）の発射元＝メッセージ内の発動者アバターバッジ（自作自演は作成者アバター）＝①②とも枠内飛行。
  // 起点ポリシー①（新規発動）＝発動者アバターバッジが「唱える」ように出現(summonアニメ)→出現しきってから canvas が着火する。
  // 出現アニメ中はここ(true)に入り、(a) バッジに is-summoning を付与し (b) SpellCanvasFx を保留（マウント即着火を防ぐ）。
  const [pendingCanvas, setPendingCanvas] = useState<Record<string, boolean>>({});
  const SUMMON_MS = 450; // 発動者バッジ出現アニメの尺（chat.css の badge-summon と一致）。
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
  // 起点ポリシー①（canvas 魔法の新規発動）＝発動者アバターバッジを「唱える」ように出現(summonアニメ)させ、
  // 出現しきってから（SUMMON_MS 後に）canvas を出して着火＝バッジ起点で枠内飛行→延焼（発射レイヤ不要）。
  const summonThenCast = (msgId: string) => {
    setPendingCanvas((p) => ({ ...p, [msgId]: true }));
    setTimeout(() => setPendingCanvas((p) => { const n = { ...p }; delete n[msgId]; return n; }), SUMMON_MS);
  };

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mentionTaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollNextRef = useRef(false);
  const initialScrollRef = useRef(false); // 画面遷移直後の初期スクロール（未読区切り or 最下部）を1回だけ実行
  const messagesRef = useRef<ChatMessage[]>([]); // 最新 messages（スクロール/可視ハンドラから参照＝再バインド不要）
  const readMaxRef = useRef(-1); // このセッションで既読化した最大インデックス（既読の重複送信を避ける）

  const completed = idea?.quest?.status === "completed";
  const canPost = !completed && !!idea && (idea.my_permissions?.includes("comment") ?? false);
  // FR-39 (b) ピン留めは owner/quest_admin のみ（完了後も可＝最終結果のキュレーション）。
  const canPin = !!idea && ((idea.my_permissions?.includes("owner") || idea.my_permissions?.includes("quest_admin")) ?? false);
  // ピン留めアニメ（style-guide §17P 移植）＝msgId→"stamp"（📌押印＋枠フラッシュ）/"peel"（外す時の退場）。
  // reduce 時は付与しない（＝演出なし・即反映）。演出は onAnimationEnd で後片付け。
  const [pinFx, setPinFx] = useState<Record<string, "stamp" | "peel">>({});
  const clearPinFx = (id: string) => setPinFx((f) => { const n = { ...f }; delete n[id]; return n; });

  // 引用クリック→引用元へジャンプ（受入不具合 DFT-E-006）。
  // ①フローティング文脈バー（.chat-context--float）に隠れない位置へ手動スクロール（native アンカーはバー下に潜る）、
  // ②「どこへ飛んだか」を一時ハイライトで示す（reduce は静止ハイライト＝jump.ts の flashClassFor）。
  const jumpToQuote = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    const el = document.getElementById(targetId);
    if (!el) return;  // 元発言が取得範囲外（未ロード）等＝native の href フォールバックに任せる
    e.preventDefault();
    const reduce = reduceMotion();
    const bar = document.querySelector<HTMLElement>(".chat-context--float");
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const top = scrollTopForTarget(el.getBoundingClientRect().top, window.scrollY, barBottom, 8);
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
    // 参照可能な URL を維持（履歴を汚さない replaceState）。
    window.history.replaceState(null, "", `#${targetId}`);
    // ハイライトを一時付与＝再クリックでも再発火するよう remove→reflow→add。
    const cls = flashClassFor(reduce);
    el.classList.remove("msg--flash", "msg--flash-static");
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), reduce ? 1400 : 1700);
  };
  const togglePin = async (m: ChatMessage) => {
    const next = !m.is_pinned;
    const animate = !reduceMotion();
    if (next) {
      setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, is_pinned: true } : x)));  // 楽観＝ピル出現
      if (animate) setPinFx((f) => ({ ...f, [m.id]: "stamp" }));
      const res = await setMessagePin(m.id, true).catch(() => null);
      if (!res) { setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, is_pinned: false } : x))); clearPinFx(m.id); }
    } else if (!animate) {
      setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, is_pinned: false } : x)));
      const res = await setMessagePin(m.id, false).catch(() => null);
      if (!res) setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, is_pinned: true } : x)));
    } else {
      // 外す＝peel-off を再生（ピルは is_pinned=true のまま描画し、pin-unstamp 終了で除去）。
      setPinFx((f) => ({ ...f, [m.id]: "peel" }));
      const res = await setMessagePin(m.id, false).catch(() => null);
      if (!res) clearPinFx(m.id);  // 失敗＝ピン維持・退場取消（is_pinned は true のまま）
    }
  };
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
      initialScrollRef.current = true; // 描画後に初期スクロール（未読区切りへ／全既読なら最下部へ）
      // メンション候補・魔法カタログ（非致命）。
      void getPartyMembers(d.quest.id).then((r) =>
        // 応答は `{ user: {user_id, display_name} }`（ネスト）。以前フラット想定で name が undefined になり @ でクラッシュしていた。
        setMembers((r?.data ?? []).map((m) => ({ user_id: m.user.user_id, name: m.user.display_name ?? "", nospace: (m.user.display_name || "").replace(/\s/g, "") }))),
      ).catch(() => {});
      void getSpells().then((r) => setSpells(r?.data ?? [])).catch(() => {});
      // 既読は「画面に見えたら既読」（markReadUpToVisible）で進める＝入室時に一律全既読にはしない（DFT-E-011・ユーザー選択）。
      // このセッションの既読済みインデックスをリセット（新規ロード）。
      readMaxRef.current = -1;
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 401 ? "セッションが切れています。再ログインしてください。" : "チャットの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [ideaId]);

  useEffect(() => { void load(); }, [load]);

  // messages を ref に同期（スクロール/可視ハンドラは ref を読む＝毎回の再バインドを避ける）。
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // 「画面に見えたメッセージまで既読を進める」（DFT-E-011・ユーザー選択＝実際に表示されたら既読）。
  // 可読領域＝フローティング文脈バー下端〜ビューポート下端。そこに一部でも入っているメッセージのうち最下位（最新方向）まで既読。
  // markRead は後退しない（§5.31）＝見えた最下位を渡せば途中も既読になる。背面タブ（document.hidden）では進めない（見ていない）。
  const markReadUpToVisible = useCallback(() => {
    if (typeof document === "undefined" || document.hidden) return;
    const msgs = messagesRef.current;
    if (msgs.length === 0) return;
    const bar = document.querySelector<HTMLElement>(".chat-context--float");
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const vh = window.innerHeight;
    let maxIdx = readMaxRef.current;
    document.querySelectorAll<HTMLElement>(".chat-thread .msg[id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > barBottom && r.top < vh) { // 可読領域に一部でも入っている＝見えた
        const idx = msgs.findIndex((m) => m.id === el.id);
        if (idx > maxIdx) maxIdx = idx;
      }
    });
    if (maxIdx > readMaxRef.current) {
      readMaxRef.current = maxIdx;
      const id = msgs[maxIdx]?.id;
      if (id) void markRead(ideaId, id).catch(() => {});
    }
  }, [ideaId]);

  // ユーザーのスクロール（rAF スロットル）とタブ可視化で既読を再評価。
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; markReadUpToVisible(); }); };
    const onVis = () => { if (!document.hidden) markReadUpToVisible(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("scroll", onScroll); document.removeEventListener("visibilitychange", onVis); if (raf) cancelAnimationFrame(raf); };
  }, [markReadUpToVisible]);

  useEffect(() => {
    // ① 送信直後の追従＝スムーズに最下部へ。
    if (scrollNextRef.current) {
      scrollNextRef.current = false;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" });
      requestAnimationFrame(() => markReadUpToVisible()); // 送信後に見えた分を既読化（スクロールが起きない短いスレッド向け）。
      return;
    }
    // ② 画面遷移直後の初期スクロール（1回）＝未読があれば「ここから未読」区切りへ、全既読なら最下部へ即時。
    if (initialScrollRef.current && messages.length > 0) {
      initialScrollRef.current = false;
      // 描画反映後（アバター等の画像読込前でも高さは概ね確定）に実行。二重 rAF でレイアウト確定を待つ。
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const sep = firstUnread ? document.querySelector<HTMLElement>(".unread-sep") : null;
        if (sep) {
          // 「ここから未読」区切りをフローティング文脈バーの下に着地させる（DFT-E-006 と同様）。
          // block:"start" だと全件未読時に区切り＋先頭メッセージがバー背後に潜り込むため offset 付きで手動スクロール。
          const bar = document.querySelector<HTMLElement>(".chat-context--float");
          const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
          const top = scrollTopForTarget(sep.getBoundingClientRect().top, window.scrollY, barBottom, 8);
          window.scrollTo({ top, behavior: "auto" });
        } else {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
        }
        markReadUpToVisible(); // 初期スクロール後に「見えた分」を既読化（DFT-E-011）。
      }));
    }
  }, [messages, firstUnread, markReadUpToVisible]);

  const refetch = useCallback(async () => {
    const chat = await getChat(ideaId);
    if (chat) setMessages(chat.data);
    return chat;
  }, [ideaId]);

  // リアルタイム（L）＝chat:{chat_group_id} を購読し、新着/編集/削除/リアクションで再取得（REST が真実）。
  useEffect(() => {
    if (!chatGroupId) return;
    realtime.start();
    const topic = `chat:${chatGroupId}`;
    realtime.subscribe(topic);
    const off = realtime.onTopic(topic, () => {
      // 新着/編集/削除/リアクションで再取得し、反映後に「見えた分」を既読化（DFT-E-011）。
      // 画面に見えている（＝下端付近で追従中）新着だけが既読になり、上を読んでいる最中の未表示新着は未読のまま。
      void refetch().then(() => requestAnimationFrame(() => markReadUpToVisible()));
    });
    return () => { off(); realtime.unsubscribe(topic); };
  }, [chatGroupId, refetch, markReadUpToVisible]);

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
      // 送信後は最下部へスクロール（scrollNextRef）→ スクロールハンドラが「見えた分」を既読化する（DFT-E-011/009）。
    } catch (err) {
      const st = err instanceof ApiError ? err.status : 0;
      snack({ type: "error", msg: st === 403 ? "投稿する権限がありません。" : st === 409 ? "完了したクエストには投稿できません。" : st === 422 ? "本文か添付が必要です。" : "送信に失敗しました。" });
    } finally {
      setSending(false);
    }
  };

  // ---- 編集 / 削除 ----
  // 編集開始＝既存引用をチップに載せて編集を開く（他メッセージの💬で追加・×で除去できる）。
  const startEdit = (m: ChatMessage) => {
    const quotes = (m.quotes as Array<{ id: string; author_name?: string; excerpt?: string }> | undefined) ?? [];
    setEditQuotes(quotes.map((q) => ({ id: q.id, name: q.author_name || "", text: q.excerpt || "" })));
    setEditingId(m.id);
  };
  const cancelEdit = () => { setEditingId(null); setEditQuotes([]); };
  const saveEdit = async (m: ChatMessage) => {
    const v = editRef.current?.value.trim() ?? "";
    try {
      // 引用は置換で送る（編集中に足した/外した集合）。省略ではなく常に現在の集合を送る＝全消しも反映。
      await editMessage(m.id, { body: v, mentions: extractMentionIds(v), quotedMessageIds: editQuotes.map((q) => q.id) });
      setEditingId(null);
      setEditQuotes([]);
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
          // 起点ポリシー①（doc/画面設計/screens/SC-24_アイデアチャット.md）＝新規発動は発動者アバターバッジを唱えるように
          // 出現させてから、そのバッジ起点で canvas が着火（枠内飛行→延焼）。reduce-motion 時は出現/発射アニメを省き即着火(静止)。
          if (!reduceMotion()) summonThenCast(m.id);
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
        setPendingCanvas((p) => { if (!(m.id in p)) return p; const n = { ...p }; delete n[m.id]; return n; });
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

  // 戻るリンク（3箇所共通）＝履歴があれば router.back（来た画面へ）／無ければアイデア詳細へ。ラベルは文脈ヒント。
  const backHref = `/ideas/${ideaId}`;
  const backLabel = backToDash ? "← ダッシュボードへ戻る" : "← 戻る";
  const onBack = (e: React.MouseEvent) => { e.preventDefault(); backToListOr(router, backHref); };

  if (loading) {
    return <main className="container chat-main"><LoadingOverlay /></main>;
  }
  if (loadError || !idea) {
    return (
      <main className="container chat-main">
        <Link className="backlink" href={backHref} onClick={onBack}>{backLabel}</Link>
        <div className="form-error" role="alert" style={{ marginTop: "var(--space-4)" }}>{loadError ?? "見つかりません。"}</div>
      </main>
    );
  }

  const pickerTarget = picker ? messages.find((m) => m.id === picker.msgId) : null;
  // 「ここから未読」の実効位置＝自分のメッセージは既読扱い（受入不具合 DFT-E-009）。
  // backend の first_unread が自分の送信メッセージを指しても、そこから最初の「自分以外」のメッセージまで区切りを送る
  // （残りが全部自分なら区切りは出さない＝自分の投稿の上に「ここから未読」が出ない）。
  const effectiveFirstUnread = (() => {
    if (!firstUnread) return null;
    const idx = messages.findIndex((m) => m.id === firstUnread);
    if (idx < 0) return null;
    for (let i = idx; i < messages.length; i++) {
      if (!messages[i].is_mine) return messages[i].id;
    }
    return null;
  })();
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
              <div className="chat-context__title"><QuestIcon name={idea.title} color={idea.quest.color} imageUrl={idea.icon_image_url} size="xs" /> {idea.title}</div>
              <div className="chat-context__meta">💬 {messages.filter((m) => !m.is_deleted).length}件{completed ? " ・ ⏸ 完了（凍結）" : ""}</div>
            </div>
            <Link className="btn btn-outline btn-sm" href={`/ideas/${ideaId}`}>アイデア詳細を開く</Link>
            <Link className="backlink" href={backHref} onClick={onBack}>{backLabel}</Link>
          </>
        ) : (
          // たたんだ状態＝コンパクトなタイトル（左）＋右端に戻るリンク。
          <>
            <span className="chat-context__mini"><QuestIcon name={idea.title} color={idea.quest.color} imageUrl={idea.icon_image_url} size="xs" /> {idea.title}</span>
            <Link className="backlink chat-context__back" href={backHref} onClick={onBack}>{backLabel}</Link>
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
          // 魔法リアクションはゲーム層の演出＝game_mode OFF では表示しない（resolveMagic が null 化＝エフェクト/バッジ/ピルとも非表示・§4.11）。
          // 通常の絵文字リアクション（normal）は業務機能なので game_mode に依らず残す。
          const magic = resolveMagic(m.reactions, gameEnabled);
          const normal = ((m.reactions as { normal?: Array<{ emoji: string; count: number; reacted_by_me: boolean; users?: string[] }> })?.normal) ?? [];
          // 自作自演＝発動者==作成者（§17 の4パターン④）。発動者バッジは出さず作成者アバターに✦。
          const selfCast = !!magic && (magic.mine ? m.is_mine : magic.actor != null && magic.actor === m.author?.name);
          const casterName = magic?.actor || (magic?.mine ? "あなた" : "");
          const spellJa = SPELL_JA[magic?.effect ?? ""] ?? "魔法";
          // アクションメニューの「使用中」表示＝自分が今そのアクションを使っている状態（アクティブ表示＋ツールチップに反映）。
          const hasMyReaction = normal.some((n) => n.reacted_by_me) || !!magic?.mine;
          const quotedHere = editingId ? editQuotes.some((t) => t.id === m.id) : replyTargets.some((t) => t.id === m.id);
          const editingHere = editingId === m.id;
          return (
            // #17: key=id なので新着メッセージだけが mount＝CSS で登場（既存は再利用され再生しない）。
            <div key={m.id} className="msg-row">
              {showDay && <div className="chat-day">{day}</div>}
              {effectiveFirstUnread === m.id && <div className="unread-sep">ここから未読</div>}
              <div id={m.id} className={["msg", m.is_mine ? "is-me" : "", m.is_deleted ? "is-deleted" : "", magic ? "spell-fx " + (FX[magic.effect ?? ""] ?? "") : "", pinFx[m.id] === "stamp" ? "msg--pinflash" : ""].filter(Boolean).join(" ")}>
                {/* Phase D/E: 属性別の永続装飾を枠に重ねる。基調グロー/ボーダーは spell-fx--* クラスが担う。
                    canvas 化済み effect（sparkle 等）は SpellCanvasFx（発射→着弾→永続を1枚）、それ以外は従来 CSS の SpellPersistFx。 */}
                {magic && (isCanvasEffect(magic.effect ?? "")
                  ? (!pendingCanvas[m.id] && <SpellCanvasFx effect={magic.effect ?? ""} originSelector={selfCast ? ".msg__author" : ".msg__caster"} />)
                  : <SpellPersistFx effect={magic.effect ?? ""} />)}
                <span className={"avatar sm msg__author" + (selfCast ? " is-selfcast" : "") + (selfCast && pendingCanvas[m.id] ? " is-summoning" : "")} data-name={m.author?.name || undefined}>
                  {m.author?.avatar
                    // 署名URL（MinIO・§1.10）＝next/image ではなく素の img（unoptimized・QuestListView と同流儀）。
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="avatar__img" src={m.author.avatar} alt="" />
                    : <span className="avatar__img placeholder">{(m.author?.name || "?").charAt(0)}</span>}
                </span>
                {/* 発動者アバターバッジ（§17 の「発動者→作成者」＝右上バッジ）。自作自演は出さない（作成者に✦）。新規発動は is-summoning で唱えるように出現。 */}
                {magic && !selfCast && (
                  <span className={"msg__caster avatar sm" + (pendingCanvas[m.id] ? " is-summoning" : "")} data-name={casterName} title={`${casterName} が【${spellJa}】をかけました`} aria-hidden>
                    {magic.actor_avatar
                      // 発動者のプロフィール画像（署名URL・§1.10）。無ければイニシャル。
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className="avatar__img" src={magic.actor_avatar} alt="" />
                      : <span className="avatar__img placeholder">{(casterName || "?").charAt(0)}</span>}
                  </span>
                )}
                <div className="msg__body">
                  <div className="msg__head">
                    <span className="msg__name">{m.is_deleted ? "" : m.author?.name}</span>
                    {m.is_mine && !m.is_deleted && <span className="msg__me">（あなた）</span>}
                    <span className="msg__time">{fmtTime(m.created_at)}</span>
                    {m.is_edited && <span className="msg__edited">（編集済み）</span>}
                    {/* FR-39 (b) ピン留めバッジ＝最終結果の議論の要点に集約される重要発言 */}
                    {(m.is_pinned || pinFx[m.id] === "peel") && !m.is_deleted && (
                      <span
                        className={"msg__pinned" + (pinFx[m.id] === "stamp" ? " is-stamping" : pinFx[m.id] === "peel" ? " is-unstamping" : "")}
                        title="重要（最終結果の議論の要点に表示）"
                        onAnimationEnd={(e) => {
                          if (e.animationName === "pin-stamp") clearPinFx(m.id);
                          if (e.animationName === "pin-unstamp") {
                            setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, is_pinned: false } : x)));
                            clearPinFx(m.id);
                          }
                        }}
                      >📌 重要</span>
                    )}
                  </div>

                  {((m.quotes as Array<{ id: string; author_name?: string; excerpt?: string }> | undefined) ?? []).map((q, i) => (
                    <a className="msg__quote" href={`#${q.id}`} key={i} onClick={(e) => jumpToQuote(e, q.id)}>
                      <b>{q.author_name}</b> {q.excerpt}
                    </a>
                  ))}

                  {editingId === m.id ? (
                    <div className="msg__editwrap">
                      {/* 編集中の引用チップ（既存引用を初期表示＋他メッセージの💬で追加・×で除去。保存で置換）。 */}
                      {editQuotes.length > 0 && (
                        <div className="reply-ctx is-on reply-ctx--edit">
                          <div className="reply-ctx__head">引用返信（{editQuotes.length}件）<span className="reply-ctx__hint">※編集中のメッセージに追加中</span></div>
                          {editQuotes.map((t, i) => (
                            <div className="reply-ctx__item" key={t.id}>
                              <span className="reply-ctx__body"><b>{t.name}</b> に返信：{t.text}</span>
                              <button className="reply-ctx__cancel" type="button" aria-label="この引用をやめる" onClick={() => setEditQuotes((q) => q.filter((_, j) => j !== i))}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="composer__field" style={{ position: "relative" }}>
                        <textarea ref={editRef} className="msg__editbox" defaultValue={m.body ?? ""} onInput={(e) => { autoGrow(e.currentTarget, 200); updateMention(e.currentTarget); }} onKeyDown={handleMentionKeys}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus />
                      </div>
                      <div className="msg__editacts" style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => void saveEdit(m)}>保存</button>
                        <button className="btn btn-outline btn-sm" type="button" onClick={cancelEdit}>キャンセル</button>
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
                    <button className={"msg__act" + (hasMyReaction ? " is-active" : "")} type="button" data-act="react" aria-pressed={hasMyReaction} aria-label="リアクション" title={hasMyReaction ? "リアクション済み（絵文字・魔法を追加/変更）" : "リアクションを付ける（絵文字・魔法）"} onClick={(e) => { e.stopPropagation(); openPicker(m.id, e.currentTarget); }}>🙂</button>
                    <button className={"msg__act" + (quotedHere ? " is-active" : "")} type="button" aria-pressed={quotedHere} aria-label="引用返信" title={quotedHere ? "引用中（このメッセージを返信に引用しています）" : "このメッセージを引用して返信"} onClick={() => {
                      const chip = { id: m.id, name: m.author?.name || "", text: (m.body || "").slice(0, 60) };
                      if (editingId) {
                        // 編集中＝編集対象メッセージの引用に追加（自分自身の引用は不可）。
                        if (m.id !== editingId) setEditQuotes((q) => (q.some((t) => t.id === m.id) ? q : [...q, chip]));
                        editRef.current?.focus();
                      } else {
                        setReplyTargets((rt) => (rt.some((t) => t.id === m.id) ? rt : [...rt, chip]));
                        // 受入不具合 DFT-E-008＝最小化中は composer__full（reply-ctx/textarea）が非表示で
                        // 引用チップが見えず「何も起きない」ため、引用追加時は入力欄を展開してからフォーカスする。
                        setComposerMin(false);
                        requestAnimationFrame(() => boxRef.current?.focus());
                      }
                    }}>💬</button>
                    {canPin && !m.is_deleted && (
                      <button className={"msg__act" + (m.is_pinned ? " is-active" : "")} type="button" aria-pressed={m.is_pinned} aria-label={m.is_pinned ? "ピン留めを外す" : "ピン留め（重要）"} title={m.is_pinned ? "ピン留め中（クリックで解除・最終結果の要点から外す）" : "ピン留め（最終結果の議論の要点に集約）"} onClick={() => void togglePin(m)}>📌</button>
                    )}
                    {m.is_mine && (
                      <>
                        <button className={"msg__act" + (editingHere ? " is-active" : "")} type="button" aria-pressed={editingHere} aria-label="編集" title={editingHere ? "編集中" : "メッセージを編集"} onClick={() => startEdit(m)}>✏️</button>
                        <button className="msg__act" type="button" aria-label="削除" title="メッセージを削除" onClick={() => void removeMsg(m)}>🗑</button>
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
      {/* 最小化は投稿可能なときだけ（!canPost で折りたたむと本文も出ず「空枠」に見える崩れになるため）。 */}
      <div className={`composer${composerMin && canPost ? " is-collapsed" : ""}`} aria-label="メッセージ入力">
        {/* 最小化時のスリムバー（クリックで展開）＝SC-24 モック */}
        {canPost && (
          <button className="composer__mini" type="button" onClick={() => { setComposerMin(false); requestAnimationFrame(() => boxRef.current?.focus()); }}>＋ メッセージを入力…</button>
        )}
        <div className="composer__full">
          {!canPost && (
            // 完了クエスト＝チャット凍結。理由を明示した凍結バナーを常時表示（過去ログは閲覧のみ）。
            <p className="composer__frozen">
              {completed ? "⏸ このクエストは完了済みのため、投稿は締め切られています。" : "投稿するにはコメント作成権限が必要です。"}
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
        // 自分が既にリアクション済みの絵文字＝ピッカー内でアクティブ表示（ピン等と同様に「使用中」が分かる・ユーザー要望）。
        const myEmojis = new Set(
          ((pickerTarget.reactions as { normal?: Array<{ emoji: string; reacted_by_me: boolean }> })?.normal ?? [])
            .filter((n) => n.reacted_by_me).map((n) => n.emoji),
        );
        return (
          <div className="reaction-picker" role="menu" aria-label="リアクションを選ぶ" style={{ left: picker.pos.left, top: picker.pos.top }}>
            <p className="rp__label">リアクション</p>
            <div className="rp__row">
              {NORMAL_EMOJIS.map((em) => {
                const mineEm = myEmojis.has(em);
                return (
                  <button key={em} type="button" className={"rp__emoji" + (mineEm ? " is-active" : "")} aria-pressed={mineEm} title={mineEm ? "リアクション済み（クリックで取消）" : undefined} onClick={() => void toggleReaction(pickerTarget, em)}>{em}</button>
                );
              })}
            </div>
            {/* ゲームモード OFF（§4.11・レビュー#2）＝魔法キャストUIは出さない（使用無効）。通常リアクションと本文は残す。 */}
            {gameEnabled && (
              <>
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
              </>
            )}
          </div>
        );
      })()}
    </main>
  );
}
