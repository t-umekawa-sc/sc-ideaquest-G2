"use client";

// SC-22 アイデア詳細＝本文/価値/利害関係者/ステータス/作成者/版数（D.1 GET /ideas/{id} 実接続）。
// 投票（D.5）・フォロー（D.6）も実接続＝楽観更新＋サーバー権威（409/403 でロールバック＋理由トースト）。
// quest 参照（D.1）でクエストへの戻る導線・カテゴリーバッジ・completed 凍結/締切後の事前無効化を実装。
// 正＝doc/画面設計/mocks/SC-22_アイデア詳細.html・doc/画面設計/screens/SC-22_アイデア詳細.md（§4.5）。
// 評価結果（F.1 集計・§4.6）も実接続＝可視な評価のみ・limited は範囲外非表示・選定（F.3）＋評価導線は my_permissions で出し分け。
// チャット（E・§4.4）も実接続＝議論アクティビティ（chat-activity）＋直近3件プレビュー（getChat）。
// 投票の事前無効化＝completed 凍結＋締切後（quest.deadline < 今日・D.5 の isVotingClosed でサーバー _guard_votable と一致）。最終権威はサーバー 409。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner, Avatar, Modal, ModalBody, ModalFooter, SparkBurst, XpFloat, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { reduceMotion } from "@/lib/motion";
import { backToListOr } from "@/lib/nav";

import { getEvaluationAggregate, selectIdea, unselectIdea, type EvaluationAggregate } from "@/features/evaluations/api";
import { getChat, getChatActivity, type ChatActivity, type ChatMessage } from "@/features/chat/api";

import { followIdea, getAttachmentDownloadUrl, getIdea, removeVote, unfollowIdea, voteIdea, type IdeaDetail, type IdeaVoteType } from "../api";
import { isVotingClosed, todayISODate, votePercents } from "../voting";
import { IdeaForm } from "./IdeaForm";
import { RevisionHistory } from "./RevisionHistory";
import "../ideas.css";

// YYYY-MM-DDTHH:MM:SSZ → YYYY/MM/DD（表示用）。
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function statusLabel(status: string, isSelected: boolean): [string, string] {
  if (isSelected) return ["選定候補", "badge badge-success"];
  if (status === "draft") return ["下書き", "badge badge-muted"];
  return ["公開", "badge badge-success"];
}

// 添付アイコン（mime/拡張子から絵文字・表示のみ）。
function attachIcon(name: string, mime: string): string {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("spreadsheet") || name.endsWith(".csv")) return "📊";
  if (mime.includes("word")) return "📝";
  if (mime.includes("presentation")) return "📽️";
  if (mime === "application/zip") return "🗜️";
  return "📄";
}
// バイト数→表示（KB/MB）。
function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// 評価観点キー→表示名（F・SC-25/SC-22 §4.6）。順序＝5観点の表示順。
const ASPECT_LABELS: [string, string][] = [
  ["novelty", "新規性"],
  ["impact", "影響度"],
  ["feasibility", "実現度"],
  ["fit", "適合性"],
  ["cost", "コスト"],
];

