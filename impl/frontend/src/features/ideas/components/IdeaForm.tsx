"use client";

// SC-21 アイデア登録・編集フォーム（登録＝新規／編集＝SC-22 から）。create/edit で共有（DRY）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-21_アイデア登録編集.html・SC-22（編集モーダル）。
// 実接続（D.2）:
//  - 作成: 投稿する＝POST /quests/{id}/ideas（status=published・即公開）／下書き保存＝status=draft（本人のみ）。
//  - 編集: マウント時 GET /ideas/{id} でプリフィル → PATCH /ideas/{id}（差分・版記録＋通知は H no-op）。
// 入力検証はデザイン標準 §4.7（インライン aria-invalid＋上部サマリ・送信時＋blur・フォーカス移動しない）。
// 添付（関連資料・D.3）＝作成/編集の保存成功後に uploadAttachments で送信（id 先行が要るため保存後・§1.10）。投票/フォローは SC-22。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Field, FormFooterError, FormSummary, ModalBody, ModalFooter, useConfirm, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { ApiError } from "@/lib/api/client";
import { mapServerErrors, t, type FieldErrors, type Locale } from "@/lib/forms/validation";
import { getQuest, type QuestDetail } from "@/features/quests/api";
import {
  createIdea,
  deleteAttachment,
  getIdea,
  IDEAS_CHANGED_EVENT,
  publishIdea,
  updateIdea,
  uploadAttachments,
  type IdeaAttachment,
  type IdeaStakeholderInput,
} from "../api";

const STAKE_SUGGESTIONS = ["物流部", "配送委託先", "経営企画部", "情報システム部", "現場ドライバー"];

export type IdeaAttach = { icon: string; name: string; size: string; file: File };

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
  const confirm = useConfirm();
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
  const [existingAttachments, setExistingAttachments] = useState<IdeaAttachment[]>([]); // 編集＝保存済みの添付（D.3）
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
          setExistingAttachments(idea.attachments ?? []); // 保存済み添付の管理（D.3・編集）
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
    const next = Array.from(files).map((f) => ({ icon: iconFor(f.name), name: f.name, size: fmtSize(f.size), file: f }));
    setAttachments((a) => [...a, ...next]);
  }

  // 保存済み添付の削除（D.3・編集モード）。添付は本文編集と独立＝即時にサーバー削除（版を生まない・§D.3）。
  // 破壊的操作のため確認ダイアログ→成功でリストから除去＋トースト。完了/権限/不在はサーバー権威で理由提示。
  async function removeExisting(att: IdeaAttachment) {
    if (deletingId || !ideaId) return;
    const ok = await confirm({
      variant: "danger",
      title: "添付を削除",
      msg: `「${att.original_name}」を削除します。この操作は取り消せません。`,
      confirmLabel: "削除する",
    });
    if (!ok) return;
    setDeletingId(att.id);
    try {
      await deleteAttachment(ideaId, att.id);
      setExistingAttachments((cur) => cur.filter((a) => a.id !== att.id));
      snack({ type: "success", msg: "添付を削除しました。" });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      snack({
        type: "error",
        msg:
          status === 409 ? "完了したクエストのアイデアは変更できません。"
          : status === 403 ? "この添付を削除する権限がありません。"
          : status === 404 ? "この添付は見つかりません（すでに削除済みの可能性があります）。"
          : "削除に失敗しました。時間をおいて再度お試しください。",
      });
    } finally {
      setDeletingId(null);
    }
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

  function onBlurField(field: "title" | "value" | "body", e: React.FocusEvent<HTMLElement>) {
    // モーダルの開閉フォーカス制御（dev の StrictMode 二重実行で先頭フィールドが一時 blur→復帰）による
    // 初期表示の誤検証を防ぐ＝**フォーム内の別要素へフォーカスが移った時（タブ移動）だけ**検証する。
    // 開閉churn の blur は relatedTarget がフォーム外（起動ボタン等）なのでスキップされる（§4.7 の blur 検証は維持）。
    const to = e.relatedTarget as Node | null;
    const form = e.currentTarget.closest("form");
    if (!to || !form || !form.contains(to)) return;
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
      let targetId = ideaId;
      if (kind === "save") {
        await updateIdea(ideaId!, content);
      } else if (kind === "draft") {
        const created = await createIdea(questId!, { ...content, status: "draft" });
        targetId = created?.id ?? undefined;
      } else {
        const created = await createIdea(questId!, { ...content, status: "published" });
        targetId = created?.id ?? undefined;
      }
      // 添付は id 先行が必要なため保存成功後に送信（D.3）。検証エラー等は非致命＝本体は保存済み。
      const files = attachments.map((a) => a.file);
      if (targetId && files.length > 0) {
        try {
          await uploadAttachments(targetId, files);
        } catch {
          snack({ type: "error", msg: "一部の添付をアップロードできませんでした（サイズ/形式/件数をご確認ください）。" });
        }
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
            onBlur={(e) => onBlurField("title", e)}
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
            onBlur={(e) => onBlurField("value", e)}
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
            onBlur={(e) => onBlurField("body", e)}
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

        {/* 関連資料 添付（任意・複数可）。新規＝保存成功後にアップロード（D.3）／編集＝保存済みは即時削除可。 */}
        <Field id="idea_files" label="関連資料（任意・複数可）">
          {/* 保存済みの添付（編集モードのみ・D.3）＝× で即時サーバー削除（本文編集と独立・版を生まない）。 */}
          {isEdit && existingAttachments.length > 0 && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>保存済みの添付（× で削除・すぐに反映されます）</p>
              <div className="attach-list" aria-label="保存済みの添付">
                {existingAttachments.map((a) => (
                  <div className="attach" key={a.id}>
                    <span className="attach__icon">{iconFor(a.original_name)}</span>
                    <div className="attach__meta">
                      <div className="attach__name">{a.original_name}</div>
                      <div className="attach__size">{fmtSize(a.size_bytes)}</div>
                    </div>
                    <button
                      className="attach__remove"
                      type="button"
                      aria-label={`${a.original_name} を削除`}
                      disabled={deletingId === a.id || pending}
                      onClick={() => void removeExisting(a)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
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
          <p className="hint">※ 1ファイル20MB・1アイデア10件まで（画像/PDF/Office/テキスト/zip）。保存時にアップロードします。</p>
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
