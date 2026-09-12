"use client";

// SC-11 クエスト作成・編集フォーム（URL 付きモーダル／フルページで共有・C.2/C.3/C.4 に接続）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-11_クエスト作成編集.html（DoD＝モック一致）。
// FR-38 再設計（2026-09-12）＝参加部署＝アクセス条件（フラット 0..N・すべて同格・主グループ廃止）。
//  - 参加部署は会社ディレクトリから単一の複数選択（0 件も可＝全社がアクセス可・候補）。
//  - パーティー候補＝参加部署の所属者（0 件なら会社全体）。参加部署外の名指しメンバーは in_scope=false＝失効表示。
//  - 409 group_in_use は廃止（外すのはブロックしない＝失効で表現）。
// 入力検証はデザイン標準 §4.7（インライン aria-invalid＋上部サマリ・送信時＋blur・フォーカス移動しない）。
// 権限キーは UI（manage/eval/vote/idea/comment）⇔ API（quest_admin/evaluator/vote/idea_create/comment）で写像。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button, Field, FormFooterError, FormSummary, ModalBody, ModalFooter, Multiselect, Swatches, useFormErrorNotice, useSnackbar, type MultiselectOption } from "@/components/ui";
import { mapServerErrors, t, type FieldErrors, type Locale } from "@/lib/forms/validation";
import { readDuplicatePrefill } from "@/lib/forms/duplicate";
import {
  createQuest,
  deleteQuestIcon,
  getQuest,
  listCompanyGroupDirectory,
  listQuestGroupCandidates,
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

// inScope=false＝参加部署外＝失効中（このクエストを参照できない・FR-38・C.0）。UI で明示表示する。
type Member = { userId: string; name: string; ini: string; perms: Record<PermKey, boolean>; inScope: boolean };

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
            quest_group_ids: "Select a valid department.",
            categories: "Add at least one category.",
            deadline: "Deadline is required.",
            purpose: "Purpose/theme is required.",
            user_id: "This member is not a candidate.",
            permissions: "Invalid permission selection.",
            color: "Invalid color.",
          }
        : {
            title: "件名は必須です。",
            quest_group_ids: "有効な部署を選択してください。",
            categories: "カテゴリーを1つ以上指定してください。",
            deadline: "期限日は必須です。",
            purpose: "目的・テーマは必須です。",
            user_id: "候補にないメンバーは追加できません。",
            permissions: "権限の指定が不正です。",
            color: "カラーの指定が不正です。",
          },
    [locale],
  );

  // 複製（作成モードのみ）＝選択クエストの内容を引き継ぐ（デザイン標準 §4.5 複製）。
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
            quest_group_ids?: string[];
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

  const [directory, setDirectory] = useState<QuestGroup[]>([]); // 会社内の全部署（参加部署の選択肢・FR-38）
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  // 参加部署（アクセス条件・フラット 0..N・すべて同格）。主グループの概念は無い。
  const [deptIds, setDeptIds] = useState<string[]>(dup?.quest_group_ids ?? []);
  const [deptNamesPrefill, setDeptNamesPrefill] = useState<Record<string, string>>({}); // 編集時、所属外部署名の補完
  const [candidates, setCandidates] = useState<QuestCandidate[]>([]); // 取得済みの候補（ページ累積）
  const [candCursor, setCandCursor] = useState<string | null>(null); // 次ページカーソル（キーセット・C.4）
  const [candHasNext, setCandHasNext] = useState(false);
  const [candLoadingMore, setCandLoadingMore] = useState(false);
  const [candQuery, setCandQuery] = useState(""); // 候補の名前絞り込み（サーバー q）
  const [candGroupFilter, setCandGroupFilter] = useState<string[]>([]); // 参加部署内でのグループ絞込（空＝参加部署全て）
  const [members, setMembers] = useState<Member[]>([]);
  const [selQuery, setSelQuery] = useState(""); // 選択中パーティーの名前絞込
  const [selOutOnly, setSelOutOnly] = useState(false); // 参加部署外（失効中）のみ表示
  const SEL_PAGE = 8;
  const [selShown, setSelShown] = useState(SEL_PAGE);

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

  // 会社内の全部署（参加部署の選択肢・FR-38）を取得。
  useEffect(() => {
    let alive = true;
    void listCompanyGroupDirectory()
      .then((dir) => {
        if (!alive) return;
        setDirectory(dir?.data ?? []);
      })
      .catch(() => {})
      .finally(() => alive && setGroupsLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // 編集モード＝詳細を取得してプリフィル（参加部署・作成者/メンバー/内容を反映）。
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
        // 参加部署（フラット 0..N・すべて同格・FR-38 再設計）。
        const linked = d.quest_groups ?? [];
        setDeptIds(linked.map((g) => g.id));
        setDeptNamesPrefill(Object.fromEntries(linked.map((g) => [g.id, g.name])));
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
              inScope: m.in_scope ?? true,
            })),
        );
      })
      .catch(() => alive && setLoadError("クエストの取得に失敗しました。"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [isEdit, questId]);

  // 候補フェッチの除外＝作成者のみ（安定）。追加済みメンバーは表示側でクライアント除外＝「もっと見る」のページングを維持する。
  const fetchExclude = useMemo(
    () => [ownerUserId, ownerId].filter((x): x is string => !!x),
    [ownerUserId, ownerId],
  );
  const deptKey = deptIds.join(",");
  const candGroupKey = candGroupFilter.join(",");
  // 有効な絞込グループ＝候補内グループ絞込があればそれ、無ければ参加部署全て（0 件なら空＝会社全体・C.4）。
  const effectiveGroupIds = candGroupFilter.length ? candGroupFilter : deptIds;
  const CAND_PAGE = 30; // 候補の1ページ取得件数（keyset・もっと見る）
  useEffect(() => {
    if (frozen) {
      setCandidates([]); setCandCursor(null); setCandHasNext(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void listQuestGroupCandidates(effectiveGroupIds, { exclude_user_ids: fetchExclude, q: candQuery || undefined, limit: CAND_PAGE })
        .then((res) => {
          if (!alive) return;
          setCandidates(res?.data ?? []);
          setCandCursor(res?.page_info?.next_cursor ?? null);
          setCandHasNext(!!res?.page_info?.has_next);
        })
        .catch(() => { if (alive) { setCandidates([]); setCandCursor(null); setCandHasNext(false); } });
    }, candQuery ? 200 : 0); // 検索語入力は軽くデバウンス
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptKey, candGroupKey, frozen, candQuery]);

  async function loadMoreCands() {
    if (!candCursor || candLoadingMore || frozen) return;
    setCandLoadingMore(true);
    try {
      const res = await listQuestGroupCandidates(effectiveGroupIds, { exclude_user_ids: fetchExclude, q: candQuery || undefined, limit: CAND_PAGE, cursor: candCursor });
      setCandidates((cur) => [...cur, ...(res?.data ?? [])]);
      setCandCursor(res?.page_info?.next_cursor ?? null);
      setCandHasNext(!!res?.page_info?.has_next);
    } catch {
      /* 追加読込の失敗は握る（既存分は保持） */
    } finally {
      setCandLoadingMore(false);
    }
  }
  // 表示候補＝取得済みから追加済みメンバーをクライアント除外（ページング維持）。
  const displayedCandidates = useMemo(
    () => candidates.filter((c) => !members.some((m) => m.userId === c.user_id)),
    [candidates, members],
  );
  // 選択中パーティーの絞込（名前／参加部署外＝失効中のみ）＋ページング。
  const filteredMembers = useMemo(
    () => members.filter((m) => (!selQuery.trim() || m.name.includes(selQuery.trim())) && (!selOutOnly || !m.inScope)),
    [members, selQuery, selOutOnly],
  );
  useEffect(() => { setSelShown(SEL_PAGE); }, [selQuery, selOutOnly]);
  const pagedMembers = filteredMembers.slice(0, selShown);
  function bulkRemoveMembers() {
    const ids = new Set(filteredMembers.map((m) => m.userId));
    if (ids.size === 0) return;
    if (ids.size > 1 && !window.confirm(`${ids.size} 名をパーティーから外します。よろしいですか？`)) return;
    setMembers((m) => m.filter((x) => !ids.has(x.userId)));
  }

  // 参加部署の選択肢＝会社ディレクトリ全件（候補のみの複数選択・FR-38）。
  const deptOptions = useMemo<MultiselectOption[]>(
    () => directory.map((g) => ({ value: g.id, label: g.name })),
    [directory],
  );

  // グループ id → 表示名（候補の部署バッジ）。会社ディレクトリ＋編集時の補完名。
  const groupNameById = useMemo(() => {
    const map: Record<string, string> = { ...deptNamesPrefill };
    for (const g of directory) map[g.id] = g.name;
    return map;
  }, [directory, deptNamesPrefill]);

  // 候補内グループ絞込の選択肢＝クエストの参加部署（その範囲内で絞る・2件以上のとき表示）。
  const candGroupOptions = useMemo<MultiselectOption[]>(
    () => deptIds.map((id) => ({ value: id, label: groupNameById[id] ?? id })),
    [deptIds, groupNameById],
  );

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

  function addMember(c: QuestCandidate) {
    // 候補から追加＝現時点で参加部署内（または 0 件で全社）＝in_scope true。
    setMembers((m) => [...m, { userId: c.user_id, name: c.display_name, ini: c.display_name.trim().charAt(0) || "?", perms: defaultPerms(), inScope: true }]);
  }
  function addAllCandidates() {
    // 表示中（取得済み・未追加）の候補を一括追加。件数が多い時は確認（サーバーページングのため「表示中」が対象）。
    if (displayedCandidates.length === 0) return;
    if (displayedCandidates.length > 30 && !window.confirm(`表示中の ${displayedCandidates.length} 名をパーティーに追加します。よろしいですか？`)) return;
    setMembers((m) => {
      const have = new Set(m.map((x) => x.userId));
      const add = displayedCandidates
        .filter((c) => !have.has(c.user_id))
        .map((c) => ({ userId: c.user_id, name: c.display_name, ini: c.display_name.trim().charAt(0) || "?", perms: defaultPerms(), inScope: true }));
      return [...m, ...add];
    });
  }
  function removeMember(userId: string) {
    setMembers((m) => m.filter((x) => x.userId !== userId));
  }
  function togglePerm(userId: string, key: PermKey) {
    setMembers((m) => m.map((x) => (x.userId === userId ? { ...x, perms: { ...x.perms, [key]: !x.perms[key] } } : x)));
  }

  const outOfScopeCount = members.filter((m) => !m.inScope).length; // 参加部署外＝失効中の人数（警告表示）

  const validate = useCallback(
    (forPublish: boolean): FieldErrors => {
      const e: FieldErrors = {};
      if (!name.trim()) e.title = msg.title;
      if (forPublish) {
        if (categories.length === 0) e.categories = msg.categories;
        if (!deadline) e.deadline = msg.deadline;
        if (!theme.trim()) e.purpose = msg.purpose;
      }
      return e;
    },
    [name, categories, deadline, theme, msg],
  );

  function onBlurTitle() {
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (!name.trim()) next.title = msg.title;
      else delete next.title;
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
          quest_group_ids: deptIds, // 参加部署（フラット 0..N・空も可＝全社）
          status: kind === "create-publish" ? "recruiting" : "draft",
        });
        if (created) await applyIcon(created.id);
      } else if (kind === "edit-save") {
        await updateQuest(questId!, { ...contentPayload(), quest_group_ids: deptIds });
        await applyIcon(questId!);
      } else {
        // edit-publish（draft→recruiting）＝参加部署の差分を先に反映してから公開。
        await updateQuest(questId!, { quest_group_ids: deptIds });
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
      const mapped = mapServerErrors(err, locale, {
        title: msg.title,
        color: msg.color,
        categories: msg.categories,
        quest_group_ids: msg.quest_group_ids,
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
          <input id="q_name" className="input" placeholder="例: 配送ルート最適化" value={name} onChange={(e) => setName(e.target.value)} onBlur={onBlurTitle} aria-invalid={fieldErrors.title ? true : undefined} disabled={frozen} />
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

        {/* 参加部署（アクセス条件・フラット 0..N・すべて同格・FR-38 再設計。主グループは廃止）。 */}
        {!frozen && (
          <Field id="q_depts" label="参加部署（アクセス条件・任意）" hint="会社の部署（クエストグループ）を複数選択できます。非作成者はいずれかの参加部署に現在所属していないと参照できません（作成者は別格で常に参照可）。未選択（0件）なら全社がアクセス可＋候補になります。">
            <Multiselect
              id="q_depts"
              options={deptOptions}
              value={deptIds}
              onChange={(v) => { setDeptIds(v); setCandGroupFilter((f) => f.filter((x) => v.includes(x))); }}
              placeholder="部署を検索…（未選択なら全社）"
              ariaLabel="参加部署（アクセス条件）"
              emptyText="該当する部署がありません"
            />
          </Field>
        )}

        {/* パーティー・権限 */}
        <Field id="q_party" label="参加メンバー（パーティー）・権限" required>
          <div className="party">
            {/* 参加クエストグループ（アクセス条件）バナー＝候補の範囲（モック SC-11 と一致）。 */}
            <div className="party__scope">
              <span className="party__scope-label">参加クエストグループ（アクセス条件）:</span>
              {deptIds.length === 0 ? (
                <>
                  <span className="party__scope-all">全社（未指定）</span>
                  <span className="party__scope-note">＝会社全体が候補・アクセス可（作成者は別格）</span>
                </>
              ) : (
                <>
                  {deptIds.map((id) => (
                    <span key={id} className="party__scope-chip">{groupNameById[id] ?? id}</span>
                  ))}
                  <span className="party__scope-note">候補はこのグループの所属者に限定（作成者は別格・グループ外は失効）</span>
                </>
              )}
            </div>

            <div className="party__cols">
              <div className="party__col">
            {/* 候補追加エリア（モック順＝先・左カラム）＝グループ絞込／名前検索／該当をすべて追加／件数／候補／もっと見る。 */}
            {!frozen && (
              <div className="party__add">
                {deptIds.length > 1 && (
                  <div style={{ marginBottom: "var(--space-2)" }}>
                    <Multiselect
                      id="q_cand_group"
                      options={candGroupOptions}
                      value={candGroupFilter}
                      onChange={setCandGroupFilter}
                      placeholder="参加部署内で絞込…（未選択＝参加部署すべて）"
                      ariaLabel="候補を参加部署で絞り込み"
                      emptyText="該当する部署がありません"
                    />
                  </div>
                )}
                <input
                  className="input"
                  placeholder="名前で絞り込み…"
                  value={candQuery}
                  onChange={(e) => setCandQuery(e.target.value)}
                  aria-label="候補を名前で絞り込み"
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
                  <button type="button" className="btn btn-sm btn-outline" disabled={displayedCandidates.length === 0} onClick={addAllCandidates}>表示中を全員追加（{displayedCandidates.length}）</button>
                </div>
                <div className="party__candmeta">候補（表示中）{displayedCandidates.length} 名{candHasNext ? "・さらに候補あり" : ""}</div>
                <div className="candlist">
                  {displayedCandidates.map((c) => {
                    const depts = (c.group_ids ?? []).map((g) => groupNameById[g]).filter(Boolean);
                    return (
                      <button key={c.user_id} className="cand" type="button" onClick={() => addMember(c)}>
                        <span className="avatar sm"><span className="avatar__img placeholder">{c.display_name.trim().charAt(0) || "?"}</span></span>
                        <span className="cand__name">{c.display_name}</span>
                        {deptIds.length > 1 && depts.length > 0 && (
                          <span className="cand__depts">{depts.join("・")}</span>
                        )}
                        <span className="cand__plus" aria-hidden>＋</span>
                      </button>
                    );
                  })}
                  {displayedCandidates.length === 0 && (
                    <span className="hint">{candQuery ? "一致する候補がいません。" : "追加できる候補がいません（全員追加済み、または該当者がいません）。"}</span>
                  )}
                </div>
                {candHasNext && (
                  <button type="button" className="party__addall" style={{ marginTop: "var(--space-2)" }} disabled={candLoadingMore} onClick={() => void loadMoreCands()}>
                    {candLoadingMore ? "読み込み中…" : "もっと見る"}
                  </button>
                )}
                <div className="hint">追加すると既定権限（<strong>投票・アイデア作成・コメント</strong>）が付与されます。評価者/クエスト管理は個別にオン。</div>
              </div>
            )}
              </div>
              <div className="party__col">
            {/* 選択中のパーティー（モック順＝後・右カラム）＝ヘッダ／警告／絞込・まとめて外す／一覧／もっと見る。 */}
            <div className="party__head">
              <strong>選択中のパーティー</strong>
              <span className="party__count">{members.length + 1} 名</span>
            </div>
            {outOfScopeCount > 0 && (
              <p className="role-note" role="status" style={{ marginTop: 0 }}>
                ⚠ 現在の参加部署の構成では<strong>{outOfScopeCount} 名</strong>が参照できません（部署外・失効中）。部署を追加するか、対象メンバーを外してください。
              </p>
            )}
            {!frozen && members.length > 0 && (
              <div className="party__add" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <input className="input" placeholder="選択中を絞り込み（名前）" value={selQuery} onChange={(e) => setSelQuery(e.target.value)} aria-label="選択中のメンバーを名前で絞り込み" />
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <button type="button" className={`btn btn-sm ${selOutOnly ? "btn-danger" : "btn-outline"}`} aria-pressed={selOutOnly} onClick={() => setSelOutOnly((v) => !v)}>部署外・失効中のみ</button>
                  <button type="button" className="btn btn-sm btn-danger" disabled={filteredMembers.length === 0} onClick={bulkRemoveMembers}>
                    {selQuery.trim() || selOutOnly ? `絞り込み対象をまとめて外す（${filteredMembers.length}）` : `すべて外す（${filteredMembers.length}）`}
                  </button>
                </div>
              </div>
            )}
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
              {pagedMembers.map((m) => (
                <div className="pmember" key={m.userId} data-out-of-scope={!m.inScope ? "1" : undefined} style={!m.inScope ? { opacity: 0.62 } : undefined}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{m.ini}</span></span>
                  <div className="pmember__main">
                    <div className="pmember__top">
                      <span className="pmember__name">{m.name}</span>
                      {!m.inScope && <span className="badge badge-danger" title="どの参加部署にも所属していないため、このクエストを参照できません（異動などで失効）">部署外・失効中</span>}
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
            {filteredMembers.length > selShown && (
              <div style={{ padding: "var(--space-2) var(--space-4)" }}>
                <button type="button" className="party__addall" onClick={() => setSelShown((n) => n + SEL_PAGE)}>もっと見る（残り {filteredMembers.length - selShown}）</button>
              </div>
            )}
              </div>
            </div>
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
            <Button type="button" variant="outline" onClick={() => void persist("create-draft")} disabled={pending} loading={pendingKind === "create-draft"}>下書き保存</Button>
            <Button type="submit" variant="primary" disabled={pending} loading={pendingKind === "create-publish"}>{pendingKind === "create-publish" ? "保存中…" : "クエストを作成"}</Button>
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
