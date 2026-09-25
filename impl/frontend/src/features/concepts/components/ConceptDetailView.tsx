"use client";

// SC-61 コンセプト詳細（フルページ・FR-42・P.1 GET /concepts/{id} 実接続）。
// レイアウト＝ヘッダー（パンくず/名前/status/Go-Pivot-Kill/★選定/由来アイデア/ガイダンスⓘ）→関連情報パネル（全幅）
// →メイン（スキーマ A/B/C グループ＋各末尾💬グループ議論／⑥前提と検証=核心）＋右レール（投票→評価結果→総合判定[最下部]）
// →下部＝総合チャット。正＝doc/画面設計/screens/SC-61_コンセプト詳細.md。ガイダンス＝デザイン標準§4.13（.screen-purpose）。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { LoadingOverlay, ScreenPurpose, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import {
  activateConcept,
  archiveConcept,
  getConcept,
  selectConcept,
  setDecision,
  unselectConcept,
  unvoteConcept,
  voteConcept,
  type ConceptDetail,
  type ConceptVoteType,
} from "../api";
import "../concepts.css";

const STATUS_LABEL: Record<string, [string, string]> = {
  draft: ["下書き", "badge badge-muted"],
  active: ["検証中", "badge badge-success"],
  archived: ["保管", "badge badge-muted"],
};
const DECISION_LABEL: Record<string, [string, string]> = {
  undecided: ["未判定", "badge badge-muted"],
  go: ["Go", "badge badge-success"],
  pivot: ["Pivot", "badge badge-muted"],
  kill: ["Kill", "badge badge-danger"],
};
const VERDICT_LABEL: Record<string, [string, string]> = {
  inconclusive: ["保留", "badge badge-muted"],
  supported: ["支持", "badge badge-success"],
  refuted: ["反証", "badge badge-danger"],
};
const CRITICALITY_LABEL: Record<string, string> = { critical: "致命的", major: "重要", minor: "補助" };

function Badge({ map, value }: { map: Record<string, [string, string]>; value: string }) {
  const [label, cls] = map[value] ?? [value, "badge badge-muted"];
  return <span className={cls}>{label}</span>;
}

// ガイダンス（全文ダイアログ・§4.13）＝ISO 56002 準拠の定義・目的・粒度。SC-60/62 と共通文面。
function ConceptGuide() {
  return (
    <ScreenPurpose
      label="コンセプトとは？"
      summary="選別済みアイデアを統合し、主要な前提を「証拠で」検証（desirability・feasibility・viability）しながら Go / Pivot / Kill の判断まで導く検証可能な提案（ISO 56002 §8.3 ②③段）。粒度＝1クエスト内で競合する検証単位。"
      dialogTitle="この画面について（ISO 56002 準拠）"
    >
      <div className="dialog-section">
        <div className="dialog-label">コンセプトとは</div>
        <p style={{ margin: 0 }}>選別済みのアイデア（複数）を統合し、<strong>課題・機会／狙う価値（価値提案）と対象／競合・差別化／解の形態と必要な能力／採算・事業性（viability）／前提と検証</strong>をひとまとめにした、<strong>検証可能な提案</strong>です（ISO 56002 §8.3 概念の創造・検証＝②③段）。</p>
      </div>
      <div className="dialog-section">
        <div className="dialog-label">この画面の狙い</div>
        <p style={{ margin: 0 }}>スキーマを埋め、主要な前提を<strong>「証拠で」検証</strong>（desirability・feasibility・viability）しながら、<strong>Go / Pivot / Kill</strong> の判断まで導きます。<strong>否定的な検証結果こそ価値</strong>（筋の悪い方向を早く止める）。</p>
      </div>
      <div className="dialog-section">
        <div className="dialog-label">粒度</div>
        <p style={{ margin: 0 }}><strong>1 クエスト（＝1 イニシアチブ）</strong>の中に複数の候補が競合し、評価と検証を経て owner が勝ち残りを選定します。<strong>アイデアより大きく、ソリューション（実装・WBS）より前</strong>の単位です。</p>
      </div>
    </ScreenPurpose>
  );
}

