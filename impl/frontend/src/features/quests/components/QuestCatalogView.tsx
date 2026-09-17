"use client";

// SC-13 発見カタログ（掲示板）＝発見可能クエストのメタ一覧（FR-40・C.9）。
// 一覧は DataTable サーバーモード委譲（§1.8.1・list_query・番号ページャ・一覧規約 §4.1）。
// カードクリック→詳細ダイアログ（多めのメタ＋参加リクエスト）／リスト表示は ⋯ メニューから同操作。
// 中身（アイデア/チャット/評価）は非公開＝参加後（メタのみ表示）。
import Link from "next/link";
import { useCallback, useState } from "react";

import { QuestIcon } from "@/components/layout";
import { ActivitySpark, DataTable, EmptyState, Modal, ModalBody, ModalFooter, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, QueryState, RowMenuItem, ServerResult } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import {
  fetchQuestCatalog, followQuest, getCatalogDetail, requestJoinQuest, unfollowQuest, withdrawJoinQuest,
  type QuestCatalogCard, type QuestCatalogDetail,
} from "../api";

type Row = QuestCatalogCard;
type Detail = QuestCatalogDetail;  // カード＋活発度スパーク（catalog-detail）

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
  const [detail, setDetail] = useState<Detail | null>(null);  // 詳細ダイアログの中身（開いているクエスト）
  const [dialogOpen, setDialogOpen] = useState(false);        // open 駆動（閉じアニメを見せてから detail を外す）

  const serverQuery = useCallback(async (state: QueryState, signal: AbortSignal): Promise<ServerResult<Row>> => {
    const res = await fetchQuestCatalog(state, signal);
    if (!res) return { rows: [], total: 0, pinned: [] };
    return { rows: res.data, total: res.page_info.total, pinned: [] };
  }, []);

  // ダイアログを開く＝一覧カードで即描画し、活発度スパーク付きの詳細（catalog-detail）を後追いで結合。
  const openDetail = useCallback((r: Row) => {
    setDetail(r);
    setDialogOpen(true);
    void getCatalogDetail(r.id)
      .then((d) => { if (d) setDetail((cur) => (cur && cur.id === d.id ? { ...cur, ...d } : cur)); })
      .catch(() => {});
  }, []);

  // アクション後は一覧を再取得（絞込維持）＋開いているダイアログの my_state を楽観更新。
  const afterAction = (id: string, my_state: string) => {
    setReload((k) => k + 1);
    setDetail((d) => (d && d.id === id ? { ...d, my_state } : d));
  };

  const toggleFollow = async (r: Row) => {
    try {
      if (r.my_state === "following") await unfollowQuest(r.id);
      else await followQuest(r.id);
      afterAction(r.id, r.my_state === "following" ? "none" : "following");
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
      afterAction(r.id, "pending");
    } catch (err) {
      const reason = reasonOf(err);
      snack({
        type: "error",
        msg: reason === "already_member" ? "すでに参加中です。"
          : reason === "already_requested" ? "すでに申請中です。"
          : reason === "rejected" ? "この申請は却下されています。"
          : "リクエストに失敗しました。",
      });
      setReload((k) => k + 1);
    }
  };

  const withdraw = async (r: Row) => {
    try {
      await withdrawJoinQuest(r.id);
      afterAction(r.id, "none");
    } catch {
      snack({ type: "error", msg: "取り消しに失敗しました。" });
    }
  };

  // フォロー/参加リクエストの行アクション（リスト表示の ⋯・カード/ダイアログと同じ操作）。
  const menuItems = (r: Row): RowMenuItem[] => {
    const items: RowMenuItem[] = [{ label: "詳細を見る", onClick: () => openDetail(r) }];
    if (r.my_state === "member") { items.push({ label: "クエストへ", onClick: () => { window.location.href = `/quests/${r.id}`; } }); return items; }
    items.push({ label: r.my_state === "following" ? "★ フォロー解除" : "☆ フォロー", onClick: () => void toggleFollow(r) });
    if (r.my_state === "pending") items.push({ label: "申請を取り消す", onClick: () => void withdraw(r) });
    else if (r.my_state !== "rejected") items.push({ label: "参加をリクエスト", onClick: () => void request(r) });
    return items;
  };

  const columns: DataTableColumn<Row>[] = [
    { key: "title", label: "クエスト", locked: true, width: 260, filter: { type: "text" }, searchVal: (r) => r.title, render: (r) => r.title },
    { key: "status", label: "状態", width: 100, render: (r) => <span className="badge">{STATUS_LABEL[r.status] ?? r.status}</span> },
    { key: "deadline", label: "締切", width: 120, sortable: true, sortVal: (r) => r.deadline ?? "", render: (r) => r.deadline ?? "—" },
    { key: "member_count", label: "👥", width: 70, align: "num", sortable: true, sortVal: (r) => r.member_count, render: (r) => r.member_count },
    { key: "my", label: "あなた", width: 110, render: (r) => (STATE_LABEL[r.my_state] ? <span className="badge badge-success">{STATE_LABEL[r.my_state]}</span> : <span className="muted">—</span>) },
    { key: "_actions", label: "", actions: true, locked: true, width: 64, render: (r) => <RowMenu items={menuItems(r)} /> },
  ];

  function cardActions(r: Row) {
    const st = r.my_state;
    return (
      <div className="row-center" style={{ gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
        {/* フォロー★はカード右上（ヘッダー）へ移動済み。ここは参加/申請アクションのみ・右寄せ。 */}
        {(st === "none" || st === "following") && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void request(r)}>参加をリクエスト</button>
        )}
        {st === "pending" && <button type="button" className="btn btn-sm" onClick={() => void withdraw(r)}>申請を取り消す</button>}
        {st === "rejected" && <span className="muted text-sm">却下（作成者の再承認待ち）</span>}
        {st === "member" && <Link className="btn btn-sm" href={`/quests/${r.id}`} onClick={(e) => e.stopPropagation()}>クエストへ</Link>}
      </div>
    );
  }

  function cardRaw(r: Row) {
    const st = r.my_state;
    return (
      <article className="card card-accent quest-card is-clickable" data-id={r.id} role="button" tabIndex={0}
        onClick={() => openDetail(r)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(r); } }}
        style={{ ["--accent" as string]: r.color, cursor: "pointer" } as React.CSSProperties}>
        {/* フォロー★＝カード右上角に絶対配置（ステータスより上・ダッシュボードのフォロー中カードと同方針・共有 .follow-star）。 */}
        {st !== "member" && (
          <button type="button" className="follow-star" style={{ position: "absolute", top: "var(--space-2)", right: "var(--space-2)", zIndex: 1 }}
            aria-pressed={st === "following"}
            aria-label={st === "following" ? "フォロー解除" : "フォロー"}
            title={st === "following" ? "フォロー中（クリックで解除）" : "フォロー"}
            onClick={(e) => { e.stopPropagation(); void toggleFollow(r); }}>★</button>
        )}
        <div className="between">
          <span className="row-center" style={{ gap: "var(--space-2)", minWidth: 0 }}>
            <QuestIcon name={r.title} color={r.color} imageUrl={r.icon_image_url ?? undefined} size="sm" />
            <span className="card-title">{r.title}</span>
          </span>
          {/* ステータスはタイトル行と上下中央（.between の align-items:center）。★はその上（右上角・絶対配置）。 */}
          <span className="badge">{STATUS_LABEL[r.status] ?? r.status}</span>
        </div>
        {r.purpose ? <div className="muted text-sm line-clamp-2" style={{ margin: "var(--space-1) 0" }}>{r.purpose}</div> : null}
        <div className="quest-card__meta">
          {(r.categories ?? []).slice(0, 3).map((c) => <span key={c} className="badge badge-muted">{c}</span>)}
          {r.deadline ? <span className="deadline">⏳ 締切 {r.deadline}</span> : null}
        </div>
        <div className="quest-card__stats">
          {/* ダッシュボードの参加中クエストカードと表記統一（👥 パーティーN／💡 アイデアN）。 */}
          <span>👥 パーティー{r.member_count}</span>
          <span>💡 アイデア{r.idea_count}</span>
          {/* フォロー中は★アイコンで表す（バッジ重複を避ける）。他状態はバッジ表示。 */}
          {st !== "following" && STATE_LABEL[st] ? <span className="badge badge-success">{STATE_LABEL[st]}</span> : null}
        </div>
        {cardActions(r)}
      </article>
    );
  }

  return (
    <section aria-label="クエストを探す">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head"><h1>クエストを探す</h1></div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        参加していないクエストを探して、フォロー（見張り）や参加リクエストができます。カードを押すと詳細を確認できます（アイデア・議論の中身は参加後）。
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
        onRowClick={(r) => openDetail(r)}
        emptyText={<EmptyState icon="🔎" title="公開中のクエストがありません" hint="部署内で公開されたクエストがここに並びます。" />}
        cardRaw={cardRaw}
      />

      {detail && (
        <CatalogDialog
          row={detail}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}  // 閉じ要求＝exit アニメ開始
          onClosed={() => setDetail(null)}       // アニメ完了＝アンマウント
          onFollow={toggleFollow}
          onRequest={request}
          onWithdraw={withdraw}
        />
      )}
    </section>
  );
}

