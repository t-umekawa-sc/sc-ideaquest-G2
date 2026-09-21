"use client";

// SC-21 アイデア登録・編集フォーム（登録＝新規／編集＝SC-22 から）。create/edit で共有（DRY）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-21_アイデア登録編集.html・SC-22（編集モーダル）。
// 実接続（D.2）:
//  - 作成: 投稿する＝POST /quests/{id}/ideas（status=published・即公開）／下書き保存＝status=draft（本人のみ）。
//  - 編集: マウント時 GET /ideas/{id} でプリフィル → PATCH /ideas/{id}（差分・版記録＋通知は H no-op）。
// 入力検証はデザイン標準 §4.7（インライン aria-invalid＋上部サマリ・送信時＋blur・フォーカス移動しない）。
// 添付（関連資料・D.3）＝作成/編集の保存成功後に uploadAttachments で送信（id 先行が要るため保存後・§1.10）。投票/フォローは SC-22。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Field, FormFooterError, FormSummary, ModalBody, ModalFooter, useFormErrorNotice, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { ApiError } from "@/lib/api/client";
import { mapServerErrors, t, type FieldErrors, type Locale } from "@/lib/forms/validation";
import { getQuest, type QuestDetail } from "@/features/quests/api";
import {
  createIdea,
  deleteAttachment,
  deleteIdeaIcon,
  getIdea,
  IDEAS_CHANGED_EVENT,
  publishIdea,
  setIdeaIcon,
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
  const [ideaStatus, setIdeaStatus] = useState<string>("published"); // 編集対象の状態（draft/published）＝ボタン出し分け用
  const [removedIds, setRemovedIds] = useState<string[]>([]); // 削除予定にマークした既存添付（保存で確定・追加と同じくステージ方式）
  const [over, setOver] = useState(false);
  // アイデア個別アイコン（Phase 3）＝2段（本体保存→PUT /ideas/{id}/icon-image）。iconUrl は「このアイデア個別のみ」（own_icon_image_url）。
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconRemoved, setIconRemoved] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<null | "draft" | "publish" | "save">(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [notFound, setNotFound] = useState(false);
  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 編集開始時の内容（空更新＝無変更保存で版を増やさない判定用）。stakeholders はラベルを  連結で比較。
  const originalRef = useRef<{ title: string; value: string; body: string; time_limit: string; note: string; stakeholders: string } | null>(null);

  const pending = pendingKind !== null;
  // 送信ボタンは常に押せる＝押下時に検証（§4.7 上部サマリ＋インライン）で不足を伝える（評価/クエストと統一・
  // 旧「必須が揃うまで disabled」は §4.7 逸脱でユーザー指摘）。
  // 下書きアイデアの編集＝作成と同じく「下書き保存」「投稿する」を出す（公開中の編集は「変更を保存」）。
  const isDraft = isEdit && ideaStatus === "draft";

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
          setIdeaStatus(idea.status ?? "published"); // 下書き/公開でボタンを出し分け
          setRemovedIds([]); // 削除予定マークは読み込みでリセット
          originalRef.current = {  // 無変更保存の検出用に編集開始時の内容を保持
            title: idea.title, value: idea.value, body: idea.body,
            time_limit: idea.time_limit ?? "", note: idea.note ?? "",
            stakeholders: (idea.stakeholders ?? []).map((s) => s.label).join("\n"),
          };
          setIconUrl(idea.own_icon_image_url ?? null); // このアイデア個別のアイコン（既定は含めない・Phase 3）
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

  function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(URL.createObjectURL(file));
    setIconFile(file);
    setIconRemoved(false);
  }
  function onClearIcon() {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    setIconFile(null);
    if (iconUrl) setIconRemoved(true); // 既存の個別アイコンがあった＝保存時に削除（作成者既定/件名タイルに戻す）
    setIconUrl(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  }

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
  // 既存添付の削除は「保存で確定」のステージ方式（新規添付の追加と挙動を揃える）。
  // × で削除予定にマーク／「元に戻す」で解除。実際の削除は保存時に適用（キャンセルなら無変更）。
  function toggleRemoveExisting(att: IdeaAttachment) {
    setRemovedIds((cur) => (cur.includes(att.id) ? cur.filter((x) => x !== att.id) : [...cur, att.id]));
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
      let publishXp = 0;  // #8: 初回公開で実際に付与された投稿 XP（server の xp_delta・金額の正はサーバー）
      const files = attachments.map((a) => a.file);
      let attachmentsUploaded = false;
      // 作成は先に id を採番（添付は id 先行が要る）。編集の内容更新（updateIdea）は添付適用の「後」に回す
      // ＝公開中は保存で1版記録するため、添付の追加/削除を版スナップショット/差分に反映させる（D.4）。
      if (kind === "draft" && isEdit) {
        targetId = ideaId;  // 下書きの編集＝既存アイデアを更新（updateIdea は添付適用の後・版なし/通知なし D.2）
      } else if (kind === "draft") {
        const created = await createIdea(questId!, { ...content, status: "draft" });
        targetId = created?.id ?? undefined;
      } else if (kind === "publish" && isEdit) {
        targetId = ideaId;  // 既存下書きの公開（publishIdea は添付適用の後で content ごと確定）
      } else if (kind === "publish") {
        if (files.length > 0) {
          // 作成時の添付を初版(rev1)に載せるため draft作成→添付→公開の順（publish 時にスナップショットへ取り込む・D.4）
          // ＝更新履歴の初版が正しく「添付あり」になり、後続版の差分が (なし)→全件 に誤表示されない。
          const draft = await createIdea(questId!, { ...content, status: "draft" });
          targetId = draft?.id ?? undefined;
          if (targetId) {
            try {
              await uploadAttachments(targetId, files);
              attachmentsUploaded = true;
            } catch {
              snack({ type: "error", msg: "一部の添付をアップロードできませんでした（サイズ/形式/件数をご確認ください）。" });
            }
          }
          const pub = targetId ? await publishIdea(targetId, {}) : null;
          publishXp = pub?.xp_delta ?? 0;
        } else {
          const created = await createIdea(questId!, { ...content, status: "published" });
          targetId = created?.id ?? undefined;
          publishXp = created?.xp_delta ?? 0;
        }
      }
      // 添付の追加（アップロード）＝保存/公開で確定（D.3）。公開時に先行アップロード済みならスキップ。検証エラー等は非致命。
      if (targetId && files.length > 0 && !attachmentsUploaded) {
        try {
          await uploadAttachments(targetId, files);
        } catch {
          snack({ type: "error", msg: "一部の添付をアップロードできませんでした（サイズ/形式/件数をご確認ください）。" });
        }
      }
      // 削除予定の既存添付を確定（追加と同じくステージ→保存で反映・キャンセルなら無変更・D.3）。
      if (targetId && removedIds.length > 0) {
        let removeFailed = false;
        for (const id of removedIds) {
          try {
            await deleteAttachment(targetId, id);
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 404)) removeFailed = true;  // 既に無い(404)は成功扱い
          }
        }
        if (removeFailed) snack({ type: "error", msg: "一部の添付を削除できませんでした。時間をおいて再度お試しください。" });
      }
      // 実際に変わったか＝本文いずれか or 添付（追加/削除）。無変更保存では版を作らない（空更新で版を進めない）。
      const o = originalRef.current;
      const contentChanged = !o || (
        content.title !== o.title || content.value !== o.value || content.body !== o.body ||
        (content.time_limit ?? "") !== o.time_limit || (content.note ?? "") !== o.note ||
        stakeholders.join("\n") !== o.stakeholders
      );
      const attachmentsChanged = files.length > 0 || removedIds.length > 0;
      // 編集の保存＝内容更新（公開中は版記録）。添付適用の「後」に呼ぶことで版差分に添付変更が載る（D.4）。
      // 内容も添付も無変更なら updateIdea を呼ばない＝空の版を作らない。
      if ((kind === "save" || (kind === "draft" && isEdit)) && (contentChanged || attachmentsChanged)) {
        await updateIdea(ideaId!, content);  // 下書きの編集は status 不変＝版なし/通知なし（D.2）
      }
      if (kind === "publish" && isEdit) {
        const pub = await publishIdea(ideaId!, content);  // draft→published＋内容確定（アトミック・D.2）
        publishXp = pub?.xp_delta ?? 0;
      }
      // アイデア個別アイコン（Phase 3）＝id 先行が必要なので保存後に送信（非致命）。設定→PUT／解除→DELETE。
      if (targetId) {
        try {
          if (iconFile) await setIdeaIcon(targetId, iconFile);
          else if (iconRemoved) await deleteIdeaIcon(targetId);
        } catch {
          snack({ type: "error", msg: "アイコンを保存できませんでした（サイズ/形式をご確認ください）。" });
        }
      }
      const iconChanged = !!iconFile || iconRemoved;
      const changedAnything = kind !== "save" || contentChanged || attachmentsChanged || iconChanged;
      if (changedAnything && typeof window !== "undefined") window.dispatchEvent(new Event(IDEAS_CHANGED_EVENT));
      if (kind === "save") {
        if (contentChanged || attachmentsChanged) {
          snack({ type: "success", title: "変更を保存しました", msg: "投票者とフォロワーに通知しました。" });
        } else if (iconChanged) {
          snack({ type: "success", title: "変更を保存しました" });
        } else {
          snack({ type: "info", title: "変更はありません", msg: "内容・添付とも変更がなかったため、版は増やしていません。" });
        }
      } else if (kind === "draft") {
        snack({ type: "info", title: "下書きを保存しました", msg: "あなただけに表示されます。" });
      } else if (publishXp > 0) {
        // 実際に付与された額を表示（金額の正はサーバー・#8）。冪等等で 0 の時は素の成功表示。
        snack({ type: "reward", title: "アイデアを投稿しました", msg: "パーティーに公開しました。", rewards: [{ k: "xp", t: `＋${publishXp} XP` }] });
      } else {
        snack({ type: "success", title: "アイデアを投稿しました", msg: "パーティーに公開しました。" });
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
    // 送信（Enter/主ボタン）＝公開中の編集は保存（版記録）、作成・下書きの編集は公開（投稿する）。
    if (isEdit && !isDraft) void persist("save");
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

        {/* 投稿先クエストの文脈（作成時・取得できた場合のみ）＝囲みなし（§4.1・旧 .card 枠を撤去）。 */}
        {!isEdit && quest && (
          <div style={{ marginBottom: "var(--space-3)" }}>
            <div className="text-xs muted">投稿先クエスト</div>
            <div className="dialog-subject" style={{ gap: "var(--space-2)" }}>
              <QuestIcon name={quest.title} color={quest.color} imageUrl={quest.icon_image_url ?? undefined} size="sm" />
              <span style={{ fontWeight: 700 }}>{quest.title}</span>
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

        {/* 必須 3 項目。件名の上にも仕切り線＝ヘッダー（投稿先クエスト＋説明）と入力項目を区切る（ユーザー要望）。 */}
        <Field className="dialog-section is-quiet" id="idea_subject" label="件名" required error={fieldErrors.title}>
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
        <Field className="dialog-section is-quiet" id="idea_icon" label="アイデアアイコン（任意）">
          <div className="icon-field">
            {iconPreview || iconUrl ? (
              <span className="quest-icon lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="quest-icon__img" src={iconPreview ?? iconUrl ?? ""} alt="" />
              </span>
            ) : (
              // 未設定＝件名先頭1文字タイル（クエスト色）。実表示は「個別→作成者の既定→このタイル」の順に解決。
              <QuestIcon name={subject || "案"} color={quest?.color} size="lg" />
            )}
            <div className="icon-actions">
              <Button type="button" variant="outline" onClick={() => iconInputRef.current?.click()}>画像をアップロード</Button>
              {(iconPreview || iconUrl) && <Button type="button" variant="outline" onClick={onClearIcon}>未設定に戻す</Button>}
              <input ref={iconInputRef} id="idea_icon" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickIcon} />
              <span className="hint">未設定なら「あなたのアイデア用アイコン（プロフィール）→ 件名の先頭1文字＋クエスト色」を自動表示。</span>
            </div>
          </div>
        </Field>
        <Field className="dialog-section is-quiet" id="idea_value" label="価値" required error={fieldErrors.value}>
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
        <Field className="dialog-section is-quiet" id="idea_body" label="アイデア本文" required error={fieldErrors.body}>
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

        {/* 任意項目（登録は投稿ハードルを下げるため閉／編集は既存値があるため開）。入力用の折り畳み＝disclosure 標準（枠＋キャレット・白背景・§4.1）。 */}
        <details className="disclosure" open={isEdit}>
          <summary>任意項目（タイムリミット・利害関係者・備考）</summary>
          <div className="disclosure__body">
            {/* 任意項目の中も項目ごとに区切る（ユーザー判断）＝タイムリミット/利害関係者は横並びをやめ1行ずつ＋各項目間に仕切り線。 */}
            <Field className="dialog-section is-quiet" id="idea_limit" label="タイムリミット" hint="実施/検討の想定期限。">
              <input id="idea_limit" className="input" type="date" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </Field>
            <Field className="dialog-section is-quiet" id="idea_stake" label="利害関係者" hint="複数選択可。候補に無ければ入力して Enter で追加。">
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
            <Field className="dialog-section is-quiet" id="idea_note" label="備考 / 特記事項">
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

        {/* 関連資料 添付（任意・複数可）。他項目と同じ間隔（.dialog-section）＋線なし（is-quiet）＝直前の「任意項目」枠と等間隔にならないよう離す（線は二重回避で付けない）。 */}
        <Field className="dialog-section is-quiet" id="idea_files" label="関連資料（任意・複数可）">
          {/* 保存済みの添付（編集モードのみ・D.3）＝× で削除予定にマーク（保存で確定・版を生まない）。追加と同じくステージ方式。 */}
          {isEdit && existingAttachments.length > 0 && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>保存済みの添付（× で削除予定にマーク・<strong>保存で確定</strong>／キャンセルで元に戻ります）</p>
              <div className="attach-list" aria-label="保存済みの添付">
                {existingAttachments.map((a) => {
                  const staged = removedIds.includes(a.id);
                  return (
                    <div className={`attach${staged ? " is-removing" : ""}`} key={a.id}>
                      <span className="attach__icon">{iconFor(a.original_name)}</span>
                      <div className="attach__meta">
                        <div className="attach__name">{a.original_name}</div>
                        <div className="attach__size">{fmtSize(a.size_bytes)}{staged && <span className="attach__flag"> ・削除予定（保存で確定）</span>}</div>
                      </div>
                      <button
                        className="attach__remove"
                        type="button"
                        aria-label={staged ? `${a.original_name} の削除を取り消す` : `${a.original_name} を削除予定にする`}
                        disabled={pending}
                        onClick={() => toggleRemoveExisting(a)}
                      >
                        {staged ? "元に戻す" : "✕"}
                      </button>
                    </div>
                  );
                })}
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
          {isEdit && !isDraft ? (
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
        {(!isEdit || isDraft) && (
          <Button type="button" variant="outline" onClick={() => void persist("draft")} disabled={pending} loading={pendingKind === "draft"}>
            下書き保存
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={pending} loading={pendingKind === "publish" || pendingKind === "save"}>
          {isEdit && !isDraft
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
