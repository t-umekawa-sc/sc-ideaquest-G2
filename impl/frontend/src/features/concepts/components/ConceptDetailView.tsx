"use client";

// SC-61 コンセプト詳細（フルページ・FR-42・P.1）。SC-22 アイデア詳細と同型＝共有クラス/部品を再利用する
// （戻るリンク backlink--float・ヘッダー .card.idea-head・関連情報 RelatedInfoPanel・投票 .vote-* パネル・2カラム .idea-layout）。
// コンセプト固有（スキーマA/B/Cグループ・前提と検証・総合判定・ガイダンスⓘ）だけ concepts.css で足す。DRY（フロー規約 §2/§2.1）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Avatar, LoadingOverlay, ScreenPurpose, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout/QuestIcon";
import { RelatedInfoPanel } from "@/features/info-input";
import { votePercents } from "@/features/ideas/voting";
import { ApiError } from "@/lib/api/client";
import { backToListOr } from "@/lib/nav";

import {
  CONCEPTS_CHANGED_EVENT, getConcept, getEvaluationAggregate,
  selectConcept, setDecision, unselectConcept, unvoteConcept, voteConcept,
  type ConceptDetail, type ConceptVoteType, type EvaluationAggregate,
} from "../api";
import "@/features/ideas/ideas.css"; // 共有ヘッダー/投票/レイアウトのクラス（.idea-head/.idea-rail/.vote-* 等）
import "../concepts.css";

const STATUS_LABEL: Record<string, [string, string]> = {
  draft: ["下書き", "badge badge-muted"], active: ["検証中", "badge badge-success"], archived: ["保管", "badge badge-muted"],
};
const DECISION_LABEL: Record<string, [string, string]> = {
  undecided: ["未判定", "badge badge-muted"], go: ["推進", "badge badge-success"], pivot: ["方向転換", "badge badge-muted"], kill: ["中止", "badge badge-danger"],
};
const DECISION_CHOICES: readonly [string, string][] = [["go", "推進"], ["pivot", "方向転換"], ["kill", "中止"]];
const VERDICT_LABEL: Record<string, [string, string]> = {
  inconclusive: ["保留", "badge badge-muted"], supported: ["支持", "badge badge-success"], refuted: ["反証", "badge badge-danger"],
};
const CRITICALITY_LABEL: Record<string, string> = { critical: "致命的", major: "重要", minor: "補助" };
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
      summary="選別済みアイデアを統合し、主要な前提を「証拠で」検証（desirability・feasibility・viability）しながら Go / Pivot / Kill の判断まで導く検証可能な提案（ISO 56002 §8.3 ②③段）。粒度＝1クエスト内で競合する検証単位。"
      dialogTitle="この画面について（ISO 56002 準拠）"
    >
      <div className="dialog-section"><div className="dialog-label">コンセプトとは</div><p style={{ margin: 0 }}>選別済みのアイデア（複数）を統合し、<strong>課題・機会／狙う価値と対象／競合・差別化／解の形態と必要な能力／採算・事業性（viability）／前提と検証</strong>をひとまとめにした、<strong>検証可能な提案</strong>です（ISO 56002 §8.3 ②③段）。</p></div>
      <div className="dialog-section"><div className="dialog-label">この画面の狙い</div><p style={{ margin: 0 }}>主要な前提を「証拠で」検証しながら <strong>Go / Pivot / Kill</strong> の判断まで導きます。否定的な検証結果こそ価値。</p></div>
      <div className="dialog-section"><div className="dialog-label">粒度</div><p style={{ margin: 0 }}><strong>1 クエスト内</strong>で複数候補が競合し、owner が勝ち残りを選定。アイデアより大きく、ソリューション（実装）より前の単位です。</p></div>
    </ScreenPurpose>
  );
}

