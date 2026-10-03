"use client";

// SC-22/SC-24 のアイデア議論参加（Tier2）導線＝コンテスト配下アイデアのみ表示（FR-46・案X）。
// - 一般ユーザー：自分の状態（未参加→リクエスト／承認待ち／参加中）を表示。チャット投稿は Tier2 承認が条件。
// - 投稿者：参加リクエストの承認/却下を管理（荒れ対策・心理的安全性）。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Avatar, Button, useSnackbar } from "@/components/ui";

import {
  decideIdeaParticipation,
  getIdeaParticipation,
  requestIdeaParticipation,
  type IdeaParticipationContext,
} from "../api";
import "../contests.css";

export function IdeaParticipationPanel({ ideaId }: { ideaId: string }) {
  const snack = useSnackbar();
  const [ctx, setCtx] = useState<IdeaParticipationContext | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    getIdeaParticipation(ideaId, signal).then(setCtx).catch(() => setCtx(null));
  }, [ideaId]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  if (!ctx || !ctx.is_contest) return null;  // コンテスト配下のアイデアのみ

  async function request() {
    setBusy(true);
    try {
      const r = await requestIdeaParticipation(ideaId);
      if (!r) { snack({ type: "error", title: "リクエストできませんでした（コンテストへの参加が必要な場合があります）" }); return; }
      snack({ type: "success", title: r.status === "approved" ? "参加しました" : "参加をリクエストしました（投稿者の承認待ち）" });
      load();
    } catch {
      snack({ type: "error", title: "リクエストに失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  async function decide(userId: string, status: "approved" | "rejected") {
    setBusy(true);
    try {
      const r = await decideIdeaParticipation(ideaId, userId, status);
      if (!r) { snack({ type: "error", title: "更新できませんでした" }); return; }
      snack({ type: "success", title: status === "approved" ? "参加を承認しました" : "参加を却下しました" });
      load();
    } catch {
      snack({ type: "error", title: "更新に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  const pending = (ctx.requests ?? []).filter((r) => r.status === "requested");
  const approved = (ctx.requests ?? []).filter((r) => r.status === "approved");

  return (
    <section className="card idea-participation" aria-label="議論への参加">
      <div className="section-head"><h2 className="unread-panel__title">💬 このアイデアの議論への参加</h2></div>

      {ctx.is_author ? (
        <>
          <p className="hint" style={{ margin: "0 0 var(--space-2)" }}>あなたのアイデアです。参加リクエストを承認した人がチャットで議論できます。</p>
          {pending.length > 0 && (
            <ul className="member-list">
              {pending.map((p) => (
                <li key={p.user_id} className="member-row join-req-row">
                  <Avatar name={p.display_name ?? "?"} />
                  <span className="member-name">{p.display_name ?? "（不明）"}</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
                    <Button variant="primary" size="sm" onClick={() => void decide(p.user_id, "approved")} disabled={busy}>承認</Button>
                    <button className="btn btn-outline btn-sm" type="button" onClick={() => void decide(p.user_id, "rejected")} disabled={busy}>却下</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {approved.length > 0 && (
            <p className="hint" style={{ marginTop: "var(--space-2)" }}>参加中：{approved.map((p) => p.display_name ?? "（不明）").join("・")}</p>
          )}
          {pending.length === 0 && approved.length === 0 && <p className="hint">まだ参加者はいません。</p>}
        </>
      ) : ctx.my_status === "approved" ? (
        <p className="hint" style={{ margin: 0 }}>✅ 参加中です。<Link href={`/ideas/${ideaId}/chat`}>チャットで議論する →</Link></p>
      ) : ctx.my_status === "requested" ? (
        <p className="hint" style={{ margin: 0 }}>⏳ 参加をリクエスト済みです（投稿者の承認待ち）。</p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <span className="hint" style={{ margin: 0 }}>{ctx.my_status === "rejected" ? "参加は見送られました。再度リクエストできます。" : "このアイデアの議論（チャット）に参加するにはリクエストが必要です。"}</span>
          <Button variant="primary" onClick={request} disabled={busy}>💬 議論に参加をリクエスト</Button>
        </div>
      )}
    </section>
  );
}
