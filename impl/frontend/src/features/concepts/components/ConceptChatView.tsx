"use client";

// コンセプト議論チャット（フルページ・FR-42・P.6）＝スコープ（総合/グループ/前提スレッド）単位のメッセージ一覧＋投稿。
// アイデアチャット（reactions/mentions/files 付き）とは別物の簡素版。正＝doc/画面設計/screens/SC-61 §4.3-4.8。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Avatar, Button, useSnackbar } from "@/components/ui";

import { listChatScopes, listScopeMessages, postScopeMessage, readScope, type ConceptChatMsg } from "../api";
import "../concepts.css";

const SCOPE_KIND_LABEL: Record<string, string> = { overall: "総合ルーム", group: "グループ", assumption: "前提スレッド" };

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ConceptChatView({ conceptId, scopeId }: { conceptId: string; scopeId: string }) {
  const snack = useSnackbar();
  const [messages, setMessages] = useState<ConceptChatMsg[] | null>(null);
  const [scopeLabel, setScopeLabel] = useState("議論");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    listScopeMessages(scopeId).then((r) => {
      const items = r?.items ?? [];
      setMessages(items);
      const last = items[items.length - 1];
      if (last) void readScope(scopeId, last.id).catch(() => { /* 既読は best-effort */ });
    }).catch(() => setMessages([])); // 404/403 等でも「読み込み中」で固まらせない
  }, [scopeId]);

  useEffect(() => {
    // スコープのラベル（総合/グループ名/前提）はスコープ一覧から解決。
    listChatScopes(conceptId).then((r) => {
      const s = r?.items.find((x) => x.scope_id === scopeId);
      if (s) setScopeLabel(s.label || SCOPE_KIND_LABEL[s.kind] || "議論");
    }).catch(() => { /* ラベル取得失敗は既定「議論」のまま */ });
    load();
  }, [conceptId, scopeId, load]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await postScopeMessage(scopeId, body);
      if (m) {
        setMessages((cur) => [...(cur ?? []), m]);
        setDraft("");
        void readScope(scopeId, m.id).catch(() => { /* noop */ });
      }
    } catch {
      snack({ type: "error", msg: "投稿できませんでした（権限／状態をご確認ください）。" });
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="container detail-main concept-chat-page">
      <Link href={`/concepts/${conceptId}`} className="backlink backlink--float">← コンセプト詳細へ戻る</Link>
      <section className="card">
        <div className="concept-section-head"><h1 className="concept-chat-title">💬 {scopeLabel}</h1></div>

        <div className="concept-chat-thread" aria-label="メッセージ一覧">
          {messages === null ? (
            <p className="muted">読み込み中…</p>
          ) : messages.length === 0 ? (
            <p className="muted">まだメッセージはありません。最初の投稿をしましょう。</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="concept-chat-msg">
                <Avatar name={m.author?.display_name || "?"} imageUrl={m.author?.avatar_image_url ?? undefined} size="sm" level={m.author?.level ?? undefined} />
                <div className="concept-chat-msg__body">
                  <div className="concept-chat-msg__meta">
                    <strong>{m.author?.display_name || "メンバー"}</strong>
                    <span className="muted text-xs">{fmtTime(m.created_at)}</span>
                  </div>
                  <div className="concept-chat-msg__text">{m.body}</div>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="concept-chat-composer" data-testid="concept-chat-composer">
          <textarea
            className="textarea"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="メッセージを入力（Ctrl+Enter で送信）"
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
          />
          <Button variant="primary" disabled={sending || !draft.trim()} loading={sending} onClick={() => void send()}>送信</Button>
        </div>
      </section>
    </main>
  );
}