export function ConceptDetailView({ conceptId }: { conceptId: string }) {
  const router = useRouter();
  const snack = useSnackbar();
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [vote, setVote] = useState<{ approve: number; oppose: number; my: ConceptVoteType | null }>({ approve: 0, oppose: 0, my: null });
  const [evalAgg, setEvalAgg] = useState<EvaluationAggregate | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    loadEval();
    const onChanged = () => { void load(); loadEval(); };
    window.addEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONCEPTS_CHANGED_EVENT, onChanged);
  }, [loadEval, load]);

  const perms = concept?.my_permissions ?? [];
  const canManage = perms.includes("manage");

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

  if (loading) return <LoadingOverlay label="読み込み中…" />;
  if (!concept) return <div className="empty-page">コンセプトが見つかりません。</div>;

  const pct = votePercents(vote.approve, vote.oppose);
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
          <span>🔄 更新 {fmtDate(concept.updated_at)}</span>
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
          <SchemaGroup title="A. 価値・対象・競合">
            <FieldRow label="課題・機会" value={concept.problem} />
            <FieldRow label="狙う価値（価値提案）" value={concept.value_proposition} />
            <FieldRow label="対象" value={concept.target} />
            <FieldRow label="競合・差別化" value={concept.differentiation} />
          </SchemaGroup>
          <SchemaGroup title="B. 解の形態">
            <FieldRow label="解の形態＋必要な能力" value={concept.solution_form} />
          </SchemaGroup>
          <SchemaGroup title="C. 採算・事業性"
            guide={<ScreenPurpose label="viability とは？" summary="価値実現モデル（value realization model）＝コスト/収益モデル/ROI で how value can be realized を示す（ISO §8.3.3 e）。" dialogTitle="viability（価値実現モデル）とは"><p style={{ margin: 0 }}>ISO 56002 §8.3.3 e) の value realization model。<strong>コスト・収益モデル・ROI</strong> 等で「どう価値を実現するか」を示す、経営説得の核です。</p></ScreenPurpose>}
          >
            <div className="field"><div className="dialog-label">採算・事業性（viability）</div><pre className="concept-viability">{viabilityText}</pre></div>
          </SchemaGroup>

          <section className="card concept-assumptions" aria-label="前提と検証">
            <div className="concept-section-head">
              <h2 style={{ margin: 0 }}>前提と検証</h2>
              <ScreenPurpose label="前提と検証とは？" summary="前提＝コンセプトが成り立つ仮説／検証＝証拠で支持・反証・保留を判定。否定結果こそ価値（ISO 56002 §8.3/§9）。" dialogTitle="前提と検証とは"><p style={{ margin: 0 }}><strong>前提</strong>＝コンセプトが成り立つ仮説。<strong>検証</strong>＝証拠で <strong>支持／反証／保留</strong> を判定します。共有前提が反証に転じると、リンクする全コンセプトが「要再評価」になります。</p></ScreenPurpose>
            </div>
            {concept.assumptions.length === 0 ? (
              <div className="muted text-sm">まだ前提はありません。</div>
            ) : (
              <ul className="assumption-list">
                {concept.assumptions.map((a) => (
                  <li key={a.assumption_id} className="assumption-card">
                    <div className="assumption-top">
                      <span className="badge badge-muted">{CRITICALITY_LABEL[a.criticality] ?? a.criticality}</span>
                      <Badge map={VERDICT_LABEL} value={a.current_verdict} />
                      {a.is_stale && <span className="badge badge-danger">⚠ 要再評価</span>}
                    </div>
                    <div className="assumption-statement">{a.statement}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* 右レール */}
        <div className="idea-rail">
          {/* 投票（.vote-* パネル流用） */}
          <section className="card" aria-label="投票">
            <h2 className="card-title">投票</h2>
            <div className="vote-summary">
              <span className="vote-agree">▲ 賛成 {vote.approve}</span>
              <span className="vote-disagree">▼ 反対 {vote.oppose}</span>
            </div>
            <div className="vote-bar" role="img" aria-label={pct.total > 0 ? `賛成 ${pct.approve}% ・ 反対 ${pct.oppose}%` : "まだ投票がありません"}>
              <span className="vote-bar__agree" style={{ width: `${pct.approve}%` }} />
              <span className="vote-bar__disagree" style={{ width: `${pct.oppose}%` }} />
            </div>
            <div className="vote-btns">
              <button className={`vote-btn agree${vote.my === "approve" ? " is-on" : ""}`} type="button" aria-pressed={vote.my === "approve"} disabled={busy} onClick={() => void onVote("approve")}>▲ 賛成</button>
              <button className={`vote-btn disagree${vote.my === "oppose" ? " is-on" : ""}`} type="button" aria-pressed={vote.my === "oppose"} disabled={busy} onClick={() => void onVote("oppose")}>▼ 反対</button>
            </div>
            <p className="vote-note">1人1票・<strong>変更できます</strong>。投票すると <span className="xp">+5 XP</span>（各コンセプト初回）。</p>
          </section>

          {/* 評価結果（選定ボタンは SC-22 と同じくこのパネル見出しに置く） */}
          <section className="card" aria-label="評価結果">
            <div className="eval-head">
              <h2 className="card-title" style={{ margin: 0 }}>評価結果</h2>
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
            {perms.includes("evaluate") && <Link href={`/concepts/${concept.id}/eval`} className="btn btn-outline">評価する / 編集</Link>}
          </section>

          {/* 総合判定（右レール最下部・投票 UI に合わせる） */}
          <section className="card" aria-label="総合判定">
            <h2 className="card-title">総合判定</h2>
            <div className="vote-summary">
              <span className="decision-now">現在の判定: <Badge map={DECISION_LABEL} value={concept.decision} /></span>
            </div>
            {concept.decision_rationale && <p className="text-sm">{concept.decision_rationale}</p>}
            {canManage ? (
              <>
                <div className="vote-btns">
                  {DECISION_CHOICES.map(([d, label]) => (
                    <button key={d} type="button" className={`vote-btn decision-${d}${concept.decision === d ? " is-on" : ""}`}
                      aria-pressed={concept.decision === d} disabled={busy}
                      onClick={() => runManage(() => setDecision(conceptId, { decision: d as "go" | "pivot" | "kill" }), "判定を更新しました")}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="vote-note">owner / クエスト管理者が <strong>推進 / 方向転換 / 中止</strong> を判定します。</p>
              </>
            ) : (
              <p className="vote-note">総合判定は owner / クエスト管理者が行います。</p>
            )}
          </section>
        </div>
      </div>
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

function SchemaGroup({ title, guide, children }: { title: string; guide?: React.ReactNode; children: React.ReactNode }) {
  // 「このグループを議論」導線は議論チャット結線スライスで追加（今は無反応ボタンを出さない）。
  return (
    <section className="card schema-group">
      <div className="concept-section-head"><h2 style={{ margin: 0 }}>{title}</h2>{guide}</div>
      {children}
    </section>
  );
}
