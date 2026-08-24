"use client";

// SC-22 アイデア詳細＝本文/価値/利害関係者/ステータス/作成者/版数（D.1 GET /ideas/{id} 実接続）。
// 投票（D.5）・フォロー（D.6）も実接続＝楽観更新＋サーバー権威（409/403 でロールバック＋理由トースト）。
// quest 参照（D.1）でクエストへの戻る導線・カテゴリーバッジ・completed 凍結の事前無効化を実装。
// 正＝doc/画面設計/mocks/SC-22_アイデア詳細.html・doc/画面設計/screens/SC-22_アイデア詳細.md（§4.5）。
// **未接続（EP 未実装/他ドメイン）＝表示のみ or デモ**: 添付（D.3）・評価結果（F）・チャット（E）・更新履歴の差分（版 EP 未公開）。
// 締切後（時刻）の事前無効化は deadline 判定を要するため未実装＝サーバー 409 を権威に理由提示（completed のみ事前無効化）。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Avatar, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { followIdea, getIdea, removeVote, unfollowIdea, voteIdea, type IdeaDetail, type IdeaVoteType } from "../api";
import { IdeaForm } from "./IdeaForm";
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

// ---- デモ fixtures（未接続セクション用・添付/評価/チャット/履歴） ----
const ATTACHMENTS = [
  { icon: "📄", name: "夜間配送_試算シート.xlsx", sub: "248 KB ・ 鈴木 花子 ・ 2026/07/10" },
  { icon: "🖼️", name: "ルート集約イメージ.png", sub: "1.2 MB ・ 鈴木 花子 ・ 2026/07/10" },
];

// 直近14日の日次メッセージ数（has=アイデア更新日 / recent=直近） ※モックの棒グラフと一致
const SPARK = [
  { h: 12 }, { h: 28 }, { h: 20 }, { h: 45, update: "7/10 投稿" },
  { h: 60 }, { h: 35 }, { h: 18 }, { h: 8 },
  { h: 70, update: "7/16 更新（本文・添付）" }, { h: 85 },
  { h: 55, recent: true }, { h: 95, recent: true }, { h: 75, recent: true }, { h: 40, recent: true },
];

const CHAT_PREVIEW = [
  { initial: "田", name: "田中 一郎", time: "7/15 14:20", text: "積載率の現状値ってどれくらいですか？試算の前提が知りたいです。" },
  { initial: "鈴", name: "鈴木 花子", time: "7/15 15:02", mention: "@田中一郎", text: " 平均62%です。集約後は80%超を見込んでいます（添付の試算シート参照）。" },
];

const SCORES = [
  { label: "新規性", pct: 90, val: "4.5" },
  { label: "影響度", pct: 80, val: "4.0" },
  { label: "実現度", pct: 70, val: "3.5" },
  { label: "適合性", pct: 90, val: "4.5" },
  { label: "コスト", pct: 90, val: "4.5", info: true },
];

const OVERALL = [
  { initial: "山", name: "山田 太郎", text: "全体として実現性の担保が課題だが、コスト効果と環境貢献を両立できる点は非常に魅力的。まず首都圏3拠点のパイロットで数字を出せれば、全社展開の説得力が一気に高まる。" },
  { initial: "田", name: "田中 一郎", text: "費用対効果が明確で優先度は高い。実行に移すなら早期に物流部と合意形成を進めたい。" },
];

const ASPECT_COMMENTS = [
  { initial: "山", name: "山田 太郎", aspect: "実現度", text: "拠点間の調整が鍵。パイロットの3拠点選定を早めに。" },
  { initial: "田", name: "田中 一郎", aspect: "コスト", text: "削減幅が大きく、初期投資も小さい。費用対効果は高い。" },
];

