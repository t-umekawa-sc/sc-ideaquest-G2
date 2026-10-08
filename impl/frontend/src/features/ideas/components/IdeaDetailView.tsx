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

import { LoadingOverlay, Avatar, Modal, ModalBody, ModalFooter, RowMenu, SparkBurst, XpFloat, ActivitySpark, useConfirm, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout/QuestIcon";
import { ApiError } from "@/lib/api/client";
import { voteErrorMessage } from "../voteError";
import { reduceMotion } from "@/lib/motion";
import { backToListOr, consumeIdeaFromQuest, markEvalFromIdea } from "@/lib/nav";

import { EVALUATIONS_CHANGED_EVENT, getEvaluationAggregate, regenerateAiEvaluation, selectIdea, unselectIdea, type EvaluationAggregate } from "@/features/evaluations/api";
import { EvaluationComments } from "@/features/evaluations/components/EvaluationComments";
import { getChat, getChatActivity, type ChatActivity, type ChatMessage } from "@/features/chat/api";
import { decideIdeaParticipation, getIdeaParticipation, requestIdeaParticipation, type IdeaParticipationContext } from "@/features/contests/api";
import { RelatedInfoPanel } from "@/features/info-input";

import { deleteIdea, followIdea, getAttachmentDownloadUrl, getIdea, IDEAS_CHANGED_EVENT, promoteIdeaToQuest, removeVote, unfollowIdea, voteIdea, type IdeaDetail, type IdeaVoteType } from "../api";
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
  const confirm = useConfirm();
  // 戻るラベルの文脈判定（動的ラベル）＝クエストのアイデア一覧から来た時だけ「← {クエスト名}へ戻る」。
  // 来歴（sessionStorage）はマウント時に1回だけ消費（ref ガードで StrictMode 二重実行も防ぐ）。
  // 直アクセス（履歴なし）は戻る先＝クエスト（backToListOr の fallback）なのでクエスト名を出す。
  const [fromQuestId, setFromQuestId] = useState<string | null>(null);
  const [directAccess, setDirectAccess] = useState(false);
  const backCtxConsumed = useRef(false);
  useEffect(() => {
    if (backCtxConsumed.current) return;
    backCtxConsumed.current = true;
    setFromQuestId(consumeIdeaFromQuest());
    setDirectAccess(typeof window !== "undefined" && window.history.length <= 1);
  }, []);
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
  // Tier2 議論参加（コンテスト配下アイデアのみ・SC-22 チャットカードの導線）。
  const [partCtx, setPartCtx] = useState<IdeaParticipationContext | null>(null);
  const [partBusy, setPartBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 投票/フォローは楽観更新のためローカル state で保持（load 時に DTO から同期）。
  const [vote, setVote] = useState<{ approve: number; oppose: number; my: IdeaVoteType | null; stale: boolean }>({ approve: 0, oppose: 0, my: null, stale: false });
  const [following, setFollowing] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [promoteBusy, setPromoteBusy] = useState(false);
  // 評価結果（F.1 集計）＋選定状態（楽観更新）。
  const [evalAgg, setEvalAgg] = useState<EvaluationAggregate | null>(null);
  const [selected, setSelected] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);
  const [celebrateSelect, setCelebrateSelect] = useState(false); // #16: 選定成立の祝福オーバーレイ
  const [voteBarReady, setVoteBarReady] = useState(false); // #23: 賛否バーを「バー描画後」に 0→比率へ伸ばす
  // ローディング中はバー未描画（if (loading) return）ゆえ、マウント直後に立てると初回の 0→比率が再生されない。
  // loading=false になってバーが width:0 で描画された次フレーム以降に立てる（二重 rAF で 0 のフレームを確実に描画）。
  useEffect(() => {
    if (loading) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setVoteBarReady(true)); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [loading]);
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
        // Tier2 議論参加の文脈（コンテスト配下のみ・チャットカードの導線）。
        if (d.is_contest) void getIdeaParticipation(ideaId).then(setPartCtx).catch(() => setPartCtx(null));
        else setPartCtx(null);
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

  // Tier2 参加の操作（リクエスト／投稿者の承認・却下）。成功で文脈を再取得。
  const reloadPart = useCallback(() => {
    void getIdeaParticipation(ideaId).then(setPartCtx).catch(() => {});
  }, [ideaId]);
  async function requestPart() {
    setPartBusy(true);
    try {
      const r = await requestIdeaParticipation(ideaId);
      if (!r) { snack({ type: "error", title: "リクエストできませんでした（コンテストへの参加が必要な場合があります）" }); return; }
      snack({ type: "success", title: r.status === "approved" ? "参加しました" : "参加をリクエストしました（投稿者の承認待ち）" });
      reloadPart();
    } catch { snack({ type: "error", title: "リクエストに失敗しました" }); } finally { setPartBusy(false); }
  }
  async function decidePart(userId: string, status: "approved" | "rejected") {
    setPartBusy(true);
    try {
      const r = await decideIdeaParticipation(ideaId, userId, status);
      if (!r) { snack({ type: "error", title: "更新できませんでした" }); return; }
      snack({ type: "success", title: status === "approved" ? "参加を承認しました" : "参加を却下しました" });
      reloadPart();
    } catch { snack({ type: "error", title: "更新に失敗しました" }); } finally { setPartBusy(false); }
  }

  // 評価確定（別ルートの評価モーダル）後に評価結果/選定を再取得＝リロード不要で反映（F.1・クロスルート）。
  useEffect(() => {
    const onEval = () => void load();
    window.addEventListener(EVALUATIONS_CHANGED_EVENT, onEval);
    return () => window.removeEventListener(EVALUATIONS_CHANGED_EVENT, onEval);
  }, [load]);

  // 添付の即時削除（SC-21 編集フォーム）等を跨いで反映＝保存/キャンセルに関わらず詳細を再取得（D.3）。
  // 削除は取り消せない副作用なので、編集をキャンセルしても詳細から消えるようにする。
  useEffect(() => {
    const onIdeas = () => void load();
    window.addEventListener(IDEAS_CHANGED_EVENT, onIdeas);
    return () => window.removeEventListener(IDEAS_CHANGED_EVENT, onIdeas);
  }, [load]);

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
      // 409/403 はサーバーの理由（締切後/完了/公開前/権限）を優先表示（voteErrorMessage）。404/401 は専用文言。
      const msg =
        status === 404 ? "このアイデアは見つからないか、参照する権限がありません。"
        : status === 401 ? "セッションが切れています。再ログインしてください。"
        : voteErrorMessage(err);
      snack({ type: "error", msg });
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
    // 完了クエストは新規フォロー不可（解除のみ可・D.6）。ボタンは押せるが押下時に理由を明示（無反応にしない）。
    if (idea?.quest?.status === "completed" && !following) {
      snack({ type: "info", msg: "完了したクエストには新規フォローできません（フォロー解除のみ可能です）。" });
      return;
    }
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
  }, [ideaId, following, followBusy, snack, idea?.quest?.status]);

  // アイデア削除（詳細ヘッダー⋮・操作統一 §4.14）。投稿者本人（is_mine）＝ボタン表示、owner/quest_admin もサーバー権威。
  // 削除後は所属クエスト詳細へ戻る（一覧・詳細から見えなくなる＝議論/投票は監査保持）。
  const onDeleteIdea = useCallback(async () => {
    if (!idea) return;
    const ok = await confirm({ variant: "danger", title: "アイデアを削除", msg: `「${idea.title}」を削除しますか？ 一覧・詳細から見えなくなります（議論・投票等は監査のため保持されます）。` });
    if (!ok) return;
    try {
      await deleteIdea(idea.id);
      window.dispatchEvent(new Event(IDEAS_CHANGED_EVENT));
      snack({ type: "success", title: "アイデアを削除しました" });
      router.push(`/quests/${idea.quest.id}`);
    } catch {
      snack({ type: "error", title: "削除できませんでした", msg: "権限が必要な場合があります。時間をおいて再度お試しください。" });
    }
  }, [idea, confirm, snack, router]);

  // アイデア→クエスト昇格（T.5・FR-47・社内のみ・要 quest_create）。コンテストの有望アイデアを種に
  // 別実体の独立業務クエストを起票（内容コピー＋由来参照）＝コンセプト創造・検証以降へ接続。
  // ボタンは can_promote（サーバー権威＝コンテスト配下×非public×権限）でのみ表示。成功後は新クエストへ遷移。
  const handlePromote = useCallback(async () => {
    if (!idea) return;
    const ok = await confirm({
      title: "クエストへ昇格",
      msg: `「${idea.title}」を種に新しいクエストを作成します。内容（本文・狙う価値）がコピーされ、由来としてこのアイデアが参照されます。`,
    });
    if (!ok) return;
    setPromoteBusy(true);
    try {
      const q = await promoteIdeaToQuest(idea.id);
      if (q) {
        snack({ type: "success", title: "クエストを作成しました", msg: "由来アイデアを種に業務クエストを起票しました。" });
        router.push(`/quests/${q.id}`);
      }
    } catch (e) {
      snack({ type: "error", title: "昇格できませんでした", msg: e instanceof ApiError ? e.message : "権限が必要な場合があります。時間をおいて再度お試しください。" });
    } finally {
      setPromoteBusy(false);
    }
  }, [idea, confirm, snack, router]);

  // 選定/選定解除（F.3・owner/quest_admin）。楽観更新＋サーバー権威（409/403 でロールバック＋理由トースト）。
  const handleSelect = useCallback(async () => {
    if (selectBusy) return;
    const prev = selected;
    setSelectBusy(true);
    setSelected(!prev);
    try {
      const res = prev ? await unselectIdea(ideaId) : await selectIdea(ideaId);
      if (res) setSelected(res.is_selected);
      // 新規選定で**実際に XP を付与したときだけ**祝福＋付与メッセージ（再選定・解除では出さない）。
      // 付与の有無は server 権威（xp_awarded・冪等）＝ON/OFF を繰り返しても毎回演出しない。
      const awarded = !prev && res?.xp_awarded === true;
      snack({
        type: prev ? "info" : "success",
        msg: prev
          ? "選定を解除しました。"
          : awarded
            ? "アイデアを選定しました。投稿者に XP を付与しました。"
            : "アイデアを選定しました。",
      });
      if (awarded && !reduceMotion()) {
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

  // AI 評価の再生成（F.7.3・評価者権限のみ＝サーバー権威）。完了/権限/モデル無効はサーバーが 409/403/422。
  const [regenerating, setRegenerating] = useState(false);
  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await regenerateAiEvaluation(ideaId);
      snack({ type: "success", title: "AI 評価の再生成を開始しました", msg: "生成が完了すると評価結果に反映されます（AI処理状況で進捗を確認できます）。" });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      snack({
        type: "error",
        msg:
          status === 409 ? "完了したクエストでは再生成できません。"
          : status === 403 ? "AI 評価を再生成する権限がありません（評価者権限が必要です）。"
          : status === 422 ? "この会社では AI 評価のモデルが有効化されていません。"
          : "再生成の開始に失敗しました。時間をおいて再度お試しください。",
      });
    } finally {
      setRegenerating(false);
    }
  }, [ideaId, regenerating, snack]);

  if (loading) {
    return <main className="container detail-main"><LoadingOverlay /></main>;
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
  // フォローは「解除のみ可」＝完了&未フォローでも押下は許可し、handleFollow が理由を info 表示する（無反応にしない）。disabled は送信中のみ。
  const followDisabled = followBusy;
  const authorName = idea.author.display_name || "?";
  const stakeText = idea.stakeholders.map((s) => s.label).join("・") || "—";
  // 経営方針との整合（SC-22 バッジ・FR-44）＝best＋どの方針＋獲得コイン（キーワードベースの関連度・正直表記）。
  const align = (idea.alignment as {
    best_score: number; best_strategy: { id: string; title: string }; coins_awarded: number;
  } | null) ?? null;
  const alignPct = align ? Math.round(align.best_score * 100) : 0;
  // 評価結果（F.1 集計）＝サーバー算出の my_permissions で UX 出し分け。
  const canEvaluate = !!evalAgg?.my_permissions?.includes("evaluate");
  const canSelect = !!evalAgg?.my_permissions?.includes("select");
  const evalCount = evalAgg?.evaluator_count ?? 0;
  const evalCoin = evalAgg?.coin?.finalized ?? evalAgg?.coin?.projected ?? 0;
  // 活発度スパーク（E.1 daily・版マーカー日は ◆）＝共有 ActivitySpark へデータ整形。
  const chatTotal = chatActivity?.total_messages ?? 0;
  const sparkDaily = (chatActivity?.daily ?? []).map((d) => ({ date: d.date, count: d.message_count }));
  const revMarkers = (chatActivity?.revision_markers ?? []).map((m) => m.date);

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
      {/* 戻る＝標準どおり履歴を戻す（デザイン標準 §4.5 ⑨・line 191）＝来た画面へ戻り、アイデアタブ一覧の
          検索/ソート/絞込/ページ・スクロール位置を復元する（quest URL クエリに載るため）。直アクセス（履歴なし）は
          素のクエスト詳細へフォールバック。フローティング表示は §4.10。href は右クリック/新規タブ/JS 無効時の保険。
          ラベルは動的＝クエストの一覧から来た時（or 直アクセスで戻り先がクエスト）だけ「← {クエスト名}へ戻る」、
          それ以外（ダッシュボードの評価下書き経由・チャット等）は「← 戻る」＝動きとラベルを一致させる。 */}
      <Link
        className="backlink backlink--float"
        href={`/quests/${idea.quest.id}`}
        onClick={(e) => { e.preventDefault(); backToListOr(router, `/quests/${idea.quest.id}`); }}
      >
        {(fromQuestId != null ? fromQuestId === idea.quest.id : directAccess)
          ? `← ${idea.quest.title || "クエスト"}へ戻る`
          : "← 戻る"}
      </Link>

      {/* ============ アイデアヘッダー ============ */}
      <section className="card idea-head" aria-label="アイデア情報">
        <div className="idea-head__top">
          <div style={{ minWidth: 0 }}>
            {/* コンセプト詳細（🧩 コンセプト）と対になる種別表示＝「💡 アイデア」を明示（labels.ts と統一）。 */}
            <div className="idea-eyebrow">💡 アイデア</div>
            <div className="idea-head__badges">
              {idea.quest.categories.map((c) => (
                <span className="badge badge-muted" key={c}>{c}</span>
              ))}
              <span className={stClass}>{stLabel}</span>
              {questCompleted && <span className="badge badge-muted" title="完了したクエストは投票/新規フォローが凍結されています">⏸ 完了（凍結）</span>}
              {!questCompleted && voteClosedByDeadline && <span className="badge badge-muted" title="締切日を過ぎたため投票は締め切られています">🔒 投票締切</span>}
              {align && align.best_score > 0 && (
                <span
                  className={align.coins_awarded ? "badge badge-success" : "badge badge-muted"}
                  title={`経営方針「${align.best_strategy.title}」との関連度（キーワードベース）${alignPct}%${align.coins_awarded ? `・獲得 ${align.coins_awarded} コイン` : ""}`}
                >
                  🎯 方針整合 {alignPct}%{align.coins_awarded ? ` ・ +${align.coins_awarded}🪙` : ""}
                </span>
              )}
            </div>
            {/* アイデアアイコン（個別→作成者既定→件名先頭1文字タイル〔クエストアクセント色〕・デザイン標準 Phase 3）を件名の左に表示。 */}
            <div className="idea-head__title">
              <QuestIcon name={idea.title} color={idea.quest.color} imageUrl={idea.icon_image_url} size="sm" />
              <h1>{idea.title}</h1>
            </div>
            <div className="poster">
              <Avatar name={authorName} imageUrl={idea.author.avatar_image_url ?? undefined} size="sm" level={idea.author.level ?? undefined} />
              <span className="name">投稿: {authorName}</span>
            </div>
          </div>
          {/* 操作エリア統一（デザイン標準 §4.14）＝一次アクション(フォロー)→編集(権限時)→⋮(削除danger)。 */}
          <div className="idea-actions detail-head__actions">
            {/* フォロー（D.6・トグル）。詳細画面は枠付き星＋テキスト（.follow-toggle）。completed は新規フォロー不可＝事前無効化（解除は可）＋サーバー 409 も権威。 */}
            <button
              className="follow-toggle"
              type="button"
              aria-pressed={following}
              disabled={followDisabled}
              title={questCompleted && !following ? "完了したクエストには新規フォローできません" : undefined}
              onClick={() => void handleFollow()}
            >
              {following ? "★ フォロー中" : "☆ フォロー"}
            </button>
            {/* 編集＝SC-21 フォーム編集モード（D.2 PATCH・本人/管理のみサーバー強制）。
                ボタンは投稿者本人のみ表示（is_mine・サーバー権威／SC-22 §4.5・決定 2026-09-06）。
                完了クエストは事前無効化＝入力後に「保存できません」を避ける（選定/投票と同じ凍結UXに統一・サーバー 409 も権威）。 */}
            {/* クエストへ昇格（T.5・FR-47）＝コンテストの有望アイデアを種に業務クエストを起票。
                表示は can_promote（サーバー権威＝コンテスト配下×非public×quest_create/管理者）のみ。
                ⋮（削除danger）を最右に保つため編集/⋮ブロックより前に置く（操作統一§4.14）。 */}
            {idea.can_promote && (
              <button
                className="btn btn-outline"
                type="button"
                disabled={promoteBusy}
                title="このアイデアを種に新しいクエストを作成します"
                onClick={() => void handlePromote()}
              >
                🚀 クエストへ昇格
              </button>
            )}
            {idea.is_mine && (
              <>
                <button
                  className={`btn btn-outline${questCompleted ? " is-frozen" : ""}`}
                  type="button"
                  disabled={questCompleted}
                  title={questCompleted ? "完了したクエストでは編集できません" : undefined}
                  onClick={() => setEditOpen(true)}
                >
                  編集
                </button>
                {/* 削除＝⋮の最下部（danger・操作統一§4.14）。削除は親クエスト依存をやめ詳細にも常設。⋮は最右。 */}
                <RowMenu items={[{ label: "アイデアを削除", danger: true, onClick: () => void onDeleteIdea() }]} />
              </>
            )}
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
          {/* 所属クエストへの動線（ダッシュボード等から直接アイデアに来た時にクエストへ辿れるように）。 */}
          <span>🧭 所属クエスト: <Link href={`/quests/${idea.quest.id}`}>{idea.quest.title || "クエスト"}</Link></span>
        </div>
      </section>

      {/* 関連情報ストリップ＝概要の直下・全幅（クエスト詳細 SC-12 と同じ strip 配置・FR-41 Phase1 slice②）。
          コンテスト配下のアイデアでは非表示（FR-46・ユーザー方針）。Tier2 参加導線はチャットカードに集約。 */}
      {!idea.is_contest && <RelatedInfoPanel targetType="ideas" targetId={ideaId} variant="strip" />}

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

            {/* 議論アクティビティ・グラフ（E.1 chat-activity 実データ）＝共有 ActivitySpark */}
            <ActivitySpark
              daily={sparkDaily}
              markers={revMarkers}
              legend="◆ = アイデア更新の記録された日。棒＝日次メッセージ数（直近3日を強調）。"
            />

            {/* 直近メッセージのプレビュー（E.1・最新3件） */}
            {chatPreview.length > 0 ? (
              <div className="chat-preview">
                {chatPreview.map((m) => (
                  <div className="chat-msg" key={m.id}>
                    <Avatar name={m.author?.name || "?"} imageUrl={m.author?.avatar ?? undefined} size="sm" />
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
            {/* コンテスト配下＝Tier2（議論参加）承認制。投稿者には参加リクエストの承認/却下を表示（案X・FR-46）。 */}
            {idea.is_contest && partCtx?.is_author && (partCtx.requests ?? []).some((r) => r.status === "requested") && (
              <div className="idea-part-requests" style={{ marginBottom: "var(--space-3)" }}>
                <p className="role-note" style={{ marginBottom: "var(--space-2)" }}>💬 議論への参加リクエスト（承認するとチャットに参加できます）</p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {(partCtx.requests ?? []).filter((r) => r.status === "requested").map((r) => (
                    <li key={r.user_id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <Avatar name={r.display_name ?? "?"} size="sm" />
                      <span style={{ fontWeight: 500 }}>{r.display_name ?? "（不明）"}</span>
                      <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => void decidePart(r.user_id, "approved")} disabled={partBusy}>承認</button>
                        <button className="btn btn-outline btn-sm" type="button" onClick={() => void decidePart(r.user_id, "rejected")} disabled={partBusy}>却下</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* チャットを開く／議論に参加をリクエスト＝Tier2 承認状態で切替（コンテスト配下）。 */}
            {(() => {
              const canChat = !idea.is_contest || partCtx?.is_author || partCtx?.my_status === "approved";
              if (canChat) return <Link className="btn btn-primary" href={`/ideas/${ideaId}/chat`}>チャットを開く →</Link>;
              if (partCtx?.my_status === "requested") return <button className="btn btn-outline" type="button" disabled>⏳ 承認待ち</button>;
              return <button className="btn btn-primary" type="button" onClick={() => void requestPart()} disabled={partBusy}>💬 議論に参加をリクエスト</button>;
            })()}
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
              <button className={`vote-btn agree${myVote === "agree" ? " is-on" : ""}${voteClose.closed ? " is-frozen" : ""}`} type="button" aria-pressed={myVote === "agree"} disabled={voteDisabled} title={voteCloseTitle} onClick={(e) => void handleVote("approve", e)}>
                ▲ 賛成
              </button>
              <button className={`vote-btn disagree${myVote === "disagree" ? " is-on" : ""}${voteClose.closed ? " is-frozen" : ""}`} type="button" aria-pressed={myVote === "disagree"} disabled={voteDisabled} title={voteCloseTitle} onClick={(e) => void handleVote("oppose", e)}>
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
                  className={`btn btn-sm ${selected ? "btn-primary" : "btn-outline"}${questCompleted ? " is-frozen" : ""}`}
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

                {/* コメント＝観点ごと代表1件（タブ=高評価/合意/懸念）＋総評代表＋他N件→#13 評価詳細（F.1.1/F.1.2） */}
                {evalAgg && (
                  <EvaluationComments
                    evaluators={evalAgg.evaluators ?? []}
                    aspectLabels={ASPECT_LABELS}
                    aiEvaluation={evalAgg.ai_evaluation}
                    title={idea?.title ?? "アイデア"}
                  />
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
                {questCompleted ? (
                  // 完了クエストは評価も凍結（サーバー 409）＝事前無効化＋理由ツールチップに統一（選定/投票/編集と同型）。
                  <button className="btn btn-primary is-frozen" type="button" disabled title="完了したクエストでは評価できません">
                    評価する / 編集
                  </button>
                ) : (
                  <Link className="btn btn-primary" href={`/ideas/${ideaId}/eval`} onClick={() => markEvalFromIdea()}>
                    評価する / 編集
                  </Link>
                )}
              </div>
            )}
          </section>

          {/* AI 評価（独立した評価者・FR-50・F.7.4）＝人間とは別枠カード。集計/コインには算入（上の平均に反映）。 */}
          {evalAgg?.ai_evaluation && (
            <section className="card ai-eval" aria-label="AI評価">
              <div className="eval-head">
                <span className="ai-badge">🤖 AI評価</span>
                {evalAgg.ai_evaluation.model && <span className="badge badge-muted">{evalAgg.ai_evaluation.model}</span>}
              </div>
              {evalAgg.ai_evaluation.generated_at && (
                <p className="ai-meta">{new Date(evalAgg.ai_evaluation.generated_at).toLocaleString("ja-JP")} 生成 ・ 独立した評価者として採点（集計・コインに算入）</p>
              )}
              {ASPECT_LABELS.map(([key, label]) => {
                const v = evalAgg.ai_evaluation?.scores?.[key];
                const cmt = evalAgg.ai_evaluation?.comments?.[key];
                return (
                  <div key={key}>
                    <div className="score-row">
                      <span className="score-row__label">{label}{key === "cost" && <span className="muted" title="低コストほど高得点">ⓘ</span>}</span>
                      <span className="score-bar"><i style={{ width: `${v ? (v / 5) * 100 : 0}%` }} /></span>
                      <span className="score-row__val">{v ? v.toFixed(1) : "–"}</span>
                    </div>
                    {cmt && <p className="eval-comment__text eval-comment__text--indent">{cmt}</p>}
                  </div>
                );
              })}
              {evalAgg.ai_evaluation.overall_comment && (
                <>
                  <div className="eval-section-label">総評</div>
                  <div className="eval-overall__item"><p className="eval-comment__text">{evalAgg.ai_evaluation.overall_comment}</p></div>
                </>
              )}
              {canEvaluate && (
                <div className="modal__foot" style={{ marginTop: "var(--space-4)" }}>
                  {questCompleted ? (
                    <button className="btn btn-outline is-frozen" type="button" disabled title="完了したクエストでは再生成できません">AI評価を再生成</button>
                  ) : (
                    <button className="btn btn-outline" type="button" onClick={() => void handleRegenerate()} disabled={regenerating}>
                      {regenerating ? "再生成中…" : "AI評価を再生成"}
                    </button>
                  )}
                </div>
              )}
              <p className="role-note" style={{ marginTop: "var(--space-2)" }}>▲ 再生成は<strong>評価者権限</strong>を持つ人のみ。</p>
            </section>
          )}

          {/* 情報（メタ） */}
          <section className="card" aria-label="情報">
            <h2 className="card-title">情報</h2>
            <dl className="info-list">
              <dt>ステータス</dt>
              <dd>
                <span className={stClass}>{stLabel}</span>
              </dd>
              <dt>公開範囲</dt>
              <dd>このクエストのパーティ内</dd>
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
