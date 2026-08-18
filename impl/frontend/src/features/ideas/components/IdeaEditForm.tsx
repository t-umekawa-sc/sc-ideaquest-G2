"use client";

// SC-22 アイデア編集フォーム（SC-21 アイデア登録・編集フォームの編集モード）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-22_アイデア詳細.html（編集モーダル）／mocks/SC-21_アイデア登録編集.html。
// アイデア backend は未実装＝画面モック先行（デモ・保存は onDone のみ）。共通モーダル（Modal）に body/footer を渡す。
import { useRef, useState } from "react";

import { Button, Field, ModalBody, ModalFooter } from "@/components/ui";

const STAKE_SUGGESTIONS = ["物流部", "配送委託先", "経営企画部", "情報システム部", "現場ドライバー"];

type Attach = { icon: string; name: string; size: string };

// 編集モードの初期値（デモ・当該アイデア＝SC-22 表示中のもの）。接続時は GET /ideas/{id} で供給。
const INITIAL = {
  subject: "夜間配送の集約による積載率改善",
  value: "配送コストを約15%削減しつつ、CO2排出も同時に削減できる。ドライバーの日中拘束を減らし労務環境も改善。",
  body: "複数拠点で個別に走らせている夜間配送を1本のルートに集約し、積載率を高める。AIで需要予測しながら翌日ルートを自動生成、繁忙期は臨時便を差し込む。まずは首都圏3拠点でパイロット運用し、効果を検証してから全国展開する。",
  limit: "2026-07-25",
  stakeholders: ["物流部", "配送委託先"],
  note: "",
  attachments: [
    { icon: "📊", name: "夜間配送_試算シート.xlsx", size: "248 KB" },
    { icon: "🖼️", name: "ルート集約イメージ.png", size: "1.2 MB" },
  ] as Attach[],
};

function iconFor(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (ext === "pdf") return "📕";
  if (["doc", "docx"].includes(ext)) return "📄";
  return "📎";
}
function fmtSize(b: number) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

export function IdeaEditForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [subject, setSubject] = useState(INITIAL.subject);
  const [value, setValue] = useState(INITIAL.value);
  const [body, setBody] = useState(INITIAL.body);
  const [limit, setLimit] = useState(INITIAL.limit);
  const [stakeholders, setStakeholders] = useState<string[]>(INITIAL.stakeholders);
  const [stakeInput, setStakeInput] = useState("");
  const [note, setNote] = useState(INITIAL.note);
  const [attachments, setAttachments] = useState<Attach[]>(INITIAL.attachments);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSave = subject.trim() && value.trim() && body.trim();

  function addStake(v: string) {
    const t = v.trim();
    if (t && !stakeholders.includes(t)) setStakeholders((s) => [...s, t]);
    setStakeInput("");
  }
  function onStakeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addStake(stakeInput);
    }
  }
  function addFiles(files: FileList) {
    const next = Array.from(files).map((f) => ({ icon: iconFor(f.name), name: f.name, size: fmtSize(f.size) }));
    setAttachments((a) => [...a, ...next]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // アイデア backend 未実装＝デモ（保存せず閉じる）。接続時に PATCH /ideas/{id} へ差し替え。
    setPending(true);
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate>
      <ModalBody>
        {/* 対象クエストの文脈 */}
        <div className="card" style={{ padding: "var(--space-3) var(--space-4)", marginBottom: "var(--space-4)" }}>
          <div className="text-xs muted">投稿先クエスト</div>
          <div style={{ fontWeight: 700 }}>
            <span className="quest-icon sm" style={{ verticalAlign: "middle", marginRight: 6 }}>
              <span className="quest-icon__char">配</span>
              <span className="quest-icon__owner placeholder">鈴</span>
            </span>
            配送ルート最適化 <span className="badge badge-muted">業務改善</span>
          </div>
        </div>
        <p className="role-note" style={{ marginTop: 0 }}>
          編集できるのは<strong>作成者本人またはクエスト管理権限者</strong>のみ。必須は{" "}
          <strong>件名・アイデア本文・価値</strong> の 3 項目。更新すると<strong>投票者とフォロワーに通知</strong>されます。
        </p>

        {/* 必須 3 項目 */}
        <Field id="e_subject" label="件名" required>
          <input id="e_subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </Field>
        <Field id="e_value" label="価値" required>
          <textarea
            id="e_value"
            className="textarea"
            style={{ minHeight: 80 }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </Field>
        <Field id="e_body" label="アイデア本文" required>
          <textarea
            id="e_body"
            className="textarea"
            style={{ minHeight: 120 }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </Field>

        {/* 任意項目（既存値があるため開いた状態） */}
        <details className="optional" open>
          <summary>任意項目（タイムリミット・利害関係者・備考）</summary>
          <div className="optional__body">
            <div className="field-row">
              <Field id="e_limit" label="タイムリミット" hint="実施/検討の想定期限。">
                <input id="e_limit" className="input" type="date" value={limit} onChange={(e) => setLimit(e.target.value)} />
              </Field>
              <Field id="e_stake" label="利害関係者" hint="複数選択可。候補に無ければ入力して Enter で追加。">
                {stakeholders.length > 0 && (
                  <div className="tagselect__chips">
                    {stakeholders.map((s) => (
                      <span key={s} className="tagselect__chip">
                        {s}
                        <button
                          type="button"
                          aria-label={`${s} を外す`}
                          onClick={() => setStakeholders((cur) => cur.filter((x) => x !== s))}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  id="e_stake"
                  className="input"
                  role="combobox"
                  aria-expanded={false}
                  placeholder="関係する人・部署を選択または入力…"
                  value={stakeInput}
                  onChange={(e) => setStakeInput(e.target.value)}
                  onKeyDown={onStakeKeyDown}
                />
                <div className="tagselect__sug">
                  {STAKE_SUGGESTIONS.filter((s) => !stakeholders.includes(s)).map((s) => (
                    <button key={s} type="button" className="tagselect__sugbtn" onClick={() => addStake(s)}>
                      ＋ {s}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <Field id="e_note" label="備考 / 特記事項">
              <textarea
                id="e_note"
                className="textarea"
                style={{ minHeight: 80 }}
                placeholder="補足事項があれば"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        </details>

        {/* 関連資料 添付（既存2件をプリフィル・追加/削除可） */}
        <Field id="e_files" label="関連資料（任意・複数可）">
          <input
            ref={fileRef}
            id="e_files"
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            className={`dropzone${over ? " is-over" : ""}`}
            tabIndex={0}
            role="button"
            aria-label="ファイルを添付"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            📎 クリックまたはドラッグ＆ドロップで添付
          </div>
          {attachments.length > 0 && (
            <div className="attach-list">
              {attachments.map((a, i) => (
                <div className="attach" key={`${a.name}-${i}`}>
                  <span className="attach__icon">{a.icon}</span>
                  <div className="attach__meta">
                    <div className="attach__name">{a.name}</div>
                    <div className="attach__size">{a.size}</div>
                  </div>
                  <button
                    className="attach__remove"
                    type="button"
                    aria-label="削除"
                    onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </Field>

        <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
          必須3項目がそろうと「変更を保存」が押せます。保存すると更新履歴に記録され、
          <strong>投票者とフォロワーに通知</strong>されます。
        </p>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" variant="primary" disabled={!canSave || pending}>
          {pending ? "保存中…" : "変更を保存"}
        </Button>
      </ModalFooter>
    </form>
  );
}
