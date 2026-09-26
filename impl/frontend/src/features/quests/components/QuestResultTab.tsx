"use client";

// SC-12「🏁 結果」タブ＝クエスト最終結果＝アイデア選別の申し送り（FR-39・ISO 56001・完了時のみ）。
// 既存3成果物（アイデア＋チャット＋評価）を1枚に凝縮＝①選定アイデア/②評価・選別サマリ/③意思決定/
// ⑤振り返り・学び（owner/管理が編集）/⑥次アクション（後続クエスト複製導線）。④議論の要点(a)＝各案のチャットリンク。
// 正＝doc/設計ドラフト/FR-39_クエスト最終結果_ISO56001.md・C（FR-39）。
import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar, Button, Field, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
import { RevisionTimeline, type RevisionDiff, type RevisionRow } from "@/components/ui/RevisionTimeline";
import { QuestIcon } from "@/components/layout";
import { buildDuplicateHref } from "@/lib/forms/duplicate";
import { generateChatSummary, getQuestOutcomeRevisionDiff, getQuestResult, updateQuestResult, type QuestDetail, type QuestResult } from "../api";

// 振り返り（総括）の版で追跡するフィールドの表示名（§3.1）。
const OUTCOME_FIELD_LABELS: Record<string, string> = {
  summary: "成果（総括）",
  learnings: "学び・課題",
  next_actions: "次アクション",
  metrics: "成果の指標（KPI）",
};

const ASPECT_LABELS: [keyof QuestResult["aspect_averages"], string][] = [
  ["novelty", "新規性"],
  ["impact", "影響度"],
  ["feasibility", "実現度"],
  ["fit", "適合性"],
  ["cost", "コスト"],
];

type Metric = { label: string; value: string };

