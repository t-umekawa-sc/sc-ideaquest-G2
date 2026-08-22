"use client";

// SC-21 アイデア登録・編集フォーム（登録＝新規／編集＝SC-22 から）。create/edit で共有（DRY）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-21_アイデア登録編集.html・SC-22（編集モーダル）。
// 実接続（D.2）:
//  - 作成: 投稿する＝POST /quests/{id}/ideas（status=published・即公開）／下書き保存＝status=draft（本人のみ）。
//  - 編集: マウント時 GET /ideas/{id} でプリフィル → PATCH /ideas/{id}（差分・版記録＋通知は H no-op）。
// 入力検証はデザイン標準 §4.7（インライン aria-invalid＋上部サマリ・送信時＋blur・フォーカス移動しない）。
// 添付（関連資料）の保存 EP は未実装＝本スライスでは送信しない（UI はモック維持・注記で明示）。投票/フォローは SC-22。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Field, FormFooterError, FormSummary, ModalBody, ModalFooter, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { mapServerErrors, t, type FieldErrors, type Locale } from "@/lib/forms/validation";
import { getQuest, type QuestDetail } from "@/features/quests/api";
import {
  createIdea,
  getIdea,
  IDEAS_CHANGED_EVENT,
  publishIdea,
  updateIdea,
  type IdeaStakeholderInput,
} from "../api";

const STAKE_SUGGESTIONS = ["物流部", "配送委託先", "経営企画部", "情報システム部", "現場ドライバー"];

export type IdeaAttach = { icon: string; name: string; size: string };

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

type Props = {
  mode: "create" | "edit";
  questId?: string; // create で必須（投稿先クエスト）
  ideaId?: string; // edit で必須（対象アイデア）
  locale?: Locale;
  onDone: () => void;
  onCancel: () => void;
};

