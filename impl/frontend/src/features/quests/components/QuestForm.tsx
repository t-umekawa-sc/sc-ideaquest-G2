"use client";

// SC-11 クエスト作成・編集フォーム（URL 付きモーダル／フルページで共有・C.2/C.3/C.4 に接続）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-11_クエスト作成編集.html（DoD＝モック一致）。
// 実接続:
//  - 作成: グループ/候補フェッチ→ POST /quests（下書き=draft／作成=recruiting=即公開）→ アイコン PUT（2段・論点2）。
//  - 編集: GET /quests/{id} でプリフィル→ PATCH /quests/{id}（下書き保存/保存）／POST publish（下書きの公開）。
//    quest_group_id は不変（C.2）＝編集ではグループ選択を固定表示。完了クエストは書き込み凍結（編集不可）。
// 入力検証はデザイン標準 §4.7（インライン aria-invalid＋上部サマリ・送信時＋blur・フォーカス移動しない）。
// 権限キーは UI（manage/eval/vote/idea/comment）⇔ API（quest_admin/evaluator/vote/idea_create/comment）で写像。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button, Field, FormFooterError, FormSummary, ModalBody, ModalFooter, Multiselect, Swatches, useFormErrorNotice, useSnackbar, type MultiselectOption } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { mapServerErrors, t, type FieldErrors, type Locale } from "@/lib/forms/validation";
import { readDuplicatePrefill } from "@/lib/forms/duplicate";
import {
  createQuest,
  deleteQuestIcon,
  getQuest,
  listCompanyGroupDirectory,
  listQuestGroupCandidates,
  listQuestGroups,
  publishQuest,
  setQuestIcon,
  updateQuest,
  type QuestCandidate,
  type QuestGroup,
  type QuestMemberInput,
} from "../api";
import "@/features/companies/companies.css";
import "../quests.css";

const CATEGORY_SUGGESTIONS = ["業務改善", "新規事業", "コスト削減", "顧客体験", "働き方"];
const DEFAULT_COLOR = "#0D9488";

type PermKey = "manage" | "eval" | "vote" | "idea" | "comment";
const PERM_LABELS: [PermKey, string][] = [
  ["manage", "クエスト管理"],
  ["eval", "評価者"],
  ["vote", "投票"],
  ["idea", "作成"],
  ["comment", "コメント"],
];
const PERM_UI_TO_API: Record<PermKey, string> = {
  manage: "quest_admin",
  eval: "evaluator",
  vote: "vote",
  idea: "idea_create",
  comment: "comment",
};
const PERM_API_TO_UI: Record<string, PermKey> = {
  quest_admin: "manage",
  evaluator: "eval",
  vote: "vote",
  idea_create: "idea",
  comment: "comment",
};
const defaultPerms = (): Record<PermKey, boolean> => ({ manage: false, eval: false, vote: true, idea: true, comment: true });
function permsFromApi(perms: string[]): Record<PermKey, boolean> {
  const base: Record<PermKey, boolean> = { manage: false, eval: false, vote: false, idea: false, comment: false };
  for (const p of perms) {
    const k = PERM_API_TO_UI[p];
    if (k) base[k] = true;
  }
  return base;
}

type Member = { userId: string; name: string; ini: string; perms: Record<PermKey, boolean> };

type Props = {
  mode?: "create" | "edit";
  questId?: string; // edit で必須
  ownerName: string; // 作成=session ユーザー／編集=取得した owner で上書き
  ownerUserId: string | null; // 候補の自己除外（C.4）
  locale?: Locale;
  onDone: () => void;
  onCancel: () => void;
};

