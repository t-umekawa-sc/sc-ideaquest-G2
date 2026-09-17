"use client";

// SC-13 発見カタログ（掲示板）＝発見可能クエストのメタ一覧（FR-40・C.9）。
// 一覧は DataTable サーバーモード委譲（§1.8.1・list_query・番号ページャ・一覧規約 §4.1）。
// フォロー(★)・参加をリクエスト。中身（アイデア/チャット/評価）は非公開＝参加後（メタのみ表示）。
import Link from "next/link";
import { useCallback, useState } from "react";

import { QuestIcon } from "@/components/layout";
import { DataTable, EmptyState, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, QueryState, ServerResult } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import {
  fetchQuestCatalog, followQuest, requestJoinQuest, unfollowQuest, withdrawJoinQuest,
  type QuestCatalogCard,
} from "../api";

type Row = QuestCatalogCard;

const STATUS_LABEL: Record<string, string> = { recruiting: "募集中", in_progress: "進行中", evaluating: "評価中" };
const STATE_LABEL: Record<string, string> = { member: "参加中", pending: "リクエスト中", rejected: "却下", following: "フォロー中" };

function reasonOf(err: unknown): string | undefined {
  return err instanceof ApiError
    ? (err.body as { errors?: { reason?: string }[] } | undefined)?.errors?.[0]?.reason
    : undefined;
}

export function QuestCatalogView() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [reload, setReload] = useState(0);

  const serverQuery = useCallback(async (state: QueryState, signal: AbortSignal): Promise<ServerResult<Row>> => {
    const res = await fetchQuestCatalog(state, signal);
    if (!res) return { rows: [], total: 0, pinned: [] };
    return { rows: res.data, total: res.page_info.total, pinned: [] };
  }, []);

  const toggleFollow = async (r: Row) => {
    try {
      if (r.my_state === "following") await unfollowQuest(r.id);
      else await followQuest(r.id);
      setReload((k) => k + 1);
    } catch {
      snack({ type: "error", msg: "操作に失敗しました。" });
    }
  };

  const request = async (r: Row) => {
    const ok = await confirm({ title: "参加をリクエスト", msg: `「${r.title}」への参加を申請します。作成者/管理者に通知されます。` });
    if (!ok) return;
    try {
      await requestJoinQuest(r.id);
      snack({ type: "success", title: "参加をリクエストしました", msg: "作成者の承認をお待ちください。" });
    } catch (err) {
      const reason = reasonOf(err);
      snack({
        type: "error",
        msg: reason === "already_member" ? "すでに参加中です。"
          : reason === "already_requested" ? "すでに申請中です。"
          : reason === "rejected" ? "この申請は却下されています。"
          : "リクエストに失敗しました。",
      });
    } finally {
      setReload((k) => k + 1); // サーバー権威に整合
    }
  };

  const withdraw = async (r: Row) => {
    try {
      await withdrawJoinQuest(r.id);
    } catch {
      snack({ type: "error", msg: "取り消しに失敗しました。" });
    } finally {
      setReload((k) => k + 1);
    }
  };

  // カード表示前提だが、リスト表示（ソート/絞込 UI）用に最小の列も定義（sortable は backend ホワイトリスト一致）。
  const columns: DataTableColumn<Row>[] = [
    { key: "title", label: "クエスト", locked: true, width: 260, filter: { type: "text" }, searchVal: (r) => r.title, render: (r) => r.title },
    { key: "deadline", label: "締切", width: 120, sortable: true, sortVal: (r) => r.deadline ?? "", render: (r) => r.deadline ?? "—" },
    { key: "member_count", label: "👥", width: 80, align: "num", sortable: true, sortVal: (r) => r.member_count, render: (r) => r.member_count },
  ];

  function cardRaw(r: Row) {
    const st = r.my_state;
    return (
      <article className="card card-accent quest-card" data-id={r.id} style={{ ["--accent" as string]: r.color } as React.CSSProperties}>
        <div className="between">
          <span className="row-center" style={{ gap: "var(--space-2)", minWidth: 0 }}>
            <QuestIcon name={r.title} color={r.color} imageUrl={r.icon_image_url ?? undefined} size="sm" />
            <span className="card-title">{r.title}</span>
          </span>
          <span className="badge">{STATUS_LABEL[r.status] ?? r.status}</span>
        </div>
        {r.purpose ? <div className="muted text-sm" style={{ margin: "var(--space-1) 0" }}>{r.purpose}</div> : null}
        <div className="quest-card__meta">
          {(r.categories ?? []).slice(0, 3).map((c) => <span key={c} className="badge badge-muted">{c}</span>)}
          {r.deadline ? <span className="deadline">⏳ 締切 {r.deadline}</span> : null}
        </div>
        <div className="quest-card__stats">
          <span>👥 {r.member_count}</span>
          <span>💡 {r.idea_count}</span>
          {STATE_LABEL[st] ? <span className="badge badge-success">{STATE_LABEL[st]}</span> : null}
        </div>
        <div className="row-center" style={{ gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap" }}>
          {st !== "member" && (
            <button type="button" className="btn btn-sm" aria-pressed={st === "following"} onClick={() => void toggleFollow(r)}>
              {st === "following" ? "★ フォロー中" : "☆ フォロー"}
            </button>
          )}
          {(st === "none" || st === "following") && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void request(r)}>参加をリクエスト</button>
          )}
          {st === "pending" && (
            <button type="button" className="btn btn-sm" onClick={() => void withdraw(r)}>申請を取り消す</button>
          )}
          {st === "rejected" && <span className="muted text-sm">却下（作成者の再承認待ち）</span>}
          {st === "member" && <Link className="btn btn-sm" href={`/quests/${r.id}`}>クエストへ</Link>}
        </div>
      </article>
    );
  }

  return (
    <section aria-label="クエストを探す">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head"><h1>クエストを探す</h1></div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        参加していないクエストを探して、フォロー（見張り）や参加リクエストができます。アイデア・議論の中身は参加後に見られます。
      </p>
      <DataTable<Row>
        storageKey="sc13-catalog"
        server={{ query: serverQuery }}
        refreshToken={reload}
        columns={columns}
        rowId={(r) => r.id}
        unit="件"
        perPage={24}
        perPageOptions={[12, 24, 48]}
        defaultView="card"
        searchFields="件名・テーマ・カテゴリー"
        emptyText={<EmptyState icon="🔎" title="公開中のクエストがありません" hint="部署内で公開されたクエストがここに並びます。" />}
        cardRaw={cardRaw}
      />
    </section>
  );
}
