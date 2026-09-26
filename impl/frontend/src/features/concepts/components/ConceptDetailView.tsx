"use client";

// SC-61 コンセプト詳細（フルページ・FR-42・P.1）。SC-22 アイデア詳細と同型＝共有クラス/部品を再利用する
// （戻るリンク backlink--float・ヘッダー .card.idea-head・関連情報 RelatedInfoPanel・投票 .vote-* パネル・2カラム .idea-layout）。
// コンセプト固有（スキーマA/B/Cグループ・前提と検証・総合判定・ガイダンスⓘ）だけ concepts.css で足す。DRY（フロー規約 §2/§2.1）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ActivitySpark, Avatar, LoadingOverlay, Modal, ModalBody, ModalFooter, ScreenPurpose, useConfirm, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout/QuestIcon";
import { getScopeChat, getScopeChatActivity, type ChatActivity, type ChatMessage } from "@/features/chat/api";
import { ConceptDecisionLogView, ConceptRevisionHistory } from "./ConceptHistory";
import { RelatedInfoPanel } from "@/features/info-input";
import { votePercents } from "@/features/ideas/voting";
import { ApiError } from "@/lib/api/client";
import { backToListOr } from "@/lib/nav";

import {
  addValidation, CONCEPTS_CHANGED_EVENT, createGroupScope, getConcept, getEvaluationAggregate, linkAssumption, listAssumptions, listChatScopes,
  selectConcept, setDecision, unlinkAssumption, unselectConcept, unvoteConcept, voteConcept,
  type AssumptionListResponse, type ConceptChatScopeItem, type ConceptDetail, type ConceptVoteType, type EvaluationAggregate,
} from "../api";
import { AssumptionCard } from "./AssumptionCard";
import "@/features/ideas/ideas.css"; // 共有ヘッダー/投票/レイアウトのクラス（.idea-head/.idea-rail/.vote-* 等）
import "../concepts.css";