export function QuestForm({ mode = "create", questId, ownerName, ownerUserId, locale = "ja", onDone, onCancel }: Props) {
  const isEdit = mode === "edit";
  const snack = useSnackbar();
  const { summaryRef, notify } = useFormErrorNotice();

  const msg = useMemo(
    () =>
      locale === "en"
        ? {
            title: "Title is required.",
            quest_group_id: "Select a valid quest group.",
            categories: "Add at least one category.",
            deadline: "Deadline is required.",
            purpose: "Purpose/theme is required.",
            user_id: "This member is not a candidate of the group.",
            permissions: "Invalid permission selection.",
            color: "Invalid color.",
          }
        : {
            title: "件名は必須です。",
            quest_group_id: "有効なクエストグループを選択してください。",
            categories: "カテゴリーを1つ以上指定してください。",
            deadline: "期限日は必須です。",
            purpose: "目的・テーマは必須です。",
            user_id: "候補にないメンバーは追加できません。",
            permissions: "権限の指定が不正です。",
            color: "カラーの指定が不正です。",
          },
    [locale],
  );

  // 複製（作成モードのみ）＝選択クエストの内容を引き継いで追加ダイアログを開く（デザイン標準 §4.5 複製）。
  // id・status（→draft）・アイコン画像・パーティー編成は引き継がない（一意/サーバー採番/関係データ）。
  const searchParams = useSearchParams();
  const dup = useMemo(
    () =>
      isEdit
        ? null
        : readDuplicatePrefill<{
            title?: string;
            color?: string;
            categories?: string[];
            purpose?: string;
            quest_group_id?: string;
            deadline?: string;
          }>(searchParams),
    [isEdit, searchParams],
  );

  const [color, setColor] = useState(dup?.color || DEFAULT_COLOR);
  const [iconPreview, setIconPreview] = useState<string | null>(null); // ローカル選択のプレビュー
  const [iconUrl, setIconUrl] = useState<string | null>(null); // 既存アイコンの署名URL（編集）
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconRemoved, setIconRemoved] = useState(false); // 既存アイコンを削除する指示
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(dup?.title ?? "");
  const [categories, setCategories] = useState<string[]>(dup?.categories ?? []);
  const [catInput, setCatInput] = useState("");
  const [deadline, setDeadline] = useState(dup?.deadline ?? "");
  const [theme, setTheme] = useState(dup?.purpose ?? "");

  const [groups, setGroups] = useState<QuestGroup[]>([]); // 自分の所属グループ（主グループ選択）
  const [directory, setDirectory] = useState<QuestGroup[]>([]); // 会社内の全部署（追加グループ選択・FR-38）
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupId, setGroupId] = useState(dup?.quest_group_id ?? "");
  const [groupName, setGroupName] = useState(""); // 編集時の固定表示用（主グループ）
  const [extraGroupIds, setExtraGroupIds] = useState<string[]>([]); // 追加グループ（複数部署横断・FR-38）
  const [extraGroupNames, setExtraGroupNames] = useState<Record<string, string>>({}); // 編集時、自分の所属外グループ名の補完用
  const [candidates, setCandidates] = useState<QuestCandidate[]>([]);
  const [candQuery, setCandQuery] = useState(""); // 候補の絞り込み（表示名部分一致）
  const [members, setMembers] = useState<Member[]>([]);

  const [ownerLabel, setOwnerLabel] = useState(ownerName);
  const [ownerId, setOwnerId] = useState<string | null>(ownerUserId); // 候補除外に使う「作成者」
  const [status, setStatus] = useState<string>("draft"); // 編集時は取得値
  const [loading, setLoading] = useState(isEdit); // 編集はプリフィル取得まで loading
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [pendingKind, setPendingKind] = useState<string | null>(null); // 押下ボタンだけを processing 表示（§13-1）

  const ownerInitial = ownerLabel.trim().charAt(0) || "?";
  const iconChar = name.trim().charAt(0) || "新";
  const frozen = status === "completed"; // 完了は書き込み凍結（編集不可・C.5）

  // 自分の所属グループ（主グループ選択）＋会社内の全部署（追加グループ選択・FR-38）を取得。
  useEffect(() => {
    let alive = true;
    void Promise.all([listQuestGroups(), listCompanyGroupDirectory()])
      .then(([mine, dir]) => {
        if (!alive) return;
        const data = mine?.data ?? [];
        setGroups(data);
        setDirectory(dir?.data ?? []);
        if (!isEdit) setGroupId((cur) => cur || data[0]?.id || ""); // 主グループの既定は作成時のみ
      })
      .catch(() => {})
      .finally(() => alive && setGroupsLoaded(true));
    return () => {
      alive = false;
    };
  }, [isEdit]);

  // 編集モード＝詳細を取得してプリフィル（グループは固定・作成者/メンバー/内容を反映）。
  useEffect(() => {
    if (!isEdit || !questId) return;
    let alive = true;
    void getQuest(questId)
      .then((d) => {
        if (!alive || !d) return;
        setName(d.title);
        setColor(d.color || DEFAULT_COLOR);
        setCategories(d.categories ?? []);
        setDeadline(d.deadline ?? "");
        setTheme(d.purpose ?? "");
        // 参加部署（0..N・すべて同格・FR-38 再設計）。暫定 UI は先頭を代表欄・残りを追加欄に写像（#8 で参加部署の複数選択に一本化予定）。
        const linked = d.quest_groups ?? [];
        setGroupId(linked[0]?.id ?? "");
        setGroupName(linked[0]?.name ?? "");
        setExtraGroupIds(linked.slice(1).map((g) => g.id));
        setExtraGroupNames(Object.fromEntries(linked.map((g) => [g.id, g.name])));
        setStatus(d.status);
        setOwnerLabel(d.owner.display_name);
        setOwnerId(d.owner.user_id);
        setIconUrl(d.icon_image_url ?? null);
        setMembers(
          (d.members ?? [])
            .filter((m) => !m.is_creator)
            .map((m) => ({
              userId: m.user.user_id,
              name: m.user.display_name,
              ini: m.user.display_name.trim().charAt(0) || "?",
              perms: permsFromApi(m.permissions ?? []),
            })),
        );
      })
      .catch(() => alive && setLoadError("クエストの取得に失敗しました。"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [isEdit, questId]);

  // 候補＝関連グループ（主＋追加）のいずれかの有効メンバー。自分＋作成者＋追加済みを exclude（C.4/FR-38）。
  const excludeIds = useMemo(
    () => [ownerUserId, ownerId, ...members.map((m) => m.userId)].filter((x): x is string => !!x),
    [ownerUserId, ownerId, members],
  );
  // 候補フェッチ対象＝主＋追加グループ（重複除去）。
  const candidateGroupIds = useMemo(
    () => Array.from(new Set([groupId, ...extraGroupIds].filter(Boolean))),
    [groupId, extraGroupIds],
  );
  const candGroupsKey = candidateGroupIds.join(",");
  useEffect(() => {
    if (candidateGroupIds.length === 0 || frozen) {
      setCandidates([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void listQuestGroupCandidates(candidateGroupIds, { exclude_user_ids: excludeIds, q: candQuery || undefined, limit: 100 })
        .then((res) => alive && setCandidates(res?.data ?? []))
        .catch(() => alive && setCandidates([]));
    }, candQuery ? 200 : 0); // 検索語入力は軽くデバウンス
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candGroupsKey, excludeIds, frozen, candQuery]);

  // 追加グループの選択肢＝会社ディレクトリから主グループを除く（候補のみの複数選択・FR-38）。
  const extraGroupOptions = useMemo<MultiselectOption[]>(
    () => directory.filter((g) => g.id !== groupId).map((g) => ({ value: g.id, label: g.name })),
    [directory, groupId],
  );

  // グループ id → 表示名（追加グループのチップ／候補の部署バッジ）。会社ディレクトリ＋自分の所属＋編集時の補完名。
  const groupNameById = useMemo(() => {
    const map: Record<string, string> = { ...extraGroupNames };
    for (const g of directory) map[g.id] = g.name;
    for (const g of groups) map[g.id] = g.name;
    if (groupId && groupName) map[groupId] = groupName;
    return map;
  }, [groups, directory, extraGroupNames, groupId, groupName]);

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
    if (iconUrl) setIconRemoved(true); // 既存アイコンがあった＝保存時に削除する
    setIconUrl(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  }

  function addCategory(v: string) {
    const label = v.trim();
    if (label && !categories.includes(label)) setCategories((c) => [...c, label]);
    setCatInput("");
  }
  function onCatKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addCategory(catInput);
    }
  }

  function onGroupChange(next: string) {
    setGroupId(next);
    setMembers([]); // グループが変わると候補が変わる＝既存の追加メンバーは無効（C.4）。クリアして選び直す。
  }

  function addMember(c: QuestCandidate) {
    setMembers((m) => [...m, { userId: c.user_id, name: c.display_name, ini: c.display_name.trim().charAt(0) || "?", perms: defaultPerms() }]);
  }
  function addAllCandidates() {
    setMembers((m) => {
      const have = new Set(m.map((x) => x.userId));
      const add = candidates
        .filter((c) => !have.has(c.user_id))
        .map((c) => ({ userId: c.user_id, name: c.display_name, ini: c.display_name.trim().charAt(0) || "?", perms: defaultPerms() }));
      return [...m, ...add];
    });
  }
  function removeMember(userId: string) {
    setMembers((m) => m.filter((x) => x.userId !== userId));
  }
  function togglePerm(userId: string, key: PermKey) {
    setMembers((m) => m.map((x) => (x.userId === userId ? { ...x, perms: { ...x.perms, [key]: !x.perms[key] } } : x)));
  }

  const validate = useCallback(
    (forPublish: boolean): FieldErrors => {
      const e: FieldErrors = {};
      if (!name.trim()) e.title = msg.title;
      if (!groupId) e.quest_group_id = msg.quest_group_id;
      if (forPublish) {
        if (categories.length === 0) e.categories = msg.categories;
        if (!deadline) e.deadline = msg.deadline;
        if (!theme.trim()) e.purpose = msg.purpose;
      }
      return e;
    },
    [name, groupId, categories, deadline, theme, msg],
  );

  function onBlurField(field: "title" | "quest_group_id") {
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (field === "title") {
        if (!name.trim()) next.title = msg.title;
        else delete next.title;
      } else if (field === "quest_group_id") {
        if (!groupId) next.quest_group_id = msg.quest_group_id;
        else delete next.quest_group_id;
      }
      return next;
    });
  }

  function buildMembers(): QuestMemberInput[] {
    return members.map((m) => ({
      user_id: m.userId,
      permissions: (Object.keys(PERM_UI_TO_API) as PermKey[]).filter((k) => m.perms[k]).map((k) => PERM_UI_TO_API[k]),
    }));
  }

  // 内容 payload（作成/編集/公開で共有）。
  function contentPayload() {
    return {
      title: name.trim(),
      color,
      categories,
      deadline: deadline || null,
      purpose: theme.trim() || null,
      members: buildMembers(),
    };
  }

  // アイコンの反映（本体成功後の 2段・論点2）。作成は new id、編集は questId。
  async function applyIcon(id: string) {
    if (iconFile) await setQuestIcon(id, iconFile);
    else if (iconRemoved) await deleteQuestIcon(id);
  }

  type SaveKind = "create-draft" | "create-publish" | "edit-save" | "edit-publish";
  async function persist(kind: SaveKind) {
    const forPublish = kind === "create-publish" || kind === "edit-publish" || (kind === "edit-save" && status !== "draft");
    const clientErrors = validate(forPublish);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      const list = Object.values(clientErrors);
      setSummary(list); // 上部サマリ＝インラインと同文言（§4.7・フォーカス移動なし）
      notify(list); // スクロール＋エラースナックバー（§4.7）
      return;
    }
    setFieldErrors({});
    setSummary([]);
    setPending(true);
    setPendingKind(kind);
    try {
      if (kind === "create-draft" || kind === "create-publish") {
        const created = await createQuest({
          ...contentPayload(),
          // 参加部署（フラット 0..N・すべて同格・FR-38 再設計）＝代表欄＋追加欄の和集合。空も可（0 件＝全社）。
          quest_group_ids: [...new Set([groupId, ...extraGroupIds].filter(Boolean))],
          status: kind === "create-publish" ? "recruiting" : "draft",
        });
        if (created) await applyIcon(created.id);
      } else if (kind === "edit-save") {
        await updateQuest(questId!, {
          ...contentPayload(),
          quest_group_ids: [...new Set([groupId, ...extraGroupIds].filter(Boolean))],
        });
        await applyIcon(questId!);
      } else {
        // edit-publish（draft→recruiting）＝関連グループの差分を先に反映してから公開。
        await updateQuest(questId!, { quest_group_ids: extraGroupIds });
        await publishQuest(questId!, contentPayload());
        await applyIcon(questId!);
      }
      if (iconPreview) URL.revokeObjectURL(iconPreview);
      const doneTitle =
        kind === "create-draft" ? "下書きを保存しました"
        : kind === "create-publish" ? "クエストを作成・公開しました"
        : kind === "edit-publish" ? "クエストを公開しました"
        : "クエストを保存しました";
      snack({ type: "success", title: doneTitle });
      onDone();
    } catch (err) {
      // 追加グループ除外で孤立するパーティー員がいる（409 group_in_use・FR-38）＝分かりやすい文言を出す。
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { errors?: { reason?: string; user_ids?: string[] }[] } | null;
        const orphan = body?.errors?.find((e) => e.reason === "group_in_use");
        if (orphan) {
          const names = (orphan.user_ids ?? []).map((id) => members.find((m) => m.userId === id)?.name ?? id);
          const line = `外そうとしたグループにしか所属していないメンバーがいます（${names.join("、")}）。先にパーティーから外すか、グループを残してください。`;
          setSummary([line]);
          notify([line]);
          return;
        }
      }
      const mapped = mapServerErrors(err, locale, {
        title: msg.title,
        color: msg.color,
        categories: msg.categories,
        quest_group_id: msg.quest_group_id,
        user_id: msg.user_id,
        permissions: msg.permissions,
      });
      setFieldErrors(mapped.fieldErrors);
      setSummary(mapped.summary);
      notify(mapped.summary);
    } finally {
      setPending(false);
      setPendingKind(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 送信（Enter/主ボタン）＝作成は公開、編集の下書きは公開、編集の公開中は保存。
    if (!isEdit) void persist("create-publish");
    else if (status === "draft") void persist("edit-publish");
    else void persist("edit-save");
  }

  const noGroups = !isEdit && groupsLoaded && groups.length === 0;

  if (loading) {
    return (
      <ModalBody>
        <p className="admin-muted">読み込み中…</p>
      </ModalBody>
    );
  }
  if (loadError) {
    return (
      <>
        <ModalBody>
          <div className="form-error" role="alert">{loadError}</div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onCancel}>閉じる</Button>
        </ModalFooter>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody>
        <p className="role-note" style={{ marginTop: 0 }}>
          <strong>作成</strong>は認証済みなら誰でも（作成者＝所有者）。<strong>編集</strong>は所有者・クエスト管理権限者のみ。
        </p>

        <FormSummary title={t(locale, "summary.title")} errors={summary} innerRef={summaryRef} />

        {noGroups && (
          <p className="role-note" role="alert">
            参加中のクエストグループがありません。管理者にグループへの追加を依頼してください（クエストはグループに属します）。
          </p>
        )}
        {frozen && (
          <p className="role-note" role="alert">
            このクエストは<strong>完了</strong>しているため編集できません（書き込み凍結）。
          </p>
        )}

        <Field id="q_icon" label="クエストアイコン（任意）">
          <div className="icon-field">
            <span className="quest-icon lg" style={{ ["--accent" as string]: color } as React.CSSProperties}>
              {iconPreview || iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="quest-icon__img" src={iconPreview ?? iconUrl ?? ""} alt="" />
              ) : (
                <>
                  <span className="quest-icon__char">{iconChar}</span>
                  <span className="quest-icon__owner placeholder">{ownerInitial}</span>
                </>
              )}
            </span>
            <div className="icon-actions">
              <Button type="button" variant="outline" onClick={() => iconInputRef.current?.click()} disabled={frozen}>画像をアップロード</Button>
              {(iconPreview || iconUrl) && <Button type="button" variant="outline" onClick={onClearIcon} disabled={frozen}>未設定に戻す</Button>}
              <input ref={iconInputRef} id="q_icon" type="file" accept="image/*" hidden onChange={onPickIcon} />
              <span className="hint">未設定なら「件名の頭文字＋所有者アバター」を自動表示。</span>
            </div>
          </div>
        </Field>

        <Field id="q_color" label="クエストカラー" required error={fieldErrors.color}>
          <Swatches value={color} onChange={setColor} ariaLabel="クエストカラー" />
        </Field>

        <Field id="q_name" label="件名" required hint="クエストの名前。一覧・詳細・アイコンの頭文字に使われます。" error={fieldErrors.title}>
          <input id="q_name" className="input" placeholder="例: 配送ルート最適化" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onBlurField("title")} aria-invalid={fieldErrors.title ? true : undefined} disabled={frozen} />
        </Field>

        <div className="field-row">
          <Field id="q_cat" label="カテゴリー" required hint="複数選択可。定義済みから選択、なければ入力して Enter で追加。" error={fieldErrors.categories}>
            {categories.length > 0 && (
              <div className="tagselect__chips">
                {categories.map((c) => (
                  <span key={c} className="tagselect__chip">{c}<button type="button" aria-label={`${c} を外す`} onClick={() => setCategories((cs) => cs.filter((x) => x !== c))} disabled={frozen}>✕</button></span>
                ))}
              </div>
            )}
            <input id="q_cat" className="input" role="combobox" aria-expanded={false} placeholder="選択または入力…" value={catInput} onChange={(e) => setCatInput(e.target.value)} onKeyDown={onCatKeyDown} aria-invalid={fieldErrors.categories ? true : undefined} disabled={frozen} />
            <div className="tagselect__sug">
              {CATEGORY_SUGGESTIONS.filter((s) => !categories.includes(s)).map((s) => (
                <button key={s} type="button" className="tagselect__sugbtn" onClick={() => addCategory(s)} disabled={frozen}>＋ {s}</button>
              ))}
            </div>
          </Field>

          <Field id="q_deadline" label="期限日" required hint="アイデア募集/クエストの締切日。" error={fieldErrors.deadline}>
            <input id="q_deadline" className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-invalid={fieldErrors.deadline ? true : undefined} disabled={frozen} />
          </Field>
        </div>

        <Field id="q_theme" label="目的・テーマ" required error={fieldErrors.purpose}>
          <textarea id="q_theme" className="textarea" placeholder="このクエストで何を達成したいか、どんなアイデアを募るか" value={theme} onChange={(e) => setTheme(e.target.value)} aria-invalid={fieldErrors.purpose ? true : undefined} disabled={frozen} />
        </Field>

        <Field id="q_group" label="クエストグループ（主）" required hint={isEdit ? "主グループは作成後は変更できません。" : "クエストが属する主となるグループ（部署）。パーティー候補は関連グループの所属者になります。"} error={fieldErrors.quest_group_id}>
          {isEdit ? (
            // 主グループは不変（C.2）＝固定表示（変更 UI は出さない）。
            <input id="q_group" className="input" value={groupName} readOnly disabled />
          ) : (
            <select id="q_group" className="select" value={groupId} onChange={(e) => onGroupChange(e.target.value)} onBlur={() => onBlurField("quest_group_id")} aria-invalid={fieldErrors.quest_group_id ? true : undefined}>
              {groups.length === 0 && <option value="">（グループがありません）</option>}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
        </Field>

        {/* 追加グループ（複数部署横断・FR-38）。複数部署でひとつのクエストに臨む場合に付与＝候補のみの複数選択。 */}
        {!frozen && (
          <Field id="q_extra_groups" label="追加グループ（他部署・任意）" hint="複数の部署（クエストグループ）で1つのクエストに取り組む場合に追加します。追加した部署の所属者もパーティー候補になります。">
            <Multiselect
              id="q_extra_groups"
              options={extraGroupOptions}
              value={extraGroupIds}
              onChange={setExtraGroupIds}
              placeholder="他部署のグループを検索…"
              ariaLabel="追加グループ（他部署）"
              emptyText="該当する部署がありません"
            />
          </Field>
        )}

        {/* パーティー・権限 */}
        <Field id="q_party" label="参加メンバー（パーティー）・権限" required>
          <div className="party">
            <div className="party__head">
              <strong>メンバーと権限</strong>
              <span className="party__count">{members.length + 1} 名</span>
            </div>
            <div className="party__list">
              <div className="pmember">
                <span className="avatar sm"><span className="avatar__img placeholder">{ownerInitial}</span></span>
                <div className="pmember__main">
                  <div className="pmember__top">
                    <span className="pmember__name">{ownerLabel}</span>
                    <span className="badge badge-muted">{isEdit ? "作成者" : "あなた・作成者"}</span>
                  </div>
                  <div className="pmember__perms">
                    <span className="perm perm-owner is-on" aria-disabled="true" title="作成者は既定で所有者・剥奪不可">所有者</span>
                    {PERM_LABELS.map(([, label]) => (
                      <span key={label} className="perm is-on" aria-disabled="true">{label}</span>
                    ))}
                  </div>
                </div>
              </div>
              {members.map((m) => (
                <div className="pmember" key={m.userId}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{m.ini}</span></span>
                  <div className="pmember__main">
                    <div className="pmember__top">
                      <span className="pmember__name">{m.name}</span>
                    </div>
                    <div className="pmember__perms">
                      {PERM_LABELS.map(([key, label]) => (
                        <span key={key} role="button" tabIndex={frozen ? -1 : 0} className={`perm${m.perms[key] ? " is-on" : ""}`}
                          onClick={() => !frozen && togglePerm(m.userId, key)}
                          onKeyDown={(e) => { if (!frozen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); togglePerm(m.userId, key); } }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!frozen && <button type="button" className="pmember__remove" aria-label={`${m.name} をパーティーから外す`} onClick={() => removeMember(m.userId)}>✕</button>}
                </div>
              ))}
            </div>
            {!frozen && (
              <div className="party__add">
                <div className="party__addhead">
                  <label className="text-sm" style={{ fontWeight: 600 }}>メンバーを追加（関連グループの所属者）</label>
                  {candidates.length > 0 && (
                    <button type="button" className="party__addall" onClick={addAllCandidates}>候補をすべて追加（{candidates.length}）</button>
                  )}
                </div>
                <input
                  className="input"
                  placeholder="名前で絞り込み…"
                  value={candQuery}
                  onChange={(e) => setCandQuery(e.target.value)}
                  aria-label="候補を名前で絞り込み"
                />
                <div className="candlist">
                  {candidates.map((c) => {
                    const depts = (c.group_ids ?? []).map((g) => groupNameById[g]).filter(Boolean);
                    return (
                      <button key={c.user_id} className="cand" type="button" onClick={() => addMember(c)}>
                        <span className="avatar sm"><span className="avatar__img placeholder">{c.display_name.trim().charAt(0) || "?"}</span></span>
                        <span className="cand__name">{c.display_name}</span>
                        {candidateGroupIds.length > 1 && depts.length > 0 && (
                          <span className="cand__depts">{depts.join("・")}</span>
                        )}
                        <span className="cand__plus" aria-hidden>＋</span>
                      </button>
                    );
                  })}
                  {candidateGroupIds.length > 0 && candidates.length === 0 && (
                    <span className="hint">{candQuery ? "一致する候補がいません。" : "追加できる候補がいません（全員追加済み、または他の所属者がいません）。"}</span>
                  )}
                  {candidateGroupIds.length === 0 && <span className="hint">先にクエストグループを選択してください。</span>}
                </div>
                <div className="hint">追加すると既定権限（<strong>投票・アイデア作成・コメント</strong>）が付与されます。評価者/クエスト管理は個別にオン。</div>
              </div>
            )}
          </div>
        </Field>

        <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
          <strong>下書き保存</strong>すると本人だけに表示され、パーティーには公開されません。<strong>作成/公開</strong>で公開し、パーティーに通知します。
        </p>
      </ModalBody>
      <ModalFooter>
        <FormFooterError show={summary.length > 0} />
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>キャンセル</Button>
        {!isEdit ? (
          <>
            <Button type="button" variant="outline" onClick={() => void persist("create-draft")} disabled={pending || noGroups} loading={pendingKind === "create-draft"}>下書き保存</Button>
            <Button type="submit" variant="primary" disabled={pending || noGroups} loading={pendingKind === "create-publish"}>{pendingKind === "create-publish" ? "保存中…" : "クエストを作成"}</Button>
          </>
        ) : status === "draft" ? (
          <>
            <Button type="button" variant="outline" onClick={() => void persist("edit-save")} disabled={pending} loading={pendingKind === "edit-save"}>下書き保存</Button>
            <Button type="submit" variant="primary" disabled={pending} loading={pendingKind === "edit-publish"}>{pendingKind === "edit-publish" ? "公開中…" : "公開する"}</Button>
          </>
        ) : (
          <Button type="submit" variant="primary" disabled={pending || frozen} loading={pendingKind === "edit-save"}>{pendingKind === "edit-save" ? "保存中…" : "保存する"}</Button>
        )}
      </ModalFooter>
    </form>
  );
}