export function IdeaDetailView({ ideaId }: { ideaId: string }) {
  const snack = useSnackbar();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 投票/フォローは楽観更新のためローカル state で保持（load 時に DTO から同期）。
  const [vote, setVote] = useState<{ approve: number; oppose: number; my: IdeaVoteType | null }>({ approve: 0, oppose: 0, my: null });
  const [following, setFollowing] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getIdea(ideaId);
      if (!d) setLoadError("このアイデアは見つからないか、参照する権限がありません。");
      else {
        setIdea(d);
        const dv = (d.vote ?? {}) as { summary?: { approve?: number; oppose?: number }; my_vote?: string | null };
        setVote({
          approve: dv.summary?.approve ?? 0,
          oppose: dv.summary?.oppose ?? 0,
          my: dv.my_vote === "approve" || dv.my_vote === "oppose" ? dv.my_vote : null,
        });
        setFollowing(!!d.following);
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
  const handleVote = useCallback(async (type: IdeaVoteType) => {
    if (voteBusy) return;
    const prev = vote;
    setVoteBusy(true);
    try {
      if (prev.my === type) {
        // 同じ選択肢を再クリック＝取消。
        setVote((s) => ({ ...s, [type]: Math.max(0, s[type] - 1), my: null }));
        await removeVote(ideaId);
      } else {
        // 新規 or 切替（1人1票・前の票を減算）。
        setVote((s) => ({
          approve: s.approve + (type === "approve" ? 1 : 0) - (prev.my === "approve" ? 1 : 0),
          oppose: s.oppose + (type === "oppose" ? 1 : 0) - (prev.my === "oppose" ? 1 : 0),
          my: type,
        }));
        const res = await voteIdea(ideaId, type);
        // サーバー集計を権威に反映（匿名化・整合）。
        if (res) setVote({ approve: res.summary.approve, oppose: res.summary.oppose, my: (res.my_vote as IdeaVoteType | null) ?? null });
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
  }, [ideaId, vote, voteBusy, snack]);

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

  if (loading) {
    return <main className="container detail-main"><p className="admin-muted" style={{ marginTop: "var(--space-6)" }}>読み込み中…</p></main>;
  }
  if (loadError || !idea) {
    return (
      <main className="container detail-main">
        <Link className="backlink" href="/quests">← クエスト一覧へ戻る</Link>
        <div className="form-error" role="alert" style={{ marginTop: "var(--space-4)" }}>{loadError ?? "アイデアが見つかりません。"}</div>
      </main>
    );
  }

  // 投票集計/自分の投票/フォローはローカル state（楽観更新・load 時に DTO から同期）。
  const agreeN = vote.approve;
  const disagreeN = vote.oppose;
  const myVote = vote.my === "approve" ? "agree" : vote.my === "oppose" ? "disagree" : null;
  const [stLabel, stClass] = statusLabel(idea.status, idea.is_selected);
  // クエスト凍結（completed）＝投票不可・新規フォロー不可（解除のみ可）。サーバー 409 も権威（C.5）。
  const questCompleted = idea.quest.status === "completed";
  const voteDisabled = voteBusy || questCompleted;
  const followDisabled = followBusy || (questCompleted && !following);
  const authorName = idea.author.display_name || "?";
  const stakeText = idea.stakeholders.map((s) => s.label).join("・") || "—";

  return (
    <main className="container detail-main">
      {/* クエストへ戻る（D.1 quest 参照・実導線）。 */}
      <Link className="backlink" href={`/quests/${idea.quest.id}`}>
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
              版 {idea.current_revision}（履歴・デモ）
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

          {/* 関連資料（添付） */}
          <section className="card" aria-label="関連資料">
            <h2 className="card-title">
              関連資料 <span className="badge badge-muted">{ATTACHMENTS.length}</span>
            </h2>
            <ul className="file-list">
              {ATTACHMENTS.map((f) => (
                <li className="file-item" key={f.name}>
                  <span className="file-icon">{f.icon}</span>
                  <span className="file-info">
                    <span className="file-name">{f.name}</span>
                    <span className="file-sub">{f.sub}</span>
                  </span>
                  <button className="btn btn-outline btn-sm" type="button">
                    ⬇ ダウンロード
                  </button>
                </li>
              ))}
            </ul>
            <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
              ※ 添付（アップロード/ダウンロード）は準備中です（D.3 未接続＝以下はデモ表示）。
            </p>
          </section>

          {/* チャット（導線＋直近プレビュー） */}
          <section className="card" aria-label="チャット">
            <div className="between" style={{ marginBottom: "var(--space-3)" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                チャット <span className="badge badge-muted">💬 8</span>
              </h2>
              <span className="role-note">チャット（E）は未接続＝デモ表示</span>
            </div>

            {/* 議論アクティビティ・グラフ（活発度の可視化） */}
            <div className="activity" aria-label="議論の活発度">
              <div className="activity__head">
                <span className="activity__label">議論の活発度</span>
                <span className="activity__state hot">🔥 活発</span>
              </div>
              <div
                className="spark"
                role="img"
                aria-label="直近14日の日次メッセージ数の棒グラフ。7/16に更新、直近3日が活発。"
              >
                {SPARK.map((b, i) => (
                  <span
                    key={i}
                    className={["spark__bar", b.update ? "has-update" : "", b.recent ? "is-recent" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ height: `${b.h}%` }}
                    title={b.update}
                  />
                ))}
              </div>
              <div className="activity__axis">
                <span>7/05</span>
                <span>7/12</span>
                <span>今日</span>
              </div>
              <div className="activity__summary">
                <span>
                  今週 <b>18件</b>（先週比 <b>↑ +7</b>）
                </span>
                <span>
                  参加 <b>5人</b>
                </span>
                <span>
                  最終投稿 <b>3時間前</b>
                </span>
              </div>
              <div className="activity__legend">
                ◆ = アイデア更新（更新後に議論が再燃）。まだ活発に議論中のため、評価は落ち着いてからが目安。
              </div>
            </div>

            <div className="chat-preview">
              {CHAT_PREVIEW.map((m, i) => (
                <div className="chat-msg" key={i}>
                  <Avatar name={m.initial} size="sm" />
                  <div className="chat-msg__body">
                    <div className="chat-msg__head">
                      <span className="chat-msg__name">{m.name}</span>
                      <span className="chat-msg__time">{m.time}</span>
                    </div>
                    <p className="chat-msg__text">
                      {m.mention && <span className="mention">{m.mention}</span>}
                      {m.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <Link className="btn btn-primary" href={`/ideas/${ideaId}/chat`}>
              チャットを開く →
            </Link>
          </section>
        </div>

        {/* ---------- 右レール ---------- */}
        <div className="idea-rail">
          {/* 投票 */}
          <section className="card" aria-label="投票">
            <h2 className="card-title">投票</h2>

            <div className="vote-summary">
              <span className="vote-agree">▲ 賛成 {agreeN}</span>
              <span className="vote-disagree">▼ 反対 {disagreeN}</span>
            </div>
            <div className="vote-btns">
              {/* 投票（D.5・1人1票・締切まで変更可・同ボタン再クリックで取消）。completed は事前無効化＋サーバー権威（締切後/権限なしは 409/403→理由トースト）。 */}
              <button className={`vote-btn agree${myVote === "agree" ? " is-on" : ""}`} type="button" aria-pressed={myVote === "agree"} disabled={voteDisabled} title={questCompleted ? "完了したクエストでは投票できません" : undefined} onClick={() => void handleVote("approve")}>
                ▲ 賛成
              </button>
              <button className={`vote-btn disagree${myVote === "disagree" ? " is-on" : ""}`} type="button" aria-pressed={myVote === "disagree"} disabled={voteDisabled} title={questCompleted ? "完了したクエストでは投票できません" : undefined} onClick={() => void handleVote("oppose")}>
                ▼ 反対
              </button>
            </div>
            {questCompleted && <p className="role-note" style={{ marginTop: "var(--space-2)" }}>※ このクエストは完了済みのため投票は締め切られています。</p>}
            <p className="vote-note">
              1人1票・<strong>締切まで変更できます</strong>。投票すると <span className="xp">+5 XP</span>（自分のアイデアにも投票可）。
              <br />
              🔒 匿名モードでは賛成/反対の集計数のみ表示します。
            </p>
          </section>

          {/* 評価結果 */}
          <section className="card" aria-label="評価結果">
            <div className="eval-head">
              <h2 className="card-title" style={{ margin: 0 }}>
                評価結果
              </h2>
              <span className="badge badge-muted" title="評価（F）は未接続＝デモ表示">
                🔓 デモ表示（F 未接続）
              </span>
            </div>

            <div className="eval-avg">
              <span className="eval-avg__num">4.2</span>
              <span className="eval-avg__max">/ 5.0（平均・評価者2名）</span>
              <span className="eval-avg__coin">
                <span className="pixel-stat coin">◆ +42</span>
              </span>
            </div>
            {SCORES.map((s) => (
              <div className="score-row" key={s.label}>
                <span className="score-row__label">
                  {s.label}
                  {s.info && <span className="muted">ⓘ</span>}
                </span>
                <span className="score-bar">
                  <i style={{ width: `${s.pct}%` }} />
                </span>
                <span className="score-row__val">{s.val}</span>
              </div>
            ))}

            {/* 総評（評価者ごとの全体コメント） */}
            <div className="eval-section-label">総評</div>
            <div className="eval-overall">
              {OVERALL.map((c) => (
                <div className="eval-overall__item" key={c.name}>
                  <div className="eval-comment__head">
                    <Avatar name={c.initial} size="sm" />
                    <span className="chat-msg__name">{c.name}</span>
                  </div>
                  <p className="eval-comment__text">{c.text}</p>
                </div>
              ))}
            </div>

            <div className="eval-section-label">観点別コメント</div>
            <div className="eval-comments">
              {ASPECT_COMMENTS.map((c) => (
                <div className="eval-comment" key={c.name}>
                  <div className="eval-comment__head">
                    <Avatar name={c.initial} size="sm" />
                    <span className="chat-msg__name">{c.name}</span>
                    <span className="badge badge-muted eval-comment__aspect">{c.aspect}</span>
                  </div>
                  <p className="eval-comment__text">{c.text}</p>
                </div>
              ))}
            </div>
            <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
              5観点は<strong>均等平均</strong>。コインは <code>round(平均×10)</code>（最大50）を投稿者に付与。コスト観点は
              <strong>低コストほど高得点</strong>。
            </p>

            {/* 評価者向けアクション（▼ 評価者権限がある場合のみ表示） */}
            <div className="modal__foot" style={{ marginTop: "var(--space-4)" }}>
              <Link className="btn btn-primary" href={`/ideas/${ideaId}/eval`}>
                評価する / 編集
              </Link>
            </div>
            <p className="role-note" style={{ marginTop: "var(--space-2)" }}>
              ▲ 評価ボタンは<strong>評価者権限</strong>がある場合のみ表示。公開範囲（既定＝パーティー全員／限定）は評価時に指定。
            </p>
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

      {/* ============ 更新履歴モーダル（版タイムライン＋差分） ============ */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="更新履歴" size="lg">
        <ModalBody>
          <p className="role-note" style={{ marginTop: 0 }}>
            ※ 版の履歴/差分（D.4）は未接続のため<strong>デモ表示</strong>です。アイデアの変更を新しい順に表示予定。
            各版を開くと差分（<span className="diff-add">追加</span>／<span className="diff-del">削除</span>）が見られます。
          </p>

          <div style={{ marginTop: "var(--space-4)" }}>
            {/* v3（現在） */}
            <div className="rev is-current">
              <div className="rev__head">
                <span className="rev__time">2026/07/16 14:30</span>
                <span className="badge badge-muted">現在</span>
                <span className="poster">
                  <Avatar name="鈴木 花子" size="sm" />
                  <span className="name">鈴木 花子</span>
                </span>
              </div>
              <div className="rev__fields">
                <span className="badge badge-muted">本文</span>
                <span className="badge badge-muted">添付</span>
              </div>
              <div className="rev__note">📝 試算の前提を明確化し、根拠シートを最新版へ差し替え。</div>
              <details className="rev__diff" open>
                <summary className="role-note" style={{ cursor: "pointer" }}>
                  差分を表示
                </summary>
                <div className="diff-field">
                  <div className="diff-field__label">アイデア本文</div>
                  <div className="diff-text">
                    複数拠点の夜間配送を1本のルートに集約し、積載率を高める。
                    <span className="diff-del">需要予測は担当者が手動で行う。</span>
                    <span className="diff-add">AIで需要予測して翌日ルートを自動生成し、繁忙期は臨時便を差し込む。</span>
                    まず首都圏3拠点でパイロット運用し、効果を検証してから全国へ展開する。
                  </div>
                </div>
                <div className="diff-field">
                  <div className="diff-field__label">関連資料</div>
                  <div className="diff-text">
                    <span className="diff-del">📊 夜間配送_試算.xlsx</span> →{" "}
                    <span className="diff-add">📊 夜間配送_試算シートv2.xlsx</span>
                  </div>
                </div>
              </details>
            </div>

            {/* あなたの投票時点の区切り */}
            <div className="rev-since">↑ ここから上が「あなたの投票（7/12）より後」の変更です</div>

            {/* v2 */}
            <div className="rev">
              <div className="rev__head">
                <span className="rev__time">2026/07/12 10:05</span>
                <span className="poster">
                  <Avatar name="鈴木 花子" size="sm" />
                  <span className="name">鈴木 花子</span>
                </span>
              </div>
              <div className="rev__fields">
                <span className="badge badge-muted">価値</span>
                <span className="badge badge-muted">タイムリミット</span>
              </div>
              <div className="rev__note">📝 レビューコメントを反映。</div>
              <details className="rev__diff">
                <summary className="role-note" style={{ cursor: "pointer" }}>
                  差分を表示
                </summary>
                <div className="diff-field">
                  <div className="diff-field__label">価値</div>
                  <div className="diff-text">
                    配送コストを約<span className="diff-del">10%</span>
                    <span className="diff-add">15%</span>削減しつつ、CO2排出も同時に削減できる。
                  </div>
                </div>
                <div className="diff-field">
                  <div className="diff-field__label">タイムリミット</div>
                  <div className="diff-oldnew">
                    <span className="old">2026/07/20</span> → <span className="new">2026/07/25</span>
                  </div>
                </div>
              </details>
            </div>

            {/* v1（初版） */}
            <div className="rev">
              <div className="rev__head">
                <span className="rev__time">2026/07/10 09:00</span>
                <span className="badge badge-muted">初版</span>
                <span className="poster">
                  <Avatar name="鈴木 花子" size="sm" />
                  <span className="name">鈴木 花子</span>
                </span>
              </div>
              <div className="rev__note">アイデアを投稿。</div>
            </div>
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