export function IdeaForm({ mode, questId, ideaId, locale = "ja", onDone, onCancel }: Props) {
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();
  const isEdit = mode === "edit";

  const msg = useMemo(
    () =>
      locale === "en"
        ? { title: "Subject is required.", value: "Value is required.", body: "Idea body is required." }
        : { title: "件名は必須です。", value: "価値は必須です。", body: "アイデア本文は必須です。" },
    [locale],
  );

  const [subject, setSubject] = useState("");
  const [value, setValue] = useState("");
  const [body, setBody] = useState("");
  const [limit, setLimit] = useState("");
  const [stakeholders, setStakeholders] = useState<string[]>([]);
  const [stakeInput, setStakeInput] = useState("");
  const [note, setNote] = useState("");
  const [attachments, setAttachments] = useState<IdeaAttach[]>([]);
  const [over, setOver] = useState(false);
  const [pendingKind, setPendingKind] = useState<null | "draft" | "publish" | "save">(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [notFound, setNotFound] = useState(false);
  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pending = pendingKind !== null;
  const canSave = Boolean(subject.trim() && value.trim() && body.trim());

  // 投稿先クエストの文脈カード（作成時）＝getQuest で取得。取得失敗は非致命（カードを出さない）。
  useEffect(() => {
    if (isEdit || !questId) return;
    let alive = true;
    void getQuest(questId)
      .then((q) => alive && setQuest(q))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isEdit, questId]);

  // 編集＝既存アイデアを id で解決してプリフィル（D.1）。
  useEffect(() => {
    if (!isEdit || !ideaId) return;
    let alive = true;
    void getIdea(ideaId)
      .then((idea) => {
        if (!alive) return;
        if (!idea) {
          setNotFound(true);
        } else {
          setSubject(idea.title);
          setValue(idea.value);
          setBody(idea.body);
          setLimit(idea.time_limit ?? "");
          setStakeholders((idea.stakeholders ?? []).map((s) => s.label));
          setNote(idea.note ?? "");
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isEdit, ideaId]);

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

  // 利害関係者を API 入力へ（候補に無い＝手入力は is_custom=true・§正規化はサーバー）。
  function stakeInputs(): IdeaStakeholderInput[] {
    return stakeholders.map((label) => ({ label, is_custom: !STAKE_SUGGESTIONS.includes(label) }));
  }

  const validate = useCallback((): FieldErrors => {
    const e: FieldErrors = {};
    if (!subject.trim()) e.title = msg.title;
    if (!value.trim()) e.value = msg.value;
    if (!body.trim()) e.body = msg.body;
    return e;
  }, [subject, value, body, msg]);

  function onBlurField(field: "title" | "value" | "body") {
    setFieldErrors((prev) => {
      const next = { ...prev };
      const map = { title: [subject, msg.title], value: [value, msg.value], body: [body, msg.body] } as const;
      const [v, m] = map[field];
      if (!v.trim()) next[field] = m;
      else delete next[field];
      return next;
    });
  }

  async function persist(kind: "draft" | "publish" | "save") {
    // 下書き保存は必須未充足でも可（loose・本人のみ表示）。公開/保存は 3 必須を検証（§4.7）。
    if (kind !== "draft") {
      const clientErrors = validate();
      if (Object.keys(clientErrors).length > 0) {
        setFieldErrors(clientErrors);
        const list = Object.values(clientErrors);
        setSummary(list); // 上部サマリ＝インラインと同文言（フォーカス移動なし）
        notify(list); // スクロール＋エラースナックバー（§4.7）
        return;
      }
    }
    setFieldErrors({});
    setSummary([]);
    setPendingKind(kind);
    try {
      const content = {
        title: subject.trim(),
        value: value.trim(),
        body: body.trim(),
        time_limit: limit || null,
        stakeholders: stakeInputs(),
        note: note.trim() || null,
      };
      if (kind === "save") {
        await updateIdea(ideaId!, content);
      } else if (kind === "draft") {
        await createIdea(questId!, { ...content, status: "draft" });
      } else {
        await createIdea(questId!, { ...content, status: "published" });
      }
      if (typeof window !== "undefined") window.dispatchEvent(new Event(IDEAS_CHANGED_EVENT));
      if (kind === "save") {
        snack({ type: "success", title: "変更を保存しました", msg: "投票者とフォロワーに通知しました。" });
      } else if (kind === "draft") {
        snack({ type: "info", title: "下書きを保存しました", msg: "あなただけに表示されます。" });
      } else {
        snack({ type: "reward", title: "アイデアを投稿しました", msg: "パーティーに公開しました。", rewards: [{ k: "xp", t: "＋50 XP" }] });
      }
      onDone();
    } catch (err) {
      const mapped = mapServerErrors(err, locale, { title: msg.title, value: msg.value, body: msg.body });
      setFieldErrors(mapped.fieldErrors);
      setSummary(mapped.summary);
      notify(mapped.summary);
    } finally {
      setPendingKind(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 送信（Enter/主ボタン）＝作成は公開、編集は保存。
    if (isEdit) void persist("save");
    else void persist("publish");
  }

  if (loading) {
    return (
      <ModalBody>
        <p className="admin-muted">読み込み中…</p>
      </ModalBody>
    );
  }
  if (notFound) {
    return (
      <>
        <ModalBody>
          <div className="form-error" role="alert">対象のアイデアが見つかりませんでした。</div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            閉じる
          </Button>
        </ModalFooter>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody>
        <FormSummary title={t(locale, "summary.title")} errors={summary} innerRef={summaryRef} />

        {/* 投稿先クエストの文脈（作成時・取得できた場合のみ） */}
        {!isEdit && quest && (
          <div className="card" style={{ padding: "var(--space-3) var(--space-4)", marginBottom: "var(--space-4)" }}>
            <div className="text-xs muted">投稿先クエスト</div>
            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <QuestIcon name={quest.title} color={quest.color} imageUrl={quest.icon_image_url ?? undefined} size="sm" />
              {quest.title}
              {quest.categories[0] && <span className="badge badge-muted">{quest.categories[0]}</span>}
            </div>
          </div>
        )}
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
        <Field id="idea_subject" label="件名" required error={fieldErrors.title}>
          <input
            id="idea_subject"
            className="input"
            placeholder="アイデアのタイトル"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => onBlurField("title")}
            aria-invalid={fieldErrors.title ? true : undefined}
            required
          />
        </Field>
        <Field id="idea_value" label="価値" required error={fieldErrors.value}>
          <textarea
            id="idea_value"
            className="textarea"
            style={{ minHeight: 80 }}
            placeholder="このアイデアがもたらす価値・メリット（評価の要になります）"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => onBlurField("value")}
            aria-invalid={fieldErrors.value ? true : undefined}
            required
          />
        </Field>
        <Field id="idea_body" label="アイデア本文" required error={fieldErrors.body}>
          <textarea
            id="idea_body"
            className="textarea"
            style={{ minHeight: 120 }}
            placeholder="どんなアイデアか、内容を説明してください"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => onBlurField("body")}
            aria-invalid={fieldErrors.body ? true : undefined}
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

        {/* 関連資料 添付（任意・複数可）。※保存 EP は後続スライス＝現状は送信しない。 */}
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
          <p className="hint">※ 添付ファイルの保存は準備中です。この画面ではまだ送信されません。</p>
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
        <FormFooterError show={summary.length > 0} />
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          キャンセル
        </Button>
        {!isEdit && (
          <Button type="button" variant="outline" onClick={() => void persist("draft")} disabled={pending} loading={pendingKind === "draft"}>
            下書き保存
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!canSave || pending} loading={pendingKind === "publish" || pendingKind === "save"}>
          {isEdit
            ? pendingKind === "save"
              ? "保存中…"
              : "変更を保存"
            : pendingKind === "publish"
              ? "投稿中…"
              : "投稿する"}
        </Button>
      </ModalFooter>
    </form>
  );
}