export function ConceptDetailView({ conceptId }: { conceptId: string }) {
  const snack = useSnackbar();
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [vote, setVote] = useState<{ approve: number; oppose: number; mine: string | null }>({ approve: 0, oppose: 0, mine: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const c = await getConcept(conceptId);
    setConcept(c);
    setLoading(false);
  }, [conceptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const perms = concept?.my_permissions ?? [];
  const canManage = perms.includes("manage");

  const onVote = async (type: ConceptVoteType) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = vote.mine === type ? await unvoteConcept(conceptId) : await voteConcept(conceptId, type);
      if (next) setVote({ approve: next.summary?.approve ?? 0, oppose: next.summary?.oppose ?? 0, mine: next.my_vote ?? null });
      if (next && (next.xp_delta ?? 0) > 0) snack({ type: "success", title: `+${next.xp_delta} XP` });
    } catch (e) {
      snack({ type: "error", msg: e instanceof ApiError ? "投票できませんでした" : "通信に失敗しました" });
    } finally {
      setBusy(false);
    }
  };

  const runManage = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      snack({ type: "success", title: ok });
    } catch {
      snack({ type: "error", msg: "操作できませんでした" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingOverlay label="読み込み中…" />;
  if (!concept) return <div className="empty-page">コンセプトが見つかりません。</div>;

  const viabilityText = concept.viability && Object.keys(concept.viability).length
    ? JSON.stringify(concept.viability, null, 2)
    : "—";

  return (
    <div className="concept-detail" data-sp-host>
      {/* ヘッダー */}
      <header className="concept-header card">
        <div className="concept-breadcrumb">
          <Link href={`/quests/${concept.quest_id}`}>🧭 クエストへ戻る</Link> › コンセプト
        </div>
        <div className="concept-title-row">
          <h1 className="concept-title">{concept.title}</h1>
          <Badge map={STATUS_LABEL} value={concept.status} />
          <Badge map={DECISION_LABEL} value={concept.decision} />
          {concept.is_selected && <span className="badge badge-success">★ 選定</span>}
          <ConceptGuide />
        </div>
        {concept.source_ideas.length > 0 && (
          <div className="concept-sources">
            <span className="muted text-sm">由来:</span>
            {concept.source_ideas.map((s) => (
              <Link key={s.idea_id} href={`/ideas/${s.idea_id}`} className="chip">💡 {s.title ?? s.idea_id.slice(0, 8)}</Link>
            ))}
          </div>
        )}
        {(perms.includes("edit") || canManage) && (
          <div className="concept-actions">
            {perms.includes("edit") && <Link href={`/concepts/${concept.id}/edit`} className="btn btn-outline">編集</Link>}
            {canManage && concept.status === "draft" && (
              <button className="btn btn-primary" disabled={busy} onClick={() => runManage(() => activateConcept(conceptId), "活性化しました")}>活性化</button>
            )}
            {canManage && concept.status === "active" && (
              <button className="btn btn-outline" disabled={busy} onClick={() => runManage(() => archiveConcept(conceptId), "保管しました")}>保管</button>
            )}
            {canManage && (
              <button className="btn btn-outline" disabled={busy} onClick={() => runManage(() => (concept.is_selected ? unselectConcept(conceptId) : selectConcept(conceptId)), "選定を更新しました")}>
                {concept.is_selected ? "★選定を解除" : "★選定する"}
              </button>
            )}
          </div>
        )}
      </header>

      {/* 関連情報パネル（全幅・独立）＝backend の related_info 合成は follow-up（現状プレースホルダ） */}
      <section className="concept-relinfo card">
        🔗 関連情報 <span className="muted text-sm">（情報インプット連携・結線は後続スライス）</span>
      </section>

      <div className="concept-layout">
        {/* メイン */}
        <main className="concept-main">
          <SchemaGroup title="A. 価値・対象・競合">
            <Field label="課題・機会" value={concept.problem} />
            <Field label="狙う価値（価値提案）" value={concept.value_proposition} />
            <Field label="対象" value={concept.target} />
            <Field label="競合・差別化" value={concept.differentiation} />
          </SchemaGroup>

          <SchemaGroup title="B. 解の形態">
            <Field label="解の形態＋必要な能力" value={concept.solution_form} />
          </SchemaGroup>

          <SchemaGroup title="C. 採算・事業性"
            guide={<ScreenPurpose label="viability とは？" summary="価値実現モデル（value realization model）＝コスト/収益モデル/ROI で how value can be realized を示す（ISO §8.3.3 e）。経営が投資判断できる証拠まで。" dialogTitle="viability（価値実現モデル）とは"><p style={{ margin: 0 }}>ISO 56002 §8.3.3 e) の value realization model。<strong>コスト・収益モデル・ROI</strong> 等で「どう価値を実現するか（business/operational/marketing model）」を示す、経営説得の核です。</p></ScreenPurpose>}
          >
            <div className="field">
              <div className="dialog-label">採算・事業性（viability）</div>
              <pre className="concept-viability">{viabilityText}</pre>
            </div>
          </SchemaGroup>

          {/* ⑥ 前提と検証（核心） */}
          <section className="concept-assumptions">
            <div className="concept-section-head">
              <h2>前提と検証</h2>
              <ScreenPurpose label="前提と検証とは？" summary="前提＝コンセプトが成り立つ仮説／検証＝証拠で支持・反証・保留を判定。否定結果こそ価値（筋の悪い方向を早く止める・ISO 56002 §8.3/§9）。" dialogTitle="前提と検証とは">
                <p style={{ margin: 0 }}><strong>前提</strong>＝このコンセプトが成り立つための仮説。<strong>検証</strong>＝実験/ヒアリング等の証拠で <strong>支持／反証／保留</strong> を判定します。<strong>否定的な結果こそ価値</strong>（筋の悪い方向を早く止める）。共有前提が反証に転じると、リンクする全コンセプトが「要再評価」になります。</p>
              </ScreenPurpose>
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
        </main>

        {/* 右レール */}
        <aside className="concept-rail">
          <section className="rail-card">
            <h3>投票</h3>
            <div className="vote-row">
              <button className={`btn ${vote.mine === "approve" ? "btn-primary" : "btn-outline"}`} disabled={busy} aria-pressed={vote.mine === "approve"} onClick={() => onVote("approve")}>👍 賛成 {vote.approve}</button>
              <button className={`btn ${vote.mine === "oppose" ? "btn-primary" : "btn-outline"}`} disabled={busy} aria-pressed={vote.mine === "oppose"} onClick={() => onVote("oppose")}>👎 反対 {vote.oppose}</button>
            </div>
            <p className="hint">投票で +5 XP（各コンセプト初回）。</p>
          </section>

          <section className="rail-card">
            <h3>評価結果</h3>
            {concept.evaluation.evaluator_count > 0 ? (
              <>
                <div className="eval-overall">総合 {concept.evaluation.overall_avg?.toFixed(1) ?? "—"} / 5.0（{concept.evaluation.evaluator_count}名）</div>
                <div className="muted text-sm">推奨: {Object.entries(concept.evaluation.recommendations).map(([k, v]) => `${DECISION_LABEL[k]?.[0] ?? k}×${v}`).join(" / ") || "—"}</div>
              </>
            ) : (
              <div className="muted text-sm">評価待ち</div>
            )}
            {perms.includes("evaluate") && <Link href={`/concepts/${concept.id}/eval`} className="btn btn-outline">評価する</Link>}
          </section>

          {/* 総合判定（右レール最下部） */}
          <section className="rail-card rail-decision">
            <h3>総合判定</h3>
            <div className="decision-current"><Badge map={DECISION_LABEL} value={concept.decision} /></div>
            {concept.decision_rationale && <p className="text-sm">{concept.decision_rationale}</p>}
            {canManage && (
              <div className="decision-actions">
                {(["go", "pivot", "kill"] as const).map((d) => (
                  <button key={d} className="btn btn-outline" disabled={busy} onClick={() => runManage(() => setDecision(conceptId, { decision: d }), "判定を更新しました")}>{DECISION_LABEL[d][0]}</button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* 下部＝総合チャット（結線は後続スライス） */}
      <section className="concept-chat card">
        💬 議論ルーム <span className="muted text-sm">（総合／グループ／前提スレッド・結線は後続スライス）</span>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="field">
      <div className="dialog-label">{label}</div>
      <p className="concept-field-value">{value?.trim() ? value : "—"}</p>
    </div>
  );
}

function SchemaGroup({ title, guide, children }: { title: string; guide?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="schema-group">
      <div className="concept-section-head">
        <h2>{title}</h2>
        {guide}
      </div>
      {children}
      <div className="schema-group-foot">
        <button className="btn btn-outline btn-sm" type="button" title="議論ルームへ（後続スライスで結線）">💬 このグループを議論 →</button>
      </div>
    </section>
  );
}
