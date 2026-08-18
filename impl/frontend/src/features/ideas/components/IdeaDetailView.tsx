"use client";

// SC-22 アイデア詳細＝本文/価値/添付・投票（賛成/反対・インライン）・評価結果・チャット導線・更新履歴。
// 正＝doc/画面設計/mocks/SC-22_アイデア詳細.html・doc/画面設計/screens/SC-22_アイデア詳細.md。
// アイデア backend 未実装＝デモ fixtures（フロントエンド実装フロー規約＝画面モック先行）。
import Link from "next/link";
import { useState } from "react";

import { Avatar, Modal, ModalBody, ModalFooter } from "@/components/ui";

import { IdeaForm, type IdeaInitial } from "./IdeaForm";
import "../ideas.css";

// 編集モードの初期値（デモ・当該アイデア＝表示中のもの）。接続時は GET /ideas/{id} で供給。
const EDIT_INITIAL: IdeaInitial = {
  subject: "夜間配送の集約による積載率改善",
  value: "配送コストを約15%削減しつつ、CO2排出も同時に削減できる。ドライバーの日中拘束を減らし労務環境も改善。",
  body: "複数拠点で個別に走らせている夜間配送を1本のルートに集約し、積載率を高める。AIで需要予測しながら翌日ルートを自動生成、繁忙期は臨時便を差し込む。まずは首都圏3拠点でパイロット運用し、効果を検証してから全国展開する。",
  limit: "2026-07-25",
  stakeholders: ["物流部", "配送委託先"],
  note: "",
  attachments: [
    { icon: "📊", name: "夜間配送_試算シート.xlsx", size: "248 KB" },
    { icon: "🖼️", name: "ルート集約イメージ.png", size: "1.2 MB" },
  ],
};