const STATUS_LABEL: Record<string, [string, string]> = {
  draft: ["下書き", "badge badge-muted"], active: ["検証中", "badge badge-success"], archived: ["保管", "badge badge-muted"],
};
const DECISION_LABEL: Record<string, [string, string]> = {
  undecided: ["未判定", "badge badge-muted"], go: ["推進", "badge badge-success"], pivot: ["方向転換", "badge badge-muted"], kill: ["中止", "badge badge-danger"],
};
const DECISION_CHOICES: readonly [string, string][] = [["go", "推進"], ["pivot", "方向転換"], ["kill", "中止"]];
// 前提の重要度/判定ラベルは AssumptionCard に移設（前提と検証セクションで使用）。
// 評価観点＝中核5＋補助3（SC-25 の観点バーと同じ描画に使う）。
const ASPECT_LABELS: [string, string][] = [
  ["desirability", "望ましさ"], ["feasibility", "実現可能性"], ["viability", "採算・事業性"],
  ["assumption_strength", "前提検証の強さ"], ["differentiation", "差別化"],
  ["novelty", "新規性"], ["sustainability", "持続可能性"], ["ip", "知的財産"],
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function Badge({ map, value }: { map: Record<string, [string, string]>; value: string }) {
  const [label, cls] = map[value] ?? [value, "badge badge-muted"];
  return <span className={cls}>{label}</span>;
}

function ConceptGuide() {
  return (
    <ScreenPurpose
      label="コンセプトとは？"
      summary="選別済みアイデアを統合し、主要な前提を「証拠で」検証（desirability・feasibility・viability）しながら 推進 / 方向転換 / 中止 の判断まで導く検証可能な提案（ISO 56001 §8.3 ②③段）。粒度＝1クエスト内で競合する検証単位。"
      dialogTitle="この画面について（ISO 56001 準拠）"
    >
      <div className="dialog-section"><div className="dialog-label">コンセプトとは</div><p style={{ margin: 0 }}>選別済みのアイデア（複数）を統合し、<strong>課題・機会／狙う価値と対象／競合・差別化／解の形態と必要な能力／採算・事業性（viability）／前提と検証</strong>をひとまとめにした、<strong>検証可能な提案</strong>です（ISO 56001 §8.3 ②③段）。</p></div>
      <div className="dialog-section"><div className="dialog-label">この画面の狙い</div><p style={{ margin: 0 }}>主要な前提を「証拠で」検証しながら <strong>推進 / 方向転換 / 中止</strong> の判断まで導きます。否定的な検証結果こそ価値。</p></div>
      <div className="dialog-section"><div className="dialog-label">粒度</div><p style={{ margin: 0 }}><strong>1 クエスト内</strong>で複数候補が競合し、所有者が勝ち残りを選定。アイデアより大きく、ソリューション（実装）より前の単位です。</p></div>
    </ScreenPurpose>
  );
}

export function ConceptDetailView({ conceptId }: { conceptId: string }) {
  const router = useRouter();
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [vote, setVote] = useState<{ approve: number; oppose: number; my: ConceptVoteType | null }>({ approve: 0, oppose: 0, my: null });
  const [evalAgg, setEvalAgg] = useState<EvaluationAggregate | null>(null);
  const [scopes, setScopes] = useState<ConceptChatScopeItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // 更新履歴モーダル（変更履歴標準 §3.1）
  const [chatActivity, setChatActivity] = useState<ChatActivity | null>(null); // 総合ルームの議論活発度（E.1）
  const [chatPreview, setChatPreview] = useState<ChatMessage[]>([]); // 総合ルームの直近メッセージ（最新3件）
  // 前提のリンク（P.4）＝検証プールから選んでこのコンセプトに紐づける。
  const [linkOpen, setLinkOpen] = useState(false);
  const [pool, setPool] = useState<AssumptionListResponse["items"] | null>(null);
  const [linkSel, setLinkSel] = useState<string>("");
  const [linkCrit, setLinkCrit] = useState<"critical" | "major" | "minor">("major");
  // 実績入力（検証追記・P.3）ダイアログ＝どの前提に対して、手法/判定/実施日/規模/結果。
  const [valDialog, setValDialog] = useState<{ assumptionId: string; method: string; verdict: "supported" | "refuted" | "inconclusive"; validatedOn: string; scale: string; result: string } | null>(null);
  const [valSaving, setValSaving] = useState(false);
  const [valReloadToken, setValReloadToken] = useState(0); // 実績追加後に検証履歴を再取得させる

  const load = useCallback(async () => {
    const c = await getConcept(conceptId);
    setConcept(c);
    if (c) {
      const v = c.vote ?? { summary: { approve: 0, oppose: 0 }, my_vote: null };
      const mv = v.my_vote;
      setVote({ approve: v.summary?.approve ?? 0, oppose: v.summary?.oppose ?? 0, my: mv === "approve" || mv === "oppose" ? mv : null });
    }
    setLoading(false);
  }, [conceptId]);

  // 評価結果は SC-22 と同じく集計 EP から別途取得（観点別平均・評価者ごとの総評/コメント・複数名対応）。
  const loadEval = useCallback(() => { void getEvaluationAggregate(conceptId).then(setEvalAgg).catch(() => {}); }, [conceptId]);
  // 議論チャットのルーム一覧（総合＝常在／グループ・前提＝あれば）＝動線の遷移先解決に使う（P.6）。
  const loadScopes = useCallback(() => { void listChatScopes(conceptId).then((r) => setScopes(r?.items ?? [])).catch(() => {}); }, [conceptId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    loadEval();
    loadScopes();
    const onChanged = () => { void load(); loadEval(); loadScopes(); };
    window.addEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
  }, [loadEval, loadScopes, load]);

  const perms = concept?.my_permissions ?? [];
  const canManage = perms.includes("manage");
  const overallScope = scopes.find((s) => s.kind === "overall");

  // 総合ルームの議論活発度（E.1）＋直近メッセージ（最新3件）＝アイデア詳細 SC-22 のチャット節と同型。総合ルーム確定後に取得。
  useEffect(() => {
    const sid = overallScope?.scope_id;
    if (!sid) return;
    let alive = true;
    void getScopeChatActivity(sid).then((a) => { if (alive) setChatActivity(a); }).catch(() => {});
    void getScopeChat(sid, { limit: 50 }).then((c) => { if (alive) setChatPreview((c?.data ?? []).filter((m) => !m.is_deleted).slice(-3)); }).catch(() => {});
    return () => { alive = false; };
  }, [overallScope?.scope_id]);

  // グループ議論へ遷移＝ラベル一致のルームがあれば開く／無ければ作成（owner/quest_admin）してから開く。
  const discussGroup = async (label: string) => {
    if (busy) return;
    const existing = scopes.find((s) => s.kind === "group" && s.label === label);
    if (existing) { router.push(`/concepts/${conceptId}/chat/${existing.scope_id}`); return; }
    setBusy(true);
    try {
      const created = await createGroupScope(conceptId, label);
      if (created) { loadScopes(); router.push(`/concepts/${conceptId}/chat/${created.scope_id}`); }
    } catch (e) {
      snack({ type: "error", msg: e instanceof ApiError && e.status === 403 ? "議論ルームの作成は 所有者/クエスト管理者のみです" : "議論ルームを開けませんでした" });
    } finally { setBusy(false); }
  };

  const onVote = async (type: ConceptVoteType) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = vote.my === type ? await unvoteConcept(conceptId) : await voteConcept(conceptId, type);
      if (next) setVote({ approve: next.summary?.approve ?? 0, oppose: next.summary?.oppose ?? 0, my: (next.my_vote as ConceptVoteType | null) ?? null });
      if (next && (next.xp_delta ?? 0) > 0) snack({ type: "success", title: `+${next.xp_delta} XP` });
    } catch (e) {
      snack({ type: "error", msg: e instanceof ApiError ? "投票できませんでした" : "通信に失敗しました" });
    } finally { setBusy(false); }
  };

  const runManage = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await load(); snack({ type: "success", title: ok }); }
    catch { snack({ type: "error", msg: "操作できませんでした" }); }
    finally { setBusy(false); }
  };

  // 前提リンク（P.4）＝検証プールを開いて未リンクの前提を選び、criticality を付けて紐づける。
  const openLinkDialog = async () => {
    if (!concept) return;
    setLinkSel(""); setLinkCrit("major"); setLinkOpen(true);
    const r = await listAssumptions(concept.quest_id).catch(() => null);
    setPool(r?.items ?? []);
  };
  const doLink = async () => {
    if (!linkSel) return;
    await runManage(() => linkAssumption(conceptId, linkSel, linkCrit), "前提をリンクしました");
    setLinkOpen(false);
  };
  const doUnlink = async (assumptionId: string, statement: string) => {
    const ok = await confirm({ variant: "danger", title: "前提のリンクを解除", msg: `「${statement}」をこのコンセプトから外しますか？（前提自体は検証プールに残ります）` });
    if (!ok) return;
    await runManage(() => unlinkAssumption(conceptId, assumptionId), "リンクを解除しました");
  };

  // 実績入力（検証追記）＝実施日を今日で初期化して開く。
  const openValidate = (assumptionId: string) => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setValDialog({ assumptionId, method: "", verdict: "supported", validatedOn: iso, scale: "", result: "" });
  };
  const saveValidation = async () => {
    if (!valDialog || valSaving) return;
    // 主ボタンは常に押せる（デザイン標準 §4.1）。手法・実施日・規模は必須（§4.4）。
    if (!valDialog.method.trim() || !valDialog.validatedOn || !valDialog.scale.trim()) {
      snack({ type: "error", title: "手法・実施日・規模は必須です" }); return;
    }
    setValSaving(true);
    try {
      await addValidation(valDialog.assumptionId, {
        method: valDialog.method.trim(), verdict: valDialog.verdict, validated_on: valDialog.validatedOn,
        scale: valDialog.scale.trim() || null, result: valDialog.result.trim() || null,
      });
      setValDialog(null);
      setValReloadToken((t) => t + 1);
      await load(); // current_verdict / stale の更新を反映
      snack({ type: "success", title: "実績（検証）を追記しました" });
    } catch {
      snack({ type: "error", title: "追記できませんでした", msg: "権限（owner/クエスト管理者）と入力をご確認ください。" });
    } finally {
      setValSaving(false);
    }
  };
  // 前提スレッド（assumption スコープ）への遷移先を解決。
  const threadHrefFor = (assumptionId: string): string | null => {
    const scope = scopes.find((s) => s.kind === "assumption" && s.assumption_id === assumptionId);
    return scope ? `/concepts/${conceptId}/chat/${scope.scope_id}` : null;
  };

  if (loading) return <LoadingOverlay label="読み込み中…" />;
  if (!concept) return <div className="empty-page">コンセプトが見つかりません。</div>;

  const pct = votePercents(vote.approve, vote.oppose);
  // 投票は active（公開）のみ＝draft/archived は事前無効化（サーバー _guard_votable と一致・409 回避）。
  const voteFrozen = concept.status !== "active";
  const voteFrozenTitle = concept.status === "draft"
    ? "下書きのコンセプトには投票できません（公開後に投票可）"
    : concept.status === "archived" ? "保管されたコンセプトには投票できません" : undefined;
  const viabilityText = concept.viability && Object.keys(concept.viability).length ? JSON.stringify(concept.viability, null, 2) : "—";

  return (
    <main className="container detail-main">
      <Link className="backlink backlink--float" href={`/quests/${concept.quest_id}`}
        onClick={(e) => { e.preventDefault(); backToListOr(router, `/quests/${concept.quest_id}`); }}>← クエストへ戻る</Link>

      {/* ============ ヘッダー（.card.idea-head 流用） ============ */}
      <section className="card idea-head" aria-label="コンセプト情報" data-sp-host>
        <div className="idea-head__top">
          <div style={{ minWidth: 0 }}>
            {/* アイデア詳細と見分けがつくよう「🧩 コンセプト」を明示（ISO ②③段の成果物）。 */}
            <div className="concept-eyebrow">🧩 コンセプト</div>
            <div className="idea-head__badges">
              <Badge map={STATUS_LABEL} value={concept.status} />
              <Badge map={DECISION_LABEL} value={concept.decision} />
              {concept.is_selected && <span className="badge badge-success">★ 選定</span>}
              <ConceptGuide />
            </div>
            <div className="idea-head__title">
              <QuestIcon name={concept.title} color="#6366F1" size="sm" />
              <h1>{concept.title}</h1>
            </div>
            {concept.author && (
              <div className="poster">
                <Avatar name={concept.author.display_name} imageUrl={concept.author.avatar_image_url ?? undefined} size="sm" level={concept.author.level ?? undefined} />
                <span className="name">作成: {concept.author.display_name}</span>
              </div>
            )}
          </div>
          <div className="idea-actions">
            {perms.includes("edit") && <Link href={`/concepts/${concept.id}/edit`} className="btn btn-outline">編集</Link>}
          </div>
        </div>
        <div className="idea-meta">
          <span>
            🔄 更新 {fmtDate(concept.updated_at)}・
            <button className="meta-history" type="button" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>
              版 {concept.current_revision}（履歴）
            </button>
          </span>
          <span>🧭 所属クエスト: <Link href={`/quests/${concept.quest_id}`}>クエスト</Link></span>
          {concept.source_ideas.length > 0 && (
            <span>💡 由来: {concept.source_ideas.map((s, i) => (
              <span key={s.idea_id}>{i > 0 ? "・" : ""}<Link href={`/ideas/${s.idea_id}`}>{s.title ?? s.idea_id.slice(0, 8)}</Link></span>
            ))}</span>
          )}
        </div>
      </section>

      {/* ============ 関連情報パネル（全幅・RelatedInfoPanel 流用・FR-41） ============ */}
      <RelatedInfoPanel targetType="concepts" targetId={concept.id} variant="strip" />

      <div className="idea-layout">
        {/* メイン */}
        <div className="idea-main">
          <SchemaGroup title="A. 価値・対象・競合"
            onDiscuss={() => void discussGroup("A. 価値・対象・競合")}
            guide={<ScreenPurpose summary="誰の課題を、どんな価値提案で、誰に、どう差別化して解くか＝コンセプトの「なぜ・何を」の中核。" dialogTitle="価値・対象・競合とは"><p style={{ margin: 0 }}><strong>課題・機会／狙う価値（価値提案）／対象／競合・差別化</strong> をまとめたグループです。コンセプトの「誰の何を、なぜ、どう差別化して解くか」を示す中核部分です。</p></ScreenPurpose>}
          >
            <FieldRow label="課題・機会" value={concept.problem} />
            <FieldRow label="狙う価値（価値提案）" value={concept.value_proposition} />
            <FieldRow label="対象" value={concept.target} />
            <FieldRow label="競合・差別化" value={concept.differentiation} />
          </SchemaGroup>
          <SchemaGroup title="B. 解の形態"
            onDiscuss={() => void discussGroup("B. 解の形態")}
            guide={<ScreenPurpose summary="解の形（製品/サービス/仕組み・粗く可）＋実現に必要な能力。詳細実装は次段（ソリューション）。" dialogTitle="解の形態とは"><p style={{ margin: 0 }}>どんな<strong>形</strong>の解か（製品／サービス／仕組み・粗い粒度で可）と、実現に<strong>必要な能力・リソース</strong>を示します。詳細な実装やWBSは次段（ソリューション開発）の領分です。</p></ScreenPurpose>}
          >
            <FieldRow label="解の形態＋必要な能力" value={concept.solution_form} />
          </SchemaGroup>
          <SchemaGroup title="C. 採算・事業性"
            onDiscuss={() => void discussGroup("C. 採算・事業性")}
            guide={<ScreenPurpose summary="価値実現モデル（value realization model）＝コスト/収益モデル/ROI で how value can be realized を示す（ISO §8.3.3）。" dialogTitle="viability（価値実現モデル）とは"><p style={{ margin: 0 }}>ISO 56001 §8.3.3 の value realization model。<strong>コスト・収益モデル・ROI</strong> 等で「どう価値を実現するか」を示す、経営説得の核です。</p></ScreenPurpose>}
          >
            <div className="field"><div className="dialog-label">採算・事業性（viability）</div><pre className="concept-viability">{viabilityText}</pre></div>
          </SchemaGroup>

          <section className="card concept-assumptions" aria-label="前提と検証">
            <div className="concept-section-head">
              <h2 style={{ margin: 0 }}>前提と検証</h2>
              <ScreenPurpose summary="前提＝コンセプトが成り立つ仮説／検証＝証拠で支持・反証・保留を判定。否定結果こそ価値（ISO 56001 §8.3/§9）。" dialogTitle="前提と検証とは"><p style={{ margin: 0 }}><strong>前提</strong>＝コンセプトが成り立つ仮説。<strong>検証</strong>＝証拠で <strong>支持／反証／保留</strong> を判定します。共有前提が反証に転じると、リンクする全コンセプトが「要再評価」になります。</p></ScreenPurpose>
              {/* 検証プールの前提をこのコンセプトに紐づける（P.4・owner/quest_admin）。 */}
              {canManage && <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => void openLinkDialog()}>＋ 前提をリンク</button>}
            </div>
            {concept.assumptions.length === 0 ? (
              <div className="muted text-sm">まだ前提はありません。{canManage && "「＋ 前提をリンク」で検証プールから紐づけます。"}</div>
            ) : (
              <ul className="assumption-list">
                {concept.assumptions.map((a) => (
                  <AssumptionCard
                    key={a.assumption_id}
                    a={a}
                    threadHref={threadHrefFor(a.assumption_id)}
                    canManage={canManage}
                    reloadToken={valReloadToken}
                    onValidate={() => openValidate(a.assumption_id)}
                    onUnlink={() => void doUnlink(a.assumption_id, a.statement)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* 下部＝総合チャット（総合ルーム・SC-61 §4.8）＝アイデア詳細 SC-22 のチャット節と同型
              （見出し＋活発度グラフ＋直近プレビュー＋「チャットを開く」を下部）。 */}
          <section className="card" aria-label="総合チャット">
            <div className="between" style={{ marginBottom: "var(--space-2)" }}>
              <h2 className="card-title" style={{ margin: 0 }}>💬 総合チャット <span className="badge badge-muted">💬 {chatActivity?.total_messages ?? 0}</span></h2>
            </div>
            <p className="muted text-sm" style={{ margin: "0 0 var(--space-3)" }}>横断議論と最終判断（推進 / 方向転換 / 中止）の場（総合ルーム）。</p>
            {/* 議論アクティビティ・グラフ（総合ルームの chat-activity 実データ）＝共有 ActivitySpark（SC-22 と同型）。 */}
            <ActivitySpark
              daily={(chatActivity?.daily ?? []).map((d) => ({ date: d.date, count: d.message_count }))}
              markers={(chatActivity?.revision_markers ?? []).map((m) => m.date)}
              legend="◆ = コンセプト更新の記録された日。棒＝日次メッセージ数（総合ルーム・直近3日を強調）。"
            />
            {/* 直近メッセージのプレビュー（最新3件・SC-22 と同型）。 */}
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
            {overallScope
              ? <Link href={`/concepts/${conceptId}/chat/${overallScope.scope_id}`} className="btn btn-primary">チャットを開く（総合ルーム）→</Link>
              : <span className="muted text-sm">総合ルーム準備中…</span>}
          </section>
        </div>

        {/* 右レール */}
        <div className="idea-rail">
          {/* 投票（.vote-* パネル流用） */}
          <section className="card" aria-label="投票">
            <div className="concept-section-head">
              <h2 className="card-title" style={{ margin: 0 }}>投票</h2>
              <ScreenPurpose summary="パーティー全員の賛否（民意・機運）。1人1票・変更/取消可・自分にも可。評価スコアには影響しない（投票と評価は独立）。" dialogTitle="投票とは（投票・評価・総合判定の住み分け）">
                <p style={{ margin: 0 }}><strong>投票</strong>＝コンセプト投票権限を持つ<strong>パーティー全員</strong>が賛成/反対で示す<strong>民意（機運）</strong>です。1人1票・変更/取消可・自分のコンセプトにも投票可（投票で +5 XP＝各コンセプト初回）。<strong>評価スコアや総合判定を自動では動かさない参考シグナル</strong>です。</p>
                <p style={{ marginBottom: 0 }}>住み分け＝<strong>投票（全員の民意）</strong> → <strong>評価（評価者の専門採点）</strong> → <strong>総合判定（所有者/管理者の最終意思決定）</strong>。3 つは独立した入力で、総合判定が最終アウトプットです。</p>
              </ScreenPurpose>
            </div>
            <div className="vote-summary">
              <span className="vote-agree">▲ 賛成 {vote.approve}</span>
              <span className="vote-disagree">▼ 反対 {vote.oppose}</span>
            </div>
            <div className="vote-bar" role="img" aria-label={pct.total > 0 ? `賛成 ${pct.approve}% ・ 反対 ${pct.oppose}%` : "まだ投票がありません"}>
              <span className="vote-bar__agree" style={{ width: `${pct.approve}%` }} />
              <span className="vote-bar__disagree" style={{ width: `${pct.oppose}%` }} />
            </div>
            <div className="vote-btns">
              <button className={`vote-btn agree${vote.my === "approve" ? " is-on" : ""}${voteFrozen ? " is-frozen" : ""}`} type="button" aria-pressed={vote.my === "approve"} disabled={busy || voteFrozen} title={voteFrozen ? voteFrozenTitle : undefined} onClick={() => void onVote("approve")}>▲ 賛成</button>
              <button className={`vote-btn disagree${vote.my === "oppose" ? " is-on" : ""}${voteFrozen ? " is-frozen" : ""}`} type="button" aria-pressed={vote.my === "oppose"} disabled={busy || voteFrozen} title={voteFrozen ? voteFrozenTitle : undefined} onClick={() => void onVote("oppose")}>▼ 反対</button>
            </div>
            {concept.status !== "active" && <p className="role-note" style={{ marginTop: "var(--space-2)" }}>※ 下書きのコンセプトには投票できません。公開（投稿）後に投票できます。</p>}
            <p className="vote-note">1人1票・<strong>変更できます</strong>。投票すると <span className="xp">+5 XP</span>（各コンセプト初回）。</p>
          </section>

          {/* 評価結果（選定ボタンは SC-22 と同じくこのパネル見出しに置く） */}
          <section className="card" aria-label="評価結果">
            <div className="eval-head">
              <div className="concept-section-head">
                <h2 className="card-title" style={{ margin: 0 }}>評価結果</h2>
                <ScreenPurpose summary="評価者権限を持つ人による多観点スコア（中核5＋補助3）＝専門的な定量評価。公開範囲を指定可。投票（民意）とは独立。" dialogTitle="評価とは（投票・評価・総合判定の住み分け）">
                  <p style={{ margin: 0 }}><strong>評価</strong>＝<strong>評価者権限</strong>を持つ人が観点別（中核5＋補助3）に採点する<strong>専門的な定量評価</strong>です（採点は SC-62）。評価者ごとに公開範囲（visibility）を指定でき、複数名が評価できます。<strong>投票（全員の民意）とは独立</strong>で、点数は投票結果に影響されません。</p>
                  <p style={{ marginBottom: 0 }}>住み分け＝<strong>投票（全員の民意）</strong> → <strong>評価（評価者の専門採点）</strong> → <strong>総合判定（所有者/管理者の最終意思決定）</strong>。</p>
                </ScreenPurpose>
              </div>
              {canManage && (
                <button className={`btn btn-sm ${concept.is_selected ? "btn-primary" : "btn-outline"}`} type="button" aria-pressed={concept.is_selected} disabled={busy}
                  onClick={() => runManage(() => (concept.is_selected ? unselectConcept(conceptId) : selectConcept(conceptId)), "選定を更新しました")}>
                  {concept.is_selected ? "★ 選定中" : "☆ このコンセプトを選定"}
                </button>
              )}
            </div>
            {(evalAgg?.evaluator_count ?? 0) === 0 ? (
              <p className="role-note" style={{ marginTop: "var(--space-2)" }}>
                まだ提出済みの評価がありません{perms.includes("evaluate") ? "。あなたが最初の評価者になれます。" : "（評価者の評価を待っています）。"}
              </p>
            ) : (
              <>
                <div className="eval-avg">
                  <span className="eval-avg__num">{evalAgg?.overall_avg?.toFixed(1) ?? "–"}</span>
                  <span className="eval-avg__max">/ 5.0（中核5平均・評価者{evalAgg?.evaluator_count}名）</span>
                </div>
                <div className="muted text-sm">推奨: {Object.entries(evalAgg?.recommendations ?? {}).map(([k, v]) => `${DECISION_LABEL[k]?.[0] ?? k}×${v}`).join(" / ") || "—"}</div>
                {ASPECT_LABELS.map(([key, label]) => {
                  const v = evalAgg?.aspects?.[key];
                  return (
                    <div className="score-row" key={key}>
                      <span className="score-row__label">{label}</span>
                      <span className="score-bar"><i style={{ width: `${v ? (v / 5) * 100 : 0}%` }} /></span>
                      <span className="score-row__val">{v ? v.toFixed(1) : "–"}</span>
                    </div>
                  );
                })}
                {(evalAgg?.evaluators ?? []).some((e) => e.overall_comment) && (
                  <>
                    <div className="eval-section-label">総評</div>
                    <div className="eval-overall">
                      {(evalAgg?.evaluators ?? []).filter((e) => e.overall_comment).map((e) => (
                        <div className="eval-overall__item" key={e.evaluator_id}>
                          <div className="eval-comment__head">
                            <Avatar name={e.evaluator?.display_name || "?"} imageUrl={e.evaluator?.avatar_image_url ?? undefined} size="sm" />
                            <span className="chat-msg__name">{e.evaluator?.display_name || "?"}</span>
                            {e.recommendation && <span className="badge badge-muted">{DECISION_LABEL[e.recommendation]?.[0] ?? e.recommendation}</span>}
                          </div>
                          <p className="eval-comment__text">{e.overall_comment}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {perms.includes("evaluate") && <Link href={`/concepts/${concept.id}/eval`} className="btn btn-primary" style={{ marginTop: "var(--space-3)" }}>評価する / 編集</Link>}
          </section>

          {/* 総合判定（右レール最下部・投票 UI に合わせる） */}
          <section className="card" aria-label="総合判定">
            <div className="concept-section-head">
              <h2 className="card-title" style={{ margin: 0 }}>総合判定</h2>
              <ScreenPurpose summary="所有者/クエスト管理者が下す最終意思決定（推進 / 方向転換 / 中止）。投票・評価・前提と検証を踏まえて人が判断。" dialogTitle="総合判定とは（投票・評価・総合判定の住み分け）">
                <p style={{ margin: 0 }}><strong>総合判定</strong>＝<strong>所有者 / クエスト管理者のみ</strong>が下す<strong>最終的な意思決定</strong>です（<strong>推進 / 方向転換 / 中止</strong>）。投票（全員の民意）・評価（評価者の専門採点）・前提と検証（エビデンス）を踏まえて<strong>人が判断</strong>します（自動計算ではありません）。★選定とあわせて勝ち残りを決めます。</p>
                <p style={{ marginBottom: 0 }}>住み分け＝<strong>投票（全員の民意）</strong> → <strong>評価（評価者の専門採点）</strong> → <strong>総合判定（所有者/管理者の最終意思決定）</strong>。</p>
              </ScreenPurpose>
            </div>
            <div className="vote-summary">
              <span className="decision-now">現在の判定: <Badge map={DECISION_LABEL} value={concept.decision} /></span>
            </div>
            {concept.decision_rationale && <p className="text-sm">{concept.decision_rationale}</p>}
            {canManage ? (
              <>
                {/* 総合判定＝評価ダイアログ「総合判定の推奨」と同じ .segmented（3択の単一選択）に統一。 */}
                <div className="segmented" role="radiogroup" aria-label="総合判定">
                  {DECISION_CHOICES.map(([d, label]) => (
                    <label key={d}>
                      <input type="radio" name="concept-decision" checked={concept.decision === d} disabled={busy}
                        onChange={() => runManage(() => setDecision(conceptId, { decision: d as "go" | "pivot" | "kill" }), "判定を更新しました")} />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="vote-note">所有者 / クエスト管理者が <strong>推進 / 方向転換 / 中止</strong> を判定します。</p>
              </>
            ) : (
              <p className="vote-note">総合判定は 所有者 / クエスト管理者が行います。</p>
            )}
            {/* 判定・ステータスの履歴は概要の「更新履歴」リンク→モーダルへ集約（クエスト同型・§3.2）。 */}
          </section>
        </div>
      </div>

      {/* 更新履歴モーダル（定義の版＋差分＋判定/ステータスログ・§3.1/§3.2・クエスト SC-12 と同型） */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="更新履歴" size="lg">
        <ModalBody>
          {/* 参照系ダイアログ＝項目間に仕切り線（.dialog-section・デザイン標準 §4.1）。 */}
          <div className="dialog-section">
            <h3 style={{ marginTop: 0 }}>内容の変更履歴</h3>
            <p className="role-note" style={{ marginTop: 0 }}>
              コンセプトの変更を新しい順に表示します。各版を開くと差分（
              <span className="diff-add">追加</span>／<span className="diff-del">削除</span>）が見られます。
            </p>
            <ConceptRevisionHistory conceptId={conceptId} currentRevision={concept.current_revision} />
          </div>
          <div className="dialog-section">
            <h3 style={{ marginTop: 0 }}>判定・ステータスの履歴</h3>
            <ConceptDecisionLogView conceptId={conceptId} />
          </div>
        </ModalBody>
        <ModalFooter>
          <button className="btn btn-outline" type="button" onClick={() => setHistoryOpen(false)}>閉じる</button>
        </ModalFooter>
      </Modal>

      {/* 前提リンクの選択ダイアログ（P.4）＝検証プールの未リンク前提を選び criticality を付けて紐づける。 */}
      {linkOpen && (
        <Modal open onClose={() => setLinkOpen(false)} title="前提をリンク" size="md">
          <ModalBody>
            <p className="role-note" style={{ marginTop: 0 }}>検証プールの前提をこのコンセプトに紐づけます（前提はクエスト単位で共有・複数コンセプトで再利用）。</p>
            {(() => {
              const linkedIds = new Set(concept.assumptions.map((a) => a.assumption_id));
              const candidates = (pool ?? []).filter((a) => !linkedIds.has(a.id));
              if (pool === null) return <p className="muted">読み込み中…</p>;
              if (candidates.length === 0) return <p className="muted text-sm">リンクできる前提がありません（検証プールが空、または全て紐づけ済み）。検証プールから前提を追加してください。</p>;
              return (
                <>
                  <div className="field dialog-section is-quiet">
                    <label htmlFor="link_assumption">前提を選択</label>
                    <select id="link_assumption" className="select" value={linkSel} onChange={(e) => setLinkSel(e.target.value)}>
                      <option value="">— 選択してください —</option>
                      {candidates.map((a) => <option key={a.id} value={a.id}>{a.statement}</option>)}
                    </select>
                  </div>
                  <div className="field dialog-section is-quiet">
                    <label htmlFor="link_criticality">重要度</label>
                    <select id="link_criticality" className="select" value={linkCrit} onChange={(e) => setLinkCrit(e.target.value as "critical" | "major" | "minor")}>
                      <option value="critical">致命的</option>
                      <option value="major">重要</option>
                      <option value="minor">補助</option>
                    </select>
                  </div>
                </>
              );
            })()}
          </ModalBody>
          <ModalFooter>
            <button type="button" className="btn btn-outline dialog-close-left" onClick={() => setLinkOpen(false)}>キャンセル</button>
            <button type="button" className="btn btn-primary" disabled={!linkSel || busy} onClick={() => void doLink()}>リンク</button>
          </ModalFooter>
        </Modal>
      )}

      {/* 実績（検証）の追記ダイアログ（P.3・§4.4）＝手法/判定/実施日/規模/結果。実施日・規模は必須（エビデンスは古びる/検証の強さ）。 */}
      {valDialog && (
        <Modal open onClose={() => setValDialog(null)} title="実績（検証）を入力" size="md">
          <ModalBody>
            <p className="role-note" style={{ marginTop: 0 }}>この前提の検証結果を追記します（判定が反証に転じるとリンク先の全コンセプトが「要再評価」になります）。</p>
            <div className="field dialog-section is-quiet">
              <label htmlFor="val_method">検証方法 <span className="req">*</span></label>
              <input id="val_method" className="input" value={valDialog.method} onChange={(e) => setValDialog((d) => (d ? { ...d, method: e.target.value } : d))} placeholder="例: 想定顧客20名にインタビュー" />
            </div>
            <div className="field dialog-section is-quiet">
              <label htmlFor="val_verdict">判定 <span className="req">*</span></label>
              <select id="val_verdict" className="select" value={valDialog.verdict} onChange={(e) => setValDialog((d) => (d ? { ...d, verdict: e.target.value as "supported" | "refuted" | "inconclusive" } : d))}>
                <option value="supported">支持</option>
                <option value="refuted">反証</option>
                <option value="inconclusive">保留</option>
              </select>
            </div>
            <div className="field dialog-section is-quiet">
              <label htmlFor="val_date">検証実施日 <span className="req">*</span></label>
              <input id="val_date" type="date" className="input" value={valDialog.validatedOn} onChange={(e) => setValDialog((d) => (d ? { ...d, validatedOn: e.target.value } : d))} />
            </div>
            <div className="field dialog-section is-quiet">
              <label htmlFor="val_scale">規模（サンプル数/対象） <span className="req">*</span></label>
              <input id="val_scale" className="input" value={valDialog.scale} onChange={(e) => setValDialog((d) => (d ? { ...d, scale: e.target.value } : d))} placeholder="例: n=20 / 主要顧客3社" />
            </div>
            <div className="field dialog-section is-quiet">
              <label htmlFor="val_result">結果（任意）</label>
              <textarea id="val_result" className="textarea" rows={3} value={valDialog.result} onChange={(e) => setValDialog((d) => (d ? { ...d, result: e.target.value } : d))} placeholder="検証で分かったこと" />
            </div>
          </ModalBody>
          <ModalFooter>
            <button type="button" className="btn btn-outline dialog-close-left" onClick={() => setValDialog(null)}>キャンセル</button>
            <button type="button" className="btn btn-primary" disabled={valSaving} onClick={() => void saveValidation()}>追記</button>
          </ModalFooter>
        </Modal>
      )}
    </main>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="field">
      <div className="dialog-label">{label}</div>
      <p className="concept-field-value">{value?.trim() ? value : "—"}</p>
    </div>
  );
}

function SchemaGroup({ title, guide, onDiscuss, children }: { title: string; guide?: React.ReactNode; onDiscuss?: () => void; children: React.ReactNode }) {
  // グループ末尾＝仕切り線＋💬「このグループを議論 →」（対応するグループ・ルームへ・SC-61 §4.3）。
  return (
    <section className="card schema-group">
      <div className="concept-section-head"><h2 style={{ margin: 0 }}>{title}</h2>{guide}</div>
      {children}
      {onDiscuss && (
        <div className="schema-group__discuss">
          <button type="button" className="btn btn-outline btn-sm" onClick={onDiscuss}>💬 このグループを議論 →</button>
        </div>
      )}
    </section>
  );
}
