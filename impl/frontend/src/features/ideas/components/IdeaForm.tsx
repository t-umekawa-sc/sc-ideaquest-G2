"use client";

// SC-21 アイデア登録・編集フォーム（登録＝新規／編集＝SC-22 から）。create/edit で共有（DRY）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-21_アイデア登録編集.html・SC-22（編集モーダル）。
// アイデア backend は未実装＝画面モック先行（デモ・送信は onDone のみ）。共通モーダル（Modal/RouteModal）に body/footer を渡す。
import { useRef, useState } from "react";

import { Button, Field, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";

const STAKE_SUGGESTIONS = ["物流部", "配送委託先", "経営企画部", "情報システム部", "現場ドライバー"];

export type IdeaAttach = { icon: string; name: string; size: string };
export type IdeaInitial = {
  subject: string;
  value: string;
  body: string;
  limit: string;
  stakeholders: string[];
  note: string;
  attachments: IdeaAttach[];
};
const EMPTY: IdeaInitial = { subject: "", value: "", body: "", limit: "", stakeholders: [], note: "", attachments: [] };

type Quest = { char: string; ownerInitial: string; name: string; category: string };
const DEFAULT_QUEST: Quest = { char: "配", ownerInitial: "山", name: "配送ルート最適化", category: "業務改善" };

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

export function IdeaForm({
  mode,
  quest = DEFAULT_QUEST,
  initial,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  quest?: Quest;
  initial?: IdeaInitial;
  onDone: () => void;
  onCancel: () => void;
}) {
  const init = initial ?? EMPTY;
  const snack = useSnackbar();
  const [subject, setSubject] = useState(init.subject);
  const [value, setValue] = useState(init.value);
  const [body, setBody] = useState(init.body);
  const [limit, setLimit] = useState(init.limit);
  const [stakeholders, setStakeholders] = useState<string[]>(init.stakeholders);
  const [stakeInput, setStakeInput] = useState("");
  const [note, setNote] = useState(init.note);
  const [attachments, setAttachments] = useState<IdeaAttach[]>(init.attachments);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isEdit = mode === "edit";
  const canSave = Boolean(subject.trim() && value.trim() && body.trim());

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
    // アイデア backend 未実装＝デモ（送信せず閉じる）。接続時に POST /ideas（登録）/ PATCH /ideas/{id}（編集）へ差し替え。
    setPending(true);
    if (isEdit) {
      snack({ type: "success", title: "変更を保存しました", msg: "投票者とフォロワーに通知しました。" });
    } else {
      snack({ type: "reward", title: "アイデアを投稿しました", msg: "パーティーに公開しました。", rewards: [{ k: "xp", t: "＋50 XP" }] });
    }
    onDone();
  }
  function saveDraft() {
    snack({ type: "info", title: "下書きを保存しました", msg: "あなただけに表示されます。" });
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate>
      <ModalBody>
        {/* 投稿先クエストの文脈 */}
        <div className="card" style={{ padding: "var(--space-3) var(--space-4)", marginBottom: "var(--space-4)" }}>
          <div className="text-xs muted">投稿先クエスト</div>
          <div style={{ fontWeight: 700 }}>
            <span className="quest-icon sm" style={{ verticalAlign: "middle", marginRight: 6 }}>
              <span className="quest-icon__char">{quest.char}</span>
              <span className="quest-icon__owner placeholder">{quest.ownerInitial}</span>
            </span>
            {quest.name} <span className="badge badge-muted">{quest.category}</span>
          </div>
        </div>
        <p className="role-note" style={{ marginTop: 0 }}>
          {isEdit ? (
            <>
              編集できるのは<strong>作成者本人またはクエスト管理権限者</strong>のみ。必須は{" "}
              <strong>件名・アイデア本文・価値</strong> の 3 項目。更新すると<strong>投票者とフォロワーに通知</strong>されます。
            </>
          ) : (
            <>
              <strong>アイデア作成権限</strong>を持つパーティーメンバーが投稿できます。必須は{" "}
              <strong>件名・アイデア本文・価値</strong> の 3 項目。
            </>
          )}
        </p>

        {/* 必須 3 項目 */}
        <Field id="idea_subject" label="件名" required>
          <input
            id="idea_subject"
            className="input"
            placeholder="アイデアのタイトル"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </Field>
        <Field id="idea_value" label="価値" required>
          <textarea
            id="idea_value"
            className="textarea"
            style={{ minHeight: 80 }}
            placeholder="このアイデアがもたらす価値・メリット（評価の要になります）"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </Field>
        <Field id="idea_body" label="アイデア本文" required>
          <textarea
            id="idea_body"
            className="textarea"
            style={{ minHeight: 120 }}
            placeholder="どんなアイデアか、内容を説明してください"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </Field>

        {/* 任意項目（登録は投稿ハードルを下げるため閉／編集は既存値があるため開） */}
        <details className="optional" open={isEdit}>
          <summary>任意項目（タイムリミット・利害関係者・備考）</summary>
          <div className="optional__body">
            <div className="field-row">
              <Field id="idea_limit" label="タイムリミット" hint="実施/検討の想定期限。">
                <input id="idea_limit" className="input" type="date" value={limit} onChange={(e) => setLimit(e.target.value)} />
              </Field>
              <Field id="idea_stake" label="利害関係者" hint="複数選択可。候補に無ければ入力して Enter で追加。">
                {stakeholders.length > 0 && (
                  <div className="tagselect__chips">
                    {stakeholders.map((s) => (
                      <span key={s} className="tagselect__chip">
                        {s}
                        <button type="button" aria-label={`${s} を外す`} onClick={() => setStakeholders((cur) => cur.filter((x) => x !== s))}>
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  id="idea_stake"
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
            <Field id="idea_note" label="備考 / 特記事項">
              <textarea
                id="idea_note"
                className="textarea"
                style={{ minHeight: 80 }}
                placeholder="補足事項があれば"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
        </details>

        {/* 関連資料 添付（任意・複数可） */}
        <Field id="idea_files" label="関連資料（任意・複数可）">
          <input
            ref={fileRef}
            id="idea_files"
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
                  <button className="attach__remove" type="button" aria-label="削除" onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </Field>

        <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
          {isEdit ? (
            <>
              必須3項目がそろうと「変更を保存」が押せます。保存すると更新履歴に記録され、
              <strong>投票者とフォロワーに通知</strong>されます。
            </>
          ) : (
            <>
              必須3項目がそろうと「投稿する」が押せます。<strong>下書き保存</strong>すると本人だけに表示され、パーティーには公開されません。
              <strong>投稿</strong>でパーティーに公開し、アイデアごとのチャットが自動で作成され、投稿で XP を獲得します。
            </>
          )}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          キャンセル
        </Button>
        {!isEdit && (
          <Button type="button" variant="outline" onClick={saveDraft}>
            下書き保存
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!canSave || pending}>
          {isEdit ? (pending ? "保存中…" : "変更を保存") : pending ? "投稿中…" : "投稿する"}
        </Button>
      </ModalFooter>
    </form>
  );
}