// ---- デモ fixtures（モック SC-22 と一致） ----
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
  const [following, setFollowing] = useState(true);
  const [myVote, setMyVote] = useState<"agree" | "disagree" | null>("agree");
  const [ackUpdate, setAckUpdate] = useState(false); // 更新後に投票し直したら見直し導線を消す
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const base = { agree: 11, disagree: 3 }; // 自分の1票を除いた基礎値
  const agreeN = base.agree + (myVote === "agree" ? 1 : 0);
  const disagreeN = base.disagree + (myVote === "disagree" ? 1 : 0);

  function vote(choice: "agree" | "disagree") {
    setMyVote((cur) => (cur === choice ? null : choice));
    setAckUpdate(true);
  }

  return (
    <main className="container detail-main">
      <Link className="backlink" href={`/quests/${ideaId}`}>
        ← クエスト「配送ルート最適化」へ戻る
      </Link>

      {/* ============ アイデアヘッダー ============ */}
      <section className="card idea-head" aria-label="アイデア情報">
        <div className="idea-head__top">
          <div style={{ minWidth: 0 }}>
            <div className="idea-head__badges">
              <span className="badge badge-muted">業務改善</span>
              <span className="badge badge-success">選定候補</span>
            </div>
            <h1>夜間配送の集約による積載率改善</h1>
            <div className="poster">
              <Avatar name="鈴木 花子" size="sm" level={12} />
              <span className="name">投稿: 鈴木 花子</span>
            </div>
          </div>
          <div className="idea-actions">
            <button
              className="follow-star"
              type="button"
              aria-pressed={following}
              onClick={() => setFollowing((v) => !v)}
            >
              {following ? "★ フォロー中" : "☆ フォロー"}
            </button>
            {/* 権限（作成者本人／クエスト管理）に応じて表示 */}
            <button className="btn btn-outline" type="button" onClick={() => setEditOpen(true)}>
              編集
            </button>
          </div>
        </div>
        <div className="idea-meta">
          <span>🗓 投稿 2026/07/10</span>
          <span>
            🔄 更新 2026/07/16・
            <button className="meta-history" type="button" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>
              3回更新（履歴を見る）
            </button>
          </span>
          <span className="soon">⏳ タイムリミット 2026/07/25（あと7日）</span>
          <span>🤝 利害関係者: 物流部・配送委託先</span>
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
              <p>配送コストを約15%削減しつつ、CO2排出も同時に削減できる。ドライバーの日中拘束を減らし労務環境も改善。</p>
            </div>
            <div className="sub-block">
              <p className="sub-label">
                アイデア本文<span className="req" title="必須項目">*</span>
              </p>
              <p>
                複数拠点で個別に走らせている夜間配送を1本のルートに集約し、積載率を高める。AIで需要予測しながら翌日ルートを自動生成、繁忙期は臨時便を差し込む。まずは首都圏3拠点でパイロット運用し、効果を検証してから全国展開する。
              </p>
            </div>
            <div className="sub-block">
              <p className="sub-label">利害関係者</p>
              <p>物流部（運用）／配送委託先（実働）／情報システム部（ルート生成基盤）。</p>
            </div>
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
              添付ファイルのダウンロードは、権限を確認したうえで行われます。
            </p>
          </section>

          {/* チャット（導線＋直近プレビュー） */}
          <section className="card" aria-label="チャット">
            <div className="between" style={{ marginBottom: "var(--space-3)" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                チャット <span className="badge badge-muted">💬 8</span>
              </h2>
              <span className="role-note">パーティー全員が閲覧・投稿できます</span>
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

            {/* 自分の投票後にアイデアが更新された場合の見直し導線 */}
            {!ackUpdate && (
              <div className="vote-updated">
                <span className="vote-updated__title">⚠ あなたの投票後にアイデアが更新されました</span>
                <span className="role-note" style={{ color: "var(--color-text)" }}>
                  7/16 に <strong>本文・添付</strong> が更新されました。差分を確認して、賛成/反対を見直せます。
                </span>
                <button className="btn btn-outline btn-sm" type="button" onClick={() => setHistoryOpen(true)}>
                  投票時点からの差分を見る
                </button>
              </div>
            )}

            <div className="vote-summary">
              <span className="vote-agree">▲ 賛成 {agreeN}</span>
              <span className="vote-disagree">▼ 反対 {disagreeN}</span>
            </div>
            <div className="vote-btns">
              <button
                className={`vote-btn agree${myVote === "agree" ? " is-on" : ""}`}
                type="button"
                aria-pressed={myVote === "agree"}
                onClick={() => vote("agree")}
              >
                ▲ 賛成
              </button>
              <button
                className={`vote-btn disagree${myVote === "disagree" ? " is-on" : ""}`}
                type="button"
                aria-pressed={myVote === "disagree"}
                onClick={() => vote("disagree")}
              >
                ▼ 反対
              </button>
            </div>
            {!ackUpdate && (
              <p className="role-note" style={{ marginTop: "var(--space-2)" }}>
                <span className="vote-stale-badge">更新前に投票</span> あなたの賛成は 7/16 の更新より前のものです。
              </p>
            )}
            <p className="vote-note">
              1人1票・<strong>締切まで変更できます</strong>。投票すると <span className="xp">+5 XP</span>
              （自分のアイデアにも投票可）。
              <br />
              🔒 この会社は<strong>匿名モード</strong>（賛成/反対の集計数のみ表示）。記名モードでは投票者のアバターを表示します。
            </p>
          </section>

          {/* 評価結果 */}
          <section className="card" aria-label="評価結果">
            <div className="eval-head">
              <h2 className="card-title" style={{ margin: 0 }}>
                評価結果
              </h2>
              <span className="badge badge-muted" title="評価者が指定した公開範囲">
                🔓 公開: パーティー全員
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
                <span className="badge badge-success">選定候補</span>
              </dd>
              <dt>カテゴリー</dt>
              <dd>業務改善</dd>
              <dt>公開範囲</dt>
              <dd>このクエストのパーティー内</dd>
              <dt>クエスト</dt>
              <dd>
                <Link href={`/quests/${ideaId}`}>配送ルート最適化</Link>
              </dd>
              <dt>投稿日</dt>
              <dd>2026/07/10</dd>
              <dt>最終更新</dt>
              <dd>2026/07/16</dd>
            </dl>
          </section>
        </div>
      </div>

      {/* ============ アイデア編集モーダル（SC-21 フォームの編集モード） ============ */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="アイデアを編集" size="lg">
        <IdeaForm mode="edit" initial={EDIT_INITIAL} onDone={() => setEditOpen(false)} onCancel={() => setEditOpen(false)} />
      </Modal>

      {/* ============ 更新履歴モーダル（版タイムライン＋差分） ============ */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="更新履歴" size="lg">
        <ModalBody>
          <p className="role-note" style={{ marginTop: 0 }}>
            アイデアの変更を新しい順に表示。各版を開くと差分（<span className="diff-add">追加</span>／
            <span className="diff-del">削除</span>）が見られます。更新時は<strong>投票者とフォロワーに通知</strong>されます。
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