function CatalogDialog({ row, open, onClose, onClosed, onFollow, onRequest, onWithdraw }: {
  row: Detail; open: boolean; onClose: () => void; onClosed: () => void;
  onFollow: (r: Row) => void; onRequest: (r: Row) => void; onWithdraw: (r: Row) => void;
}) {
  const st = row.my_state;
  return (
    <Modal open={open} onClose={onClose} onClosed={onClosed} title="クエストの詳細（参加前）" size="lg">
      <ModalBody>
        <div className="row-center" style={{ gap: "var(--space-2)", marginBottom: "var(--space-2)", justifyContent: "space-between" }}>
          <div className="row-center" style={{ gap: "var(--space-2)", minWidth: 0 }}>
            <QuestIcon name={row.title} color={row.color} imageUrl={row.icon_image_url ?? undefined} size="lg" />
            <div style={{ minWidth: 0 }}>
              <div className="card-title" style={{ fontSize: "var(--text-lg)" }}>{row.title}</div>
              <div className="row-center" style={{ gap: "var(--space-2)" }}>
                <span className="badge">{STATUS_LABEL[row.status] ?? row.status}</span>
                {/* フォロー中は右上の follow-toggle が表す（緑バッジは出さない）。他状態はバッジ表示。 */}
                {st !== "following" && STATE_LABEL[st] ? <span className="badge badge-success">{STATE_LABEL[st]}</span> : null}
              </div>
            </div>
          </div>
          {/* フォロー＝アイデア詳細（SC-22）と同じ位置＝ヘッダー右上（枠付き follow-toggle）。 */}
          {st !== "member" && (
            <button type="button" className="follow-toggle" style={{ flexShrink: 0 }} aria-pressed={st === "following"} onClick={() => onFollow(row)}>
              {st === "following" ? "★ フォロー中" : "☆ フォロー"}
            </button>
          )}
        </div>
        {row.purpose ? <p style={{ whiteSpace: "pre-wrap" }}>{row.purpose}</p> : <p className="muted">（テーマの記載はありません）</p>}
        <dl className="detail-grid" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--space-1) var(--space-3)", marginTop: "var(--space-2)" }}>
          <dt className="muted">作成者</dt><dd>{row.owner?.display_name ?? "—"}</dd>
          <dt className="muted">締切</dt><dd>{row.deadline ?? "—"}</dd>
          <dt className="muted">参加人数</dt><dd>👥 {row.member_count}</dd>
          <dt className="muted">アイデア</dt><dd>💡 {row.idea_count}</dd>
          <dt className="muted">カテゴリー</dt><dd>{(row.categories ?? []).join("、") || "—"}</dd>
          <dt className="muted">参加部署</dt><dd>{(row.quest_groups ?? []).map((g) => g.name).join("、") || "全社"}</dd>
        </dl>
        {row.activity ? (
          <div style={{ marginTop: "var(--space-3)" }}>
            <ActivitySpark
              daily={(row.activity.daily ?? []).map((d) => ({ date: d.date, count: d.count }))}
              label={`活動の活発さ（直近${row.activity.days}日・💬 合計 ${row.activity.total} 件）`}
              legend="棒＝日次コメント数（クエスト内の公開アイデア横断・直近3日を強調）。件数のみ＝本文は参加後。"
              emptyText="まだ活動の記録はありません。"
            />
          </div>
        ) : null}
        <p className="muted text-xs" style={{ marginTop: "var(--space-2)" }}>
          ※ アイデアの本文・議論（チャット）・評価は<strong>参加後</strong>に見られます。ここでは概要（メタ情報）のみ表示しています。
        </p>
      </ModalBody>
      <ModalFooter>
        {/* フォローはヘッダー右上へ移動（アイデア詳細と同位置）。フッターは 閉じる（左）→ 状態別 → 主要アクション（右）。 */}
        <button type="button" className="btn" onClick={onClose}>閉じる</button>
        {st === "rejected" && <span className="muted text-sm">却下（作成者の再承認待ち）</span>}
        {st === "pending" && <button type="button" className="btn" onClick={() => onWithdraw(row)}>申請を取り消す</button>}
        {(st === "none" || st === "following") && (
          <button type="button" className="btn btn-primary" onClick={() => { onRequest(row); }}>参加をリクエスト</button>
        )}
        {st === "member" && <Link className="btn btn-primary" href={`/quests/${row.id}`}>クエストへ</Link>}
      </ModalFooter>
    </Modal>
  );
}