export function QuestResultTab({ questId, quest }: { questId: string; quest: QuestDetail }) {
  const snack = useSnackbar();
  const [result, setResult] = useState<QuestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [learnings, setLearnings] = useState("");
  const [nextActions, setNextActions] = useState("");
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    let alive = true;
    void getQuestResult(questId)
      .then((r) => {
        if (!alive || !r) return;
        setResult(r);
        setSummary(r.outcome.summary ?? "");
        setLearnings(r.outcome.learnings ?? "");
        setNextActions(r.outcome.next_actions ?? "");
        setMetrics((r.outcome.metrics ?? []).map((m) => ({ label: m.label, value: m.value })));
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [questId]);

  async function save() {
    setSaving(true);
    const cleanMetrics = metrics.filter((m) => m.label.trim() || m.value.trim());
    const res = await updateQuestResult(questId, {
      summary: summary.trim() || null,
      learnings: learnings.trim() || null,
      next_actions: nextActions.trim() || null,
      metrics: cleanMetrics,
    }).catch(() => null);
    setSaving(false);
    if (!res) { snack({ type: "error", msg: "保存に失敗しました。" }); return; }
    // 更新履歴（outcome_revisions）は upsert 応答に含まれないため、全体を再取得して版を即反映（リロード不要）。
    const fresh = await getQuestResult(questId).catch(() => null);
    setResult((r) => (fresh ? fresh : r ? { ...r, outcome: { ...r.outcome, ...res } } : r));
    setMetrics(cleanMetrics);  // 空行を落とした保存後の集合へ読み取りビューを同期
    setEditing(false);
    snack({ type: "success", title: "最終結果を保存しました" });
  }

  // 編集ダイアログのキャンセル＝未保存の編集を破棄して直近の保存値へ戻す（モーダル化に伴い明示リセット）。
  function cancelEdit() {
    if (result) {
      setSummary(result.outcome.summary ?? "");
      setLearnings(result.outcome.learnings ?? "");
      setNextActions(result.outcome.next_actions ?? "");
      setMetrics((result.outcome.metrics ?? []).map((m) => ({ label: m.label, value: m.value })));
    }
    setEditing(false);
  }

  // (c) チャットの自動要約（抽出型・オフライン・無料）を生成/再生成。owner/quest_admin のみ。
  async function runSummary() {
    setSummarizing(true);
    const res = await generateChatSummary(questId).catch(() => null);
    setSummarizing(false);
    if (!res) { snack({ type: "error", msg: "要約に失敗しました。" }); return; }
    setResult((r) => (r ? { ...r, outcome: { ...r.outcome, chat_summary: res.chat_summary, chat_summary_at: res.chat_summary_at } } : r));
    snack({ type: "success", title: "自動要約を更新しました" });
  }

  // 後続クエスト複製（⑥次アクション＝次サイクルへ）＝件名/カラー/カテゴリ/参加グループ/期限/目的＋パーティーを引き継ぐ。
  const dupHref = buildDuplicateHref("/quests/new", {
    title: `${quest.title}（続き）`,
    color: quest.color,
    categories: quest.categories ?? [],
    quest_group_ids: (quest.quest_groups ?? []).map((g) => g.id),
    members: (quest.members ?? []).filter((m) => !m.is_creator).map((m) => ({
      user_id: m.user.user_id, display_name: m.user.display_name, permissions: m.permissions, group_ids: m.group_ids ?? [],
    })),
    deadline: quest.deadline ?? "",
    purpose: quest.purpose ?? "",
  });

  if (loading) return <p className="admin-muted">読み込み中…</p>;
  if (!result) return <p className="admin-muted">最終結果を取得できませんでした。</p>;

  const selected = result.decisions.filter((d) => d.is_selected);
  const p = result.participation;
  const provisional = result.status !== "completed";  // 完了前＝暫定の途中経過

  return (
    <section aria-label="クエストの最終結果" className="qresult stack">
      {provisional ? (
        <p className="role-note" role="status" style={{ marginTop: 0 }}>
          ⏳ このクエストは<strong>進行中</strong>です。以下は<strong>暫定の途中経過</strong>（アイデア選別の申し送りの下書き）で、完了時に確定します（ISO 56001 の継続的モニタリング）。
        </p>
      ) : (
        <p className="role-note" style={{ marginTop: 0 }}>
          クエスト完了時の<strong>アイデア選別の申し送り</strong>です（アイデア＋議論＋評価の総括・ISO 56001）。
        </p>
      )}

      {/* ① 選定アイデア */}
      <section className="card" aria-label="選定アイデア">
        <div className="section-head"><h3 style={{ margin: 0 }}>✅ 選定アイデア（{selected.length}）</h3></div>
        {selected.length === 0 ? (
          <p className="muted text-sm">選定されたアイデアはありません（選定なしで完了）。</p>
        ) : (
          <ul className="qresult__list">
            {selected.map((d) => (
              <li key={d.idea_id} className="qresult__idea">
                <QuestIcon name={d.title} color={quest.color} size="sm" />
                <div className="qresult__idea-main">
                  <div className="qresult__idea-top">
                    <Link className="card-title" href={`/ideas/${d.idea_id}`}>{d.title}</Link>
                    {d.overall_avg != null && <span className="badge">評価 {d.overall_avg}/5</span>}
                  </div>
                  {d.value && <div className="muted text-sm" style={{ whiteSpace: "pre-wrap" }}>{d.value}</div>}
                  <div className="qresult__idea-meta">
                    <Avatar name={d.author.display_name} imageUrl={d.author.avatar_image_url ?? undefined} size="sm" />
                    <span className="muted text-sm">投稿: {d.author.display_name}</span>
                    {/* ④(a) 議論の要点＝チャットへのリンク */}
                    <Link className="qresult__chat" href={`/ideas/${d.idea_id}/chat`}>💬 議論を見る</Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ② 評価・選別サマリ（参加指標＋観点別平均） */}
      <section className="card" aria-label="評価・選別サマリ">
        <div className="section-head"><h3 style={{ margin: 0 }}>📊 評価・選別サマリ</h3></div>
        <div className="qresult__metrics">
          <span className="qresult__kpi"><b>{p.idea_count}</b><span>アイデア</span></span>
          <span className="qresult__kpi"><b>{p.selected_count}</b><span>選定</span></span>
          <span className="qresult__kpi"><b>{p.vote_total}</b><span>投票</span></span>
          <span className="qresult__kpi"><b>{p.evaluation_count}</b><span>評価</span></span>
          <span className="qresult__kpi"><b>{p.party_size}</b><span>パーティー</span></span>
        </div>
        <div className="qresult__aspects">
          {ASPECT_LABELS.map(([k, label]) => {
            const v = result.aspect_averages[k];
            return (
              <div key={k} className="qresult__aspect">
                <span className="qresult__aspect-label">{label}</span>
                <span className="qresult__bar"><span style={{ width: `${((v ?? 0) / 5) * 100}%` }} /></span>
                <span className="qresult__aspect-val">{v != null ? `${v}/5` : "—"}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ③ 意思決定の記録（公開アイデア＝評価平均順） */}
      <section className="card" aria-label="意思決定の記録">
        <div className="section-head"><h3 style={{ margin: 0 }}>🧭 意思決定の記録</h3></div>
        <ul className="qresult__decisions">
          {result.decisions.map((d) => (
            <li key={d.idea_id}>
              <span className={`badge ${d.is_selected ? "" : "badge-muted"}`}>{d.is_selected ? "採用" : "不採用"}</span>
              <Link href={`/ideas/${d.idea_id}`}>{d.title}</Link>
              <span className="muted text-sm">{d.overall_avg != null ? `評価 ${d.overall_avg}/5（${d.evaluation_count}件）` : "評価なし"}</span>
            </li>
          ))}
          {result.decisions.length === 0 && <li className="muted text-sm">公開アイデアはありません。</li>}
        </ul>
      </section>

      {/* ④ 議論の要点＝(b)ピン留め＋(c)自動要約（抽出型・オフライン・無料） */}
      {(result.pinned_messages.length > 0 || result.can_edit || result.outcome.chat_summary) && (
        <section className="card" aria-label="議論の要点">
          <div className="section-head">
            <h3 style={{ margin: 0 }}>📌 議論の要点</h3>
            {result.can_edit && (
              <Button type="button" variant="outline" onClick={() => void runSummary()} loading={summarizing}>
                {result.outcome.chat_summary ? "自動要約を再生成" : "チャットを自動要約"}
              </Button>
            )}
          </div>
          {/* (c) 自動要約＝無料・オフライン抽出型（外部送信なし・粗め）。 */}
          {result.outcome.chat_summary && (
            <div className="qresult__summary">
              <div className="qresult__label">自動要約（抽出型・参考）</div>
              <p style={{ whiteSpace: "pre-wrap", margin: "2px 0 0" }}>{result.outcome.chat_summary}</p>
            </div>
          )}
          {/* (b) ピン留めした重要メッセージ */}
          {result.pinned_messages.length > 0 ? (
            <ul className="qresult__pins">
              {result.pinned_messages.map((pm) => (
                <li key={pm.message_id} className="qresult__pin">
                  <Avatar name={pm.author.display_name} imageUrl={pm.author.avatar_image_url ?? undefined} size="sm" />
                  <div className="qresult__pin-main">
                    <p className="qresult__pin-body" style={{ whiteSpace: "pre-wrap" }}>{pm.excerpt}</p>
                    <div className="qresult__pin-meta">
                      <span className="muted text-xs">{pm.author.display_name}</span>
                      <Link className="qresult__chat" href={`/ideas/${pm.idea_id}/chat`}>💬 {pm.idea_title}</Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm" style={{ marginTop: "var(--space-2)" }}>チャットで重要な発言を <strong>📌</strong> ピン留めすると、ここに集約されます。</p>
          )}
        </section>
      )}

      {/* ⑤ 振り返り・学び ＋ ⑥ 次アクション（owner/管理が編集）＝読み取りは常時表示・編集はダイアログ（ユーザー要望） */}
      <section className="card" aria-label="振り返り・次アクション">
        <div className="section-head">
          <h3 style={{ margin: 0 }}>📝 振り返り・学び / 次アクション</h3>
          {result.can_edit && <Button type="button" variant="outline" onClick={() => setEditing(true)}>編集</Button>}
        </div>
        <div className="qresult__outcome">
          <div className="qresult__label">成果（総括）</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{result.outcome.summary || "—"}</p>
          <div className="qresult__label">学び・課題</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{result.outcome.learnings || "—"}</p>
          <div className="qresult__label">成果の指標（KPI）</div>
          {metrics.length > 0 ? (
            <ul className="qresult__kpilist">{metrics.map((m, i) => <li key={i}><b>{m.label || "—"}</b>：{m.value || "—"}</li>)}</ul>
          ) : <p className="muted text-sm">—</p>}
          <div className="qresult__label">次アクション</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{result.outcome.next_actions || "—"}</p>
          <div style={{ marginTop: "var(--space-3)" }}>
            <Link className="btn btn-outline btn-sm" href={dupHref}>このクエストを複製して次を起票 →</Link>
          </div>
          {result.outcome.updated_by_name && (
            <p className="muted text-xs" style={{ marginTop: "var(--space-2)" }}>最終更新: {result.outcome.updated_by_name}</p>
          )}
          {/* 更新履歴＝情報インプットの詳細と同じ disclosure UI（概要パネル無しのため折り畳み・変更履歴標準 §3.1）。ISO §10 改善＝当時の学び/次アクションを追える。 */}
          {result.outcome_revisions.length > 0 && (
            <details className="disclosure" style={{ marginTop: "var(--space-4)" }}>
              <summary>🕘 更新履歴（{result.outcome_revisions.length} 版）</summary>
              <div className="disclosure__body">
                <RevisionTimeline
                  variant="info"
                  revisions={result.outcome_revisions as unknown as RevisionRow[]}
                  currentRevision={result.outcome_revisions[0]?.revision ?? 1}
                  fieldLabels={OUTCOME_FIELD_LABELS}
                  loadDiff={(r) => getQuestOutcomeRevisionDiff(questId, r) as Promise<RevisionDiff | null>}
                  initialNote="振り返りを記入。"
                />
              </div>
            </details>
          )}
        </div>
      </section>

      {/* ⑥ 採用された関連情報（FR-41 Phase2）＝クエスト＋配下アイデアで採用した外部情報＋処理メモ */}
      {result.adopted_info.length > 0 && (
        <section className="card" aria-label="採用された関連情報">
          <div className="section-head"><h3 style={{ margin: 0 }}>🔗 採用された関連情報（{result.adopted_info.length}）</h3></div>
          <ul className="qresult__adopted">
            {result.adopted_info.map((a) => (
              <li key={a.link_id} className="qresult__adopted-item">
                <div className="qresult__adopted-top">
                  {/* 情報詳細は参照モード（採否モード）で開く＝?from=対象種別:対象ID（SC-52 §7-採否） */}
                  <Link className="card-title" href={`/info-items/${a.info_id}?from=${a.target_type}:${a.target_id}`}>{a.title}</Link>
                  {a.source_url && <a className="qresult__chat" href={a.source_url} target="_blank" rel="noopener noreferrer">🔗 出典</a>}
                  <span className="badge badge-muted">
                    {a.target_type === "quests" ? "このクエスト" : <>💡 <Link href={`/ideas/${a.target_id}`}>{a.target_title || "アイデア"}</Link></>}
                  </span>
                </div>
                {a.note && <p className="qresult__adopted-note" style={{ whiteSpace: "pre-wrap" }}>📝 {a.note}</p>}
                {a.disposed_by && <p className="muted text-xs">採用: {a.disposed_by.display_name}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 編集ダイアログ（デザイン標準 §103-107＝登録/編集は原則モーダル。旧インライン展開を廃止） */}
      <Modal open={editing} onClose={cancelEdit} title="振り返り・学び / 次アクションを編集" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <ModalBody>
            {/* 標準の Field（.field＝ラベル書式・ラベル↔入力の余白・項目間の仕切り線）に統一＝他ダイアログと同じ見た目。 */}
            <div className="qresult__edit">
              <Field id="qr_summary" label="成果（総括）">
                <textarea id="qr_summary" className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="このクエストで何を得たか" />
              </Field>
              <Field className="dialog-section is-quiet" id="qr_learn" label="学び・課題">
                <textarea id="qr_learn" className="textarea" value={learnings} onChange={(e) => setLearnings(e.target.value)} placeholder="うまくいった点・課題・次に活かすこと" />
              </Field>
              <Field className="dialog-section is-quiet" id="qr_metrics" label="成果の指標（KPI・任意）">
                {metrics.map((m, i) => (
                  <div key={i} className="qresult__metric-row">
                    <input className="input" placeholder="指標名（例: 削減工数）" value={m.label} onChange={(e) => setMetrics((ms) => ms.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                    <input className="input" placeholder="値（例: 20h/月）" value={m.value} onChange={(e) => setMetrics((ms) => ms.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                    <button type="button" className="btn btn-sm btn-danger" aria-label="指標を削除" onClick={() => setMetrics((ms) => ms.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: "var(--space-2)" }} onClick={() => setMetrics((ms) => [...ms, { label: "", value: "" }])}>＋ 指標を追加</button>
              </Field>
              <Field className="dialog-section is-quiet" id="qr_next" label="次アクション">
                <textarea id="qr_next" className="textarea" value={nextActions} onChange={(e) => setNextActions(e.target.value)} placeholder="次にやること・後続クエストの方針" />
              </Field>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" className="dialog-close-left" onClick={cancelEdit} disabled={saving}>キャンセル</Button>
            <Button type="submit" variant="primary" loading={saving}>保存する</Button>
          </ModalFooter>
        </form>
      </Modal>
    </section>
  );
}