export function IdeaDetailView({ ideaId }: { ideaId: string }) {
  const snack = useSnackbar();
  const router = useRouter();
  // 投票の押下フィードバック（ダッシュボードと共通）＝クリック位置の火花＋「+N XP」フロート。
  // 座標固定オーバーレイ（要素非依存）・reduce-motion 時は生成しない。CSS＝design-system.css。
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const burstId = useRef(0);
  const fireBurst = useCallback((e: { clientX: number; clientY: number }) => {
    if (reduceMotion()) return;
    const id = ++burstId.current;
    setBursts((b) => [...b, { id, x: e.clientX, y: e.clientY }]);
    setTimeout(() => setBursts((b) => b.filter((z) => z.id !== id)), 650);
  }, []);
  const [xpFloats, setXpFloats] = useState<{ id: number; x: number; y: number; label: string }[]>([]);
  const xpFloatId = useRef(0);
  const fireXpFloat = useCallback((e: { clientX: number; clientY: number }, label: string) => {
    if (reduceMotion()) return;
    const id = ++xpFloatId.current;
    setXpFloats((f) => [...f, { id, x: e.clientX, y: e.clientY, label }]);
    setTimeout(() => setXpFloats((f) => f.filter((z) => z.id !== id)), 1100);
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 投票/フォローは楽観更新のためローカル state で保持（load 時に DTO から同期）。
  const [vote, setVote] = useState<{ approve: number; oppose: number; my: IdeaVoteType | null; stale: boolean }>({ approve: 0, oppose: 0, my: null, stale: false });
  const [following, setFollowing] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // 評価結果（F.1 集計）＋選定状態（楽観更新）。
  const [evalAgg, setEvalAgg] = useState<EvaluationAggregate | null>(null);
  const [selected, setSelected] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);
  const [celebrateSelect, setCelebrateSelect] = useState(false); // #16: 選定成立の祝福オーバーレイ
  const [voteBarReady, setVoteBarReady] = useState(false); // #23: 賛否バーをマウント後に 0→比率へ伸ばす
  useEffect(() => setVoteBarReady(true), []);
  // チャット（E）＝活発度集計＋直近プレビュー（SC-22 §4.4）。
  const [chatActivity, setChatActivity] = useState<ChatActivity | null>(null);
  const [chatPreview, setChatPreview] = useState<ChatMessage[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await getIdea(ideaId);
      if (!d) setLoadError("このアイデアは見つからないか、参照する権限がありません。");
      else {
        setIdea(d);
        const dv = (d.vote ?? {}) as { summary?: { approve?: number; oppose?: number }; my_vote?: string | null; stale?: boolean };
        setVote({
          approve: dv.summary?.approve ?? 0,
          oppose: dv.summary?.oppose ?? 0,
          my: dv.my_vote === "approve" || dv.my_vote === "oppose" ? dv.my_vote : null,
          stale: dv.stale === true,  // 投票後に版が進んだ（D.5・押し直しで解消）
        });
        setFollowing(!!d.following);
        setSelected(!!d.is_selected);
        // 評価結果の集計（F.1）＝非致命（取得失敗/権限なしは「評価待ち」表示）。
        setEvalAgg(await getEvaluationAggregate(ideaId).catch(() => null));
        // チャット（E）＝活発度集計＋直近3件プレビュー（非致命）。
        void getChatActivity(ideaId).then(setChatActivity).catch(() => {});
        void getChat(ideaId, { limit: 50 }).then((c) => setChatPreview((c?.data ?? []).filter((m) => !m.is_deleted).slice(-3))).catch(() => {});
        setLoadError(null);
      }
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 401
          ? "セッションが切れています。再ログインしてください。"
          : "アイデアの取得に失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, [ideaId]);

  useEffect(() => { void load(); }, [load]);

  // 投票（賛成/反対の登録・切替・同ボタン再クリックで取消）。楽観更新＋サーバー権威（409/403 でロールバック＋理由トースト）。
  const handleVote = useCallback(async (type: IdeaVoteType, e?: { clientX: number; clientY: number }) => {
    if (voteBusy) return;
    const prev = vote;
    const isCancel = prev.my === type;
    if (!isCancel && e) fireBurst(e); // 新規/切替の押下バースト（成否に関わらず即時・ダッシュボードと共通）
    setVoteBusy(true);
    try {
      if (isCancel) {
        // 同じ選択肢を再クリック＝取消（票が無くなるので stale は解消）。
        setVote((s) => ({ ...s, [type]: Math.max(0, s[type] - 1), my: null, stale: false }));
        await removeVote(ideaId);
        snack({ type: "info", msg: "投票を取り消しました。" });
      } else {
        // 新規 or 切替（1人1票・前の票を減算）。押し直し＝現版で投票し直す＝stale 解消（voted_revision 更新）。
        setVote((s) => ({
          approve: s.approve + (type === "approve" ? 1 : 0) - (prev.my === "approve" ? 1 : 0),
          oppose: s.oppose + (type === "oppose" ? 1 : 0) - (prev.my === "oppose" ? 1 : 0),
          my: type,
          stale: false,
        }));
        const res = await voteIdea(ideaId, type);
        // サーバー集計を権威に反映（匿名化・整合）。投票し直したので stale は false。
        if (res) setVote({ approve: res.summary.approve, oppose: res.summary.oppose, my: (res.my_vote as IdeaVoteType | null) ?? null, stale: false });
        snack({ type: "success", title: "投票しました" }); // 更新系と同じ成功トースト
        // #8: server が付与した XP（xp_delta＝初回/日次上限内なら +5）だけ「+N XP」フロート（ダッシュボードと共通）。
        if (res && res.xp_delta > 0 && e) fireXpFloat(e, `+${res.xp_delta} XP`);
        router.refresh(); // ヘッダーのレベルリング/コイン等（getServerMe 由来）を更新
      }
    } catch (err) {
      setVote(prev); // ロールバック
      const status = err instanceof ApiError ? err.status : 0;
      snack({
        type: "error",
        msg:
          status === 409 ? "締切後・完了したクエストのアイデアには投票できません。"
          : status === 403 ? "投票する権限がありません。"
          : status === 404 ? "このアイデアは見つからないか、参照する権限がありません。"
          : status === 401 ? "セッションが切れています。再ログインしてください。"
          : "投票に失敗しました。時間をおいて再度お試しください。",
      });
    } finally {
      setVoteBusy(false);
    }
  }, [ideaId, vote, voteBusy, snack, router, fireBurst, fireXpFloat]);

  // 添付ダウンロード＝権限検証後の署名URL を取得して新規タブで開く（D.3・§1.10）。
  const handleDownload = useCallback(async (attachmentId: string) => {
    try {
      const res = await getAttachmentDownloadUrl(attachmentId);
      if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      snack({
        type: "error",
        msg: status === 404 ? "この添付は見つからないか、参照する権限がありません。" : "ダウンロードに失敗しました。",
      });
    }
  }, [snack]);

  // フォロー（ウォッチ）トグル。楽観更新＋サーバー権威（completed 後の新規は 409）。
  const handleFollow = useCallback(async () => {
    if (followBusy) return;
    const prev = following;
    setFollowBusy(true);
    setFollowing(!prev);
    try {
      if (prev) await unfollowIdea(ideaId);
      else await followIdea(ideaId);
    } catch (err) {
      setFollowing(prev); // ロールバック
      const status = err instanceof ApiError ? err.status : 0;
      snack({
        type: "error",
        msg:
          status === 409 ? "完了したクエストのアイデアは新規フォローできません（解除のみ可）。"
          : status === 404 ? "このアイデアは見つからないか、参照する権限がありません。"
          : status === 401 ? "セッションが切れています。再ログインしてください。"
          : "フォローの更新に失敗しました。時間をおいて再度お試しください。",
      });
    } finally {
      setFollowBusy(false);
    }
  }, [ideaId, following, followBusy, snack]);

  // 選定/選定解除（F.3・owner/quest_admin）。楽観更新＋サーバー権威（409/403 でロールバック＋理由トースト）。
  const handleSelect = useCallback(async () => {
    if (selectBusy) return;
    const prev = selected;
    setSelectBusy(true);
    setSelected(!prev);
    try {
      const res = prev ? await unselectIdea(ideaId) : await selectIdea(ideaId);
      if (res) setSelected(res.is_selected);
      snack({ type: prev ? "info" : "success", msg: prev ? "選定を解除しました。" : "アイデアを選定しました。投稿者にコイン・XP を付与しました。" });
      // #16: 選定（解除ではない）成立時に祝福（純装飾＝reduce-motion 時は出さずスナックバーで通知）。
      if (!prev && res?.is_selected && !reduceMotion()) {
        setCelebrateSelect(true);
        setTimeout(() => setCelebrateSelect(false), 2800);
      }
    } catch (err) {
      setSelected(prev); // ロールバック
      const status = err instanceof ApiError ? err.status : 0;
      snack({
        type: "error",
        msg:
          status === 409 ? "完了したクエストのアイデアは選定を変更できません。"
          : status === 403 ? "選定する権限がありません。"
          : "選定の更新に失敗しました。時間をおいて再度お試しください。",
      });
    } finally {
      setSelectBusy(false);
    }
  }, [ideaId, selected, selectBusy, snack]);

  if (loading) {
    return <main className="container detail-main"><Spinner label="読み込み中…" /></main>;
  }
  if (loadError || !idea) {
    return (
      <main className="container detail-main">
        {/* 読み込み失敗フォールバック＝クエスト不明のため素の一覧へ。履歴があれば元の一覧に戻す（§4.5 ⑨）。 */}
        <Link className="backlink" href="/quests" onClick={(e) => { e.preventDefault(); backToListOr(router, "/quests"); }}>← クエスト一覧へ戻る</Link>
        <div className="form-error" role="alert" style={{ marginTop: "var(--space-4)" }}>{loadError ?? "アイデアが見つかりません。"}</div>
      </main>
    );
  }

  // 投票集計/自分の投票/フォローはローカル state（楽観更新・load 時に DTO から同期）。
  const agreeN = vote.approve;
  const disagreeN = vote.oppose;
  const votePct = votePercents(agreeN, disagreeN); // #23: 賛否バーの比率
  const myVote = vote.my === "approve" ? "agree" : vote.my === "oppose" ? "disagree" : null;
  const [stLabel, stClass] = statusLabel(idea.status, selected);
  // クエスト凍結（completed）＝投票不可・新規フォロー不可（解除のみ可）。サーバー 409 も権威（C.5）。
  const questCompleted = idea.quest.status === "completed";
  // 投票の事前無効化＝completed または締切後（D.5 サーバー _guard_votable と一致）。フォロー/選定は completed のみ。
  const voteClose = isVotingClosed({ status: idea.quest.status, deadline: idea.quest.deadline ?? null }, todayISODate());
  const voteClosedByDeadline = voteClose.reason === "deadline";
  const voteCloseTitle = questCompleted ? "完了したクエストでは投票できません" : voteClosedByDeadline ? "締切日を過ぎたため投票できません" : undefined;
  const voteDisabled = voteBusy || voteClose.closed;
  const followDisabled = followBusy || (questCompleted && !following);
  const authorName = idea.author.display_name || "?";
  const stakeText = idea.stakeholders.map((s) => s.label).join("・") || "—";
  // 評価結果（F.1 集計）＝サーバー算出の my_permissions で UX 出し分け。
  const canEvaluate = !!evalAgg?.my_permissions?.includes("evaluate");
  const canSelect = !!evalAgg?.my_permissions?.includes("select");
  const evalCount = evalAgg?.evaluator_count ?? 0;
  const evalCoin = evalAgg?.coin?.finalized ?? evalAgg?.coin?.projected ?? 0;
  // 活発度バー（E.1 daily を正規化・版マーカー日は has-update）。
  const chatTotal = chatActivity?.total_messages ?? 0;
  const revDays = new Set((chatActivity?.revision_markers ?? []).map((m) => m.date));
  const dailyMax = Math.max(1, ...(chatActivity?.daily ?? []).map((d) => d.message_count));
  const sparkBars = (chatActivity?.daily ?? []).map((d) => ({ date: d.date, h: Math.round((d.message_count / dailyMax) * 100), update: revDays.has(d.date) }));

  return (
    <main className="container detail-main">
      {/* 投票の押下フィードバック（火花＋「+N XP」・ダッシュボードと共通・reduce-motion 時は生成しない） */}
      {bursts.map((b) => <SparkBurst key={b.id} x={b.x} y={b.y} />)}
      {xpFloats.map((f) => <XpFloat key={f.id} x={f.x} y={f.y} label={f.label} />)}
      {/* #16: 選定成立の祝福（中央オーバーレイ・~2.8s 自動消滅・クリックで即閉じ・reduce-motion 時は非表示） */}
      {celebrateSelect && (
        <div className="select-celebrate" role="status" aria-live="polite" onClick={() => setCelebrateSelect(false)}>
          <div className="select-celebrate__card">
            <div className="select-celebrate__aura" aria-hidden />
            <div className="select-celebrate__spark select-celebrate__spark--a" aria-hidden>✦</div>
            <div className="select-celebrate__spark select-celebrate__spark--b" aria-hidden>✧</div>
            <div className="select-celebrate__spark select-celebrate__spark--c" aria-hidden>★</div>
            <div className="select-celebrate__crown" aria-hidden>👑</div>
            <div className="select-celebrate__title">SELECTED!</div>
            <div className="select-celebrate__idea">{idea.title}</div>
            <div className="select-celebrate__sub">このアイデアを選定しました ・ 投稿者へ ✦+200 XP</div>
          </div>
        </div>
      )}
      {/* クエストへ戻る（D.1 quest 参照・実導線）＝標準どおり履歴を戻す（デザイン標準 §4.5 ⑨・line 191）。
          アイデアタブの一覧は検索/ソート/絞込/ページを URL クエリに持つため、router.back() で
          絞込・ページ・スクロール位置ごと元の一覧に復帰する（#quest-tabs への新規遷移だとクエリが落ちて絞込が消えていた）。
          直接アクセス（履歴なし）は素のクエスト詳細へフォールバック。フローティング表示は §4.10。
          href は右クリック/新規タブ/JS 無効時のフォールバック（クエリなしの素の一覧）。 */}
      <Link
        className="backlink backlink--float"
        href={`/quests/${idea.quest.id}`}
        onClick={(e) => { e.preventDefault(); backToListOr(router, `/quests/${idea.quest.id}`); }}
      >
        ← {idea.quest.title || "クエスト"}へ戻る
      </Link>

      {/* ============ アイデアヘッダー ============ */}
      <section className="card idea-head" aria-label="アイデア情報">
        <div className="idea-head__top">
          <div style={{ minWidth: 0 }}>
            <div className="idea-head__badges">
              {idea.quest.categories.map((c) => (
                <span className="badge badge-muted" key={c}>{c}</span>
              ))}
              <span className={stClass}>{stLabel}</span>
              {questCompleted && <span className="badge badge-muted" title="完了したクエストは投票/新規フォローが凍結されています">⏸ 完了（凍結）</span>}
              {!questCompleted && voteClosedByDeadline && <span className="badge badge-muted" title="締切日を過ぎたため投票は締め切られています">🔒 投票締切</span>}
            </div>
            <h1>{idea.title}</h1>
            <div className="poster">
              <Avatar name={authorName} size="sm" level={idea.author.level ?? undefined} />
              <span className="name">投稿: {authorName}</span>
            </div>
          </div>
          <div className="idea-actions">
            {/* フォロー（D.6・トグル）。completed は新規フォロー不可＝事前無効化（解除は可）＋サーバー 409 も権威。 */}
            <button
              className="follow-star"
              type="button"
              aria-pressed={following}
              disabled={followDisabled}
              title={questCompleted && !following ? "完了したクエストには新規フォローできません" : undefined}
              onClick={() => void handleFollow()}
            >
              {following ? "★ フォロー中" : "☆ フォロー"}
            </button>
            {/* 編集＝SC-21 フォーム編集モード（D.2 PATCH・本人/管理のみサーバー強制）。 */}
            <button className="btn btn-outline" type="button" onClick={() => setEditOpen(true)}>
              編集
            </button>
          </div>
        </div>
        <div className="idea-meta">
          <span>🗓 投稿 {fmtDate(idea.created_at)}</span>
          <span>
            🔄 更新 {fmtDate(idea.updated_at)}・
            <button className="meta-history" type="button" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>
              版 {idea.current_revision}（履歴）
            </button>
          </span>
          {idea.time_limit && <span>⏳ タイムリミット {fmtDate(idea.time_limit)}</span>}
          <span>🤝 利害関係者: {stakeText}</span>
        </div>
      </section>

      {/* ============ メイン＋右レール ============ */}
      <div className="idea-layout">
        {/* ---------- メイン（左） ---------- */}
        <div className="idea-main">
          {/* アイデア内容 */}
          <section className="card" aria-label="アイデア内容">
            <h2 className="card-title">アイデア内容</h2>
            <div className="sub-block">
              <p className="sub-label">
                価値<span className="req" title="必須項目">*</span>
              </p>
              <p style={{ whiteSpace: "pre-wrap" }}>{idea.value}</p>
            </div>
            <div className="sub-block">
              <p className="sub-label">
                アイデア本文<span className="req" title="必須項目">*</span>
              </p>
              <p style={{ whiteSpace: "pre-wrap" }}>{idea.body}</p>
            </div>
            <div className="sub-block">
              <p className="sub-label">利害関係者</p>
              <p>{stakeText}</p>
            </div>
            {idea.note && (
              <div className="sub-block">
                <p className="sub-label">備考 / 特記事項</p>
                <p style={{ whiteSpace: "pre-wrap" }}>{idea.note}</p>
              </div>
            )}
          </section>

          {/* 関連資料（添付・D.3）。SC-22 §4.3＝一覧＋ダウンロードのみ・0件なら非表示。追加/削除は SC-21 フォーム。 */}
          {idea.attachments.length > 0 && (
            <section className="card" aria-label="関連資料">
              <h2 className="card-title">
                関連資料 <span className="badge badge-muted">{idea.attachments.length}</span>
              </h2>
              <ul className="file-list">
                {idea.attachments.map((f) => (
                  <li className="file-item" key={f.id}>
                    <span className="file-icon">{attachIcon(f.original_name, f.mime_type)}</span>
                    <span className="file-info">
                      <span className="file-name">{f.original_name}</span>
                      <span className="file-sub">
                        {fmtBytes(f.size_bytes)} ・ {f.uploaded_by.display_name || "?"} ・ {fmtDate(f.uploaded_at)}
                      </span>
                    </span>
                    <button className="btn btn-outline btn-sm" type="button" onClick={() => void handleDownload(f.id)}>
                      ⬇ ダウンロード
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* チャット（導線＋直近プレビュー） */}
          <section className="card" aria-label="チャット">
            <div className="between" style={{ marginBottom: "var(--space-3)" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                チャット <span className="badge badge-muted">💬 {chatTotal}</span>
              </h2>
            </div>

            {/* 議論アクティビティ・グラフ（E.1 chat-activity 実データ） */}
            {sparkBars.length > 0 && (
              <div className="activity" aria-label="議論の活発度">
                <div className="activity__head">
                  <span className="activity__label">議論の活発度</span>
                </div>
                <div className="spark" role="img" aria-label={`直近${sparkBars.length}日の日次メッセージ数の棒グラフ`}>
                  {sparkBars.map((b, i) => (
                    <span
                      key={i}
                      className={["spark__bar", b.update ? "has-update" : "", i >= sparkBars.length - 3 ? "is-recent" : ""].filter(Boolean).join(" ")}
                      style={{ height: `${Math.max(6, b.h)}%` }}
                      title={b.update ? `${b.date}（アイデア更新）` : b.date}
                    />
                  ))}
                </div>
                <div className="activity__legend">
                  ◆ = アイデア更新の記録された日。棒＝日次メッセージ数（直近3日を強調）。
                </div>
              </div>
            )}

            {/* 直近メッセージのプレビュー（E.1・最新3件） */}
            {chatPreview.length > 0 ? (
              <div className="chat-preview">
                {chatPreview.map((m) => (
                  <div className="chat-msg" key={m.id}>
                    <Avatar name={m.author?.name || "?"} size="sm" />
                    <div className="chat-msg__body">
                      <div className="chat-msg__head">
                        <span className="chat-msg__name">{m.author?.name}</span>
                        <span className="chat-msg__time">{fmtDate(m.created_at)}</span>
                      </div>
                      <p className="chat-msg__text">{m.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="role-note">まだコメントはありません。</p>
            )}
            <Link className="btn btn-primary" href={`/ideas/${ideaId}/chat`}>
              チャットを開く →
            </Link>
          </section>
        </div>

        {/* ---------- 右レール ---------- */}
        <div className="idea-rail">
          {/* 投票 */}
          <section className="card" aria-label="投票">
            <h2 className="card-title">
              投票{" "}
              {vote.stale && vote.my && (
                <span className="vote-stale-badge" title="投票後にアイデアが更新されました。内容を確認して投票し直せます（押し直しで反映）。">⚠ 投票後に更新</span>
              )}
            </h2>
            {vote.stale && vote.my && (
              <p className="role-note" style={{ marginTop: "var(--space-1)" }}>
                ※ あなたの投票後にこのアイデアは更新されました。内容を確認し、必要なら<strong>投票し直して</strong>ください（同じ側をもう一度押すと最新版で見直し完了）。
              </p>
            )}

            <div className="vote-summary">
              <span className="vote-agree">▲ 賛成 {agreeN}</span>
              <span className="vote-disagree">▼ 反対 {disagreeN}</span>
            </div>
            {/* #23: 賛否の比率バー（常時表示＝0-0 は空バー）。賛成＝左アンカーで左→右に伸び、反対＝右アンカーで
                右→左に伸びる。解除時は width が 0 に戻る＝伸びた向きと逆にゲージが引っ込む（GF-AC-230/231/233）。 */}
            <div className="vote-bar" role="img" aria-label={votePct.total > 0 ? `賛成 ${votePct.approve}% ・ 反対 ${votePct.oppose}%` : "まだ投票がありません"}>
              <span className="vote-bar__agree" style={{ width: `${voteBarReady ? votePct.approve : 0}%` }} />
              <span className="vote-bar__disagree" style={{ width: `${voteBarReady ? votePct.oppose : 0}%` }} />
            </div>
            <div className="vote-btns">
              {/* 投票（D.5・1人1票・締切まで変更可・同ボタン再クリックで取消）。completed/締切後は事前無効化＋サーバー権威（権限なしは 403→理由トースト）。 */}
              <button className={`vote-btn agree${myVote === "agree" ? " is-on" : ""}`} type="button" aria-pressed={myVote === "agree"} disabled={voteDisabled} title={voteCloseTitle} onClick={(e) => void handleVote("approve", e)}>
                ▲ 賛成
              </button>
              <button className={`vote-btn disagree${myVote === "disagree" ? " is-on" : ""}`} type="button" aria-pressed={myVote === "disagree"} disabled={voteDisabled} title={voteCloseTitle} onClick={(e) => void handleVote("oppose", e)}>
                ▼ 反対
              </button>
            </div>
            {questCompleted && <p className="role-note" style={{ marginTop: "var(--space-2)" }}>※ このクエストは完了済みのため投票は締め切られています。</p>}
            {!questCompleted && voteClosedByDeadline && <p className="role-note" style={{ marginTop: "var(--space-2)" }}>※ 締切日を過ぎたため投票は締め切られています。</p>}
            <p className="vote-note">
              1人1票・<strong>締切まで変更できます</strong>。投票すると <span className="xp">+5 XP</span>（自分のアイデアにも投票可）。
              <br />
              🔒 匿名モードでは賛成/反対の集計数のみ表示します。
            </p>
          </section>

          {/* 評価結果（F.1 集計・可視な評価のみ・limited は範囲外非表示） */}
          <section className="card" aria-label="評価結果">
            <div className="eval-head">
              <h2 className="card-title" style={{ margin: 0 }}>
                評価結果
              </h2>
              {canSelect && (
                <button
                  className={`btn btn-sm ${selected ? "btn-primary" : "btn-outline"}`}
                  type="button"
                  aria-pressed={selected}
                  disabled={selectBusy || questCompleted}
                  title={questCompleted ? "完了したクエストでは選定を変更できません" : undefined}
                  onClick={() => void handleSelect()}
                >
                  {selected ? "★ 選定済み（解除）" : "☆ このアイデアを選定"}
                </button>
              )}
            </div>

            {evalCount === 0 ? (
              <p className="role-note" style={{ marginTop: "var(--space-2)" }}>
                まだ提出済みの評価がありません{canEvaluate ? "。あなたが最初の評価者になれます。" : "（評価者の評価を待っています）。"}
              </p>
            ) : (
              <>
                <div className="eval-avg">
                  <span className="eval-avg__num">{evalAgg?.overall_avg?.toFixed(1) ?? "–"}</span>
                  <span className="eval-avg__max">/ 5.0（平均・評価者{evalCount}名）</span>
                  <span className="eval-avg__coin">
                    <span className="pixel-stat coin">◆ +{evalCoin}</span>
                  </span>
                </div>
                {ASPECT_LABELS.map(([key, label]) => {
                  const v = evalAgg?.aspects?.[key];
                  return (
                    <div className="score-row" key={key}>
                      <span className="score-row__label">
                        {label}
                        {key === "cost" && <span className="muted" title="低コストほど高得点">ⓘ</span>}
                      </span>
                      <span className="score-bar">
                        <i style={{ width: `${v ? (v / 5) * 100 : 0}%` }} />
                      </span>
                      <span className="score-row__val">{v ? v.toFixed(1) : "–"}</span>
                    </div>
                  );
                })}

                {/* 総評（評価者ごとの全体コメント） */}
                {evalAgg?.evaluators?.some((e) => e.overall_comment) && (
                  <>
                    <div className="eval-section-label">総評</div>
                    <div className="eval-overall">
                      {evalAgg.evaluators.filter((e) => e.overall_comment).map((e) => (
                        <div className="eval-overall__item" key={e.evaluator.user_id}>
                          <div className="eval-comment__head">
                            <Avatar name={e.evaluator.display_name || "?"} size="sm" />
                            <span className="chat-msg__name">{e.evaluator.display_name || "?"}</span>
                          </div>
                          <p className="eval-comment__text">{e.overall_comment}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* 観点別コメント（評価者×観点） */}
                {evalAgg?.evaluators?.some((e) => Object.keys(e.comments ?? {}).length > 0) && (
                  <>
                    <div className="eval-section-label">観点別コメント</div>
                    <div className="eval-comments">
                      {evalAgg.evaluators.flatMap((e) =>
                        ASPECT_LABELS.filter(([k]) => e.comments?.[k]).map(([k, label]) => (
                          <div className="eval-comment" key={`${e.evaluator.user_id}-${k}`}>
                            <div className="eval-comment__head">
                              <Avatar name={e.evaluator.display_name || "?"} size="sm" />
                              <span className="chat-msg__name">{e.evaluator.display_name || "?"}</span>
                              <span className="badge badge-muted eval-comment__aspect">{label}</span>
                            </div>
                            <p className="eval-comment__text">{e.comments?.[k]}</p>
                          </div>
                        )),
                      )}
                    </div>
                  </>
                )}
              </>
            )}
            <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
              5観点は<strong>均等平均</strong>。コインは <code>round(平均×10)</code>（最大50）を投稿者に付与。コスト観点は
              <strong>低コストほど高得点</strong>。
            </p>

            {/* 評価者向けアクション（評価者権限がある場合のみ・サーバー算出 my_permissions） */}
            {canEvaluate && (
              <div className="modal__foot" style={{ marginTop: "var(--space-4)" }}>
                <Link className="btn btn-primary" href={`/ideas/${ideaId}/eval`}>
                  評価する / 編集
                </Link>
              </div>
            )}
          </section>

          {/* 情報（メタ） */}
          <section className="card" aria-label="情報">
            <h2 className="card-title">情報</h2>
            <dl className="info-list">
              <dt>ステータス</dt>
              <dd>
                <span className={stClass}>{stLabel}</span>
              </dd>
              <dt>公開範囲</dt>
              <dd>このクエストのパーティー内</dd>
              <dt>版</dt>
              <dd>v{idea.current_revision}</dd>
              <dt>投稿日</dt>
              <dd>{fmtDate(idea.created_at)}</dd>
              <dt>最終更新</dt>
              <dd>{fmtDate(idea.updated_at)}</dd>
            </dl>
          </section>
        </div>
      </div>

      {/* ============ アイデア編集モーダル（SC-21 フォームの編集モード） ============ */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="アイデアを編集" size="lg">
        <IdeaForm mode="edit" ideaId={ideaId} onDone={() => { setEditOpen(false); void load(); }} onCancel={() => setEditOpen(false)} />
      </Modal>

      {/* ============ 更新履歴モーダル（版タイムライン＋差分・D.4 実接続） ============ */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="更新履歴" size="lg">
        <ModalBody>
          <p className="role-note" style={{ marginTop: 0 }}>
            アイデアの変更を新しい順に表示します。各版を開くと差分（
            <span className="diff-add">追加</span>／<span className="diff-del">削除</span>）が見られます。
          </p>
          <div style={{ marginTop: "var(--space-4)" }}>
            <RevisionHistory ideaId={ideaId} currentRevision={idea.current_revision} />
          </div>
        </ModalBody>
        <ModalFooter>
          <button className="btn btn-outline" type="button" onClick={() => setHistoryOpen(false)}>
            閉じる
          </button>
        </ModalFooter>
      </Modal>
    </main>
  );
}
