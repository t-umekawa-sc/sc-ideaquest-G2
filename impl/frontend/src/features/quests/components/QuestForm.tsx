"use client";

// SC-11 クエスト作成フォーム（URL 付きモーダル／フルページで共有・C.2/C.3/C.4 に接続）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-11_クエスト作成編集.html（DoD＝モック一致）。
// 実接続＝グループ/候補はフェッチ（GET /quest-groups・/quest-groups/{id}/members）、保存は POST /quests
// （下書き=status:draft／作成=status:recruiting=即公開）。アイコンは作成後に PUT（2段・論点2）。
// 入力検証はデザイン標準 §4.7（インライン aria-invalid＋上部サマリ・送信時＋blur・フォーカス移動しない）。
// 権限キーは UI（manage/eval/vote/idea/comment）→ API（quest_admin/evaluator/vote/idea_create/comment）へ写像。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Field, FormSummary, ModalBody, ModalFooter, Swatches } from "@/components/ui";
import { mapServerErrors, t, type FieldErrors, type Locale } from "@/lib/forms/validation";
import {
  createQuest,
  listGroupMemberCandidates,
  listQuestGroups,
  setQuestIcon,
  type QuestCandidate,
  type QuestGroup,
  type QuestMemberInput,
} from "../api";
import "@/features/companies/companies.css";
import "../quests.css";

const CATEGORY_SUGGESTIONS = ["業務改善", "新規事業", "コスト削減", "顧客体験", "働き方"];
const DEFAULT_COLOR = "#0D9488";

// UI 権限キー → API 権限（permission_type・C.3）。owner は作成者専用でここには出さない。
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
const defaultPerms = (): Record<PermKey, boolean> => ({ manage: false, eval: false, vote: true, idea: true, comment: true });

type Member = { userId: string; name: string; ini: string; perms: Record<PermKey, boolean> };

type Props = {
  ownerName: string;
  ownerUserId: string | null; // 候補から自分を除外するために使う（C.4 exclude_user_ids）
  locale?: Locale;
  onDone: () => void;
  onCancel: () => void;
};

export function QuestForm({ ownerName, ownerUserId, locale = "ja", onDone, onCancel }: Props) {
  // 検証メッセージ（§4.7・i18n）。UI ラベルはモック準拠 ja のまま、検証文言のみロケール対応。
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
          }
        : {
            title: "件名は必須です。",
            quest_group_id: "有効なクエストグループを選択してください。",
            categories: "カテゴリーを1つ以上指定してください。",
            deadline: "期限日は必須です。",
            purpose: "目的・テーマは必須です。",
            user_id: "候補にないメンバーは追加できません。",
            permissions: "権限の指定が不正です。",
          },
    [locale],
  );

  const [color, setColor] = useState(DEFAULT_COLOR);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [catInput, setCatInput] = useState("");
  const [deadline, setDeadline] = useState("");
  const [theme, setTheme] = useState("");

  const [groups, setGroups] = useState<QuestGroup[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [candidates, setCandidates] = useState<QuestCandidate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const ownerInitial = ownerName.trim().charAt(0) || "?";
  const iconChar = name.trim().charAt(0) || "新";

  // グループ一覧（自分が有効所属・C.4）。既定は先頭。
  useEffect(() => {
    let alive = true;
    void listQuestGroups()
      .then((res) => {
        if (!alive) return;
        const data = res?.data ?? [];
        setGroups(data);
        setGroupId((cur) => cur || data[0]?.id || "");
      })
      .catch(() => {})
      .finally(() => alive && setGroupsLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // 候補（同一グループの有効メンバー・自分＋追加済みを exclude・C.4）。グループ/メンバー変化で取り直す。
  const excludeIds = useMemo(
    () => [ownerUserId, ...members.map((m) => m.userId)].filter((x): x is string => !!x),
    [ownerUserId, members],
  );
  useEffect(() => {
    if (!groupId) {
      setCandidates([]);
      return;
    }
    let alive = true;
    void listGroupMemberCandidates(groupId, { exclude_user_ids: excludeIds, limit: 100 })
      .then((res) => alive && setCandidates(res?.data ?? []))
      .catch(() => alive && setCandidates([]));
    return () => {
      alive = false;
    };
  }, [groupId, excludeIds]);

  function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(URL.createObjectURL(file));
    setIconFile(file);
  }
  function onClearIcon() {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    setIconFile(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  }

  function addCategory(v: string) {
    const t2 = v.trim();
    if (t2 && !categories.includes(t2)) setCategories((c) => [...c, t2]);
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
  function removeMember(userId: string) {
    setMembers((m) => m.filter((x) => x.userId !== userId));
  }
  function togglePerm(userId: string, key: PermKey) {
    setMembers((m) => m.map((x) => (x.userId === userId ? { ...x, perms: { ...x.perms, [key]: !x.perms[key] } } : x)));
  }

  // クライアント検証（§4.7）。forPublish=false（下書き）は最小限（title/group）、true（作成/公開）は必須をすべて。
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

  // blur 検証（§4.7）＝常時必須の title/group のみその場で確認（下書きを妨げないため公開必須項目は送信時に判定）。
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

  async function save(forPublish: boolean) {
    const clientErrors = validate(forPublish);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setSummary(Object.values(clientErrors)); // 上部サマリ＝インラインと同じ文言（§4.7・フォーカス移動しない）
      return;
    }
    setFieldErrors({});
    setSummary([]);
    setPending(true);
    try {
      const created = await createQuest({
        title: name.trim(),
        color,
        quest_group_id: groupId,
        categories,
        deadline: deadline || null,
        purpose: theme.trim() || null,
        members: buildMembers(),
        status: forPublish ? "recruiting" : "draft",
      });
      // アイコンは本体作成後に PUT（2段・論点2）。作成が成功して id が返り、ファイル選択があれば設定。
      if (created && iconFile) await setQuestIcon(created.id, iconFile);
      if (iconPreview) URL.revokeObjectURL(iconPreview);
      onDone();
    } catch (err) {
      const mapped = mapServerErrors(err, locale, {
        title: msg.title,
        color: locale === "en" ? "Invalid color." : "カラーの指定が不正です。",
        categories: msg.categories,
        quest_group_id: msg.quest_group_id,
        user_id: msg.user_id,
        permissions: msg.permissions,
      });
      setFieldErrors(mapped.fieldErrors);
      setSummary(mapped.summary);
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void save(true); // 「クエストを作成」＝公開（recruiting）
  }

  const noGroups = groupsLoaded && groups.length === 0;

  return (
    <form onSubmit={onSubmit} noValidate>
      <ModalBody>
        <p className="role-note" style={{ marginTop: 0 }}>
          <strong>作成</strong>は認証済みなら誰でも（作成者＝所有者）。<strong>編集</strong>は所有者・クエスト管理権限者のみ。
        </p>

        {/* 上部サマリ（§4.7・インライン併用・フォーカス移動なし） */}
        <FormSummary title={t(locale, "summary.title")} errors={summary} />

        {noGroups && (
          <p className="role-note" role="alert">
            参加中のクエストグループがありません。管理者にグループへの追加を依頼してください（クエストはグループに属します）。
          </p>
        )}

        {/* クエストアイコン（任意・作成後に PUT する 2段） */}
        <Field id="q_icon" label="クエストアイコン（任意）">
          <div className="icon-field">
            <span className="quest-icon lg" style={{ ["--accent" as string]: color } as React.CSSProperties}>
              {iconPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="quest-icon__img" src={iconPreview} alt="" />
              ) : (
                <>
                  <span className="quest-icon__char">{iconChar}</span>
                  <span className="quest-icon__owner placeholder">{ownerInitial}</span>
                </>
              )}
            </span>
            <div className="icon-actions">
              <Button type="button" variant="outline" onClick={() => iconInputRef.current?.click()}>画像をアップロード</Button>
              {iconPreview && <Button type="button" variant="outline" onClick={onClearIcon}>未設定に戻す</Button>}
              <input ref={iconInputRef} id="q_icon" type="file" accept="image/*" hidden onChange={onPickIcon} />
              <span className="hint">未設定なら「件名の頭文字＋所有者アバター」を自動表示。</span>
            </div>
          </div>
        </Field>

        <Field id="q_color" label="クエストカラー" required error={fieldErrors.color}>
          <Swatches value={color} onChange={setColor} ariaLabel="クエストカラー" />
        </Field>

        <Field id="q_name" label="件名" required hint="クエストの名前。一覧・詳細・アイコンの頭文字に使われます。" error={fieldErrors.title}>
          <input
            id="q_name"
            className="input"
            placeholder="例: 配送ルート最適化"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onBlurField("title")}
            aria-invalid={fieldErrors.title ? true : undefined}
          />
        </Field>

        <div className="field-row">
          <Field id="q_cat" label="カテゴリー" required hint="複数選択可。定義済みから選択、なければ入力して Enter で追加。" error={fieldErrors.categories}>
            {categories.length > 0 && (
              <div className="tagselect__chips">
                {categories.map((c) => (
                  <span key={c} className="tagselect__chip">{c}<button type="button" aria-label={`${c} を外す`} onClick={() => setCategories((cs) => cs.filter((x) => x !== c))}>✕</button></span>
                ))}
              </div>
            )}
            <input id="q_cat" className="input" role="combobox" aria-expanded={false} placeholder="選択または入力…" value={catInput} onChange={(e) => setCatInput(e.target.value)} onKeyDown={onCatKeyDown} aria-invalid={fieldErrors.categories ? true : undefined} />
            <div className="tagselect__sug">
              {CATEGORY_SUGGESTIONS.filter((s) => !categories.includes(s)).map((s) => (
                <button key={s} type="button" className="tagselect__sugbtn" onClick={() => addCategory(s)}>＋ {s}</button>
              ))}
            </div>
          </Field>

          <Field id="q_deadline" label="期限日" required hint="アイデア募集/クエストの締切日。" error={fieldErrors.deadline}>
            <input id="q_deadline" className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-invalid={fieldErrors.deadline ? true : undefined} />
          </Field>
        </div>

        <Field id="q_theme" label="目的・テーマ" required error={fieldErrors.purpose}>
          <textarea id="q_theme" className="textarea" placeholder="このクエストで何を達成したいか、どんなアイデアを募るか" value={theme} onChange={(e) => setTheme(e.target.value)} aria-invalid={fieldErrors.purpose ? true : undefined} />
        </Field>

        <Field id="q_group" label="クエストグループ" required hint="クエストは1つのグループに属します。パーティー候補は同一グループの所属者に限定されます。" error={fieldErrors.quest_group_id}>
          <select
            id="q_group"
            className="input"
            value={groupId}
            onChange={(e) => onGroupChange(e.target.value)}
            onBlur={() => onBlurField("quest_group_id")}
            aria-invalid={fieldErrors.quest_group_id ? true : undefined}
          >
            {groups.length === 0 && <option value="">（グループがありません）</option>}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </Field>

        {/* パーティー・権限 */}
        <Field id="q_party" label="参加メンバー（パーティー）・権限" required>
          <div className="party">
            <div className="party__head">
              <strong>メンバーと権限</strong>
              <span className="party__count">{members.length + 1} 名</span>
            </div>
            <div className="party__list">
              {/* 作成者（所有者・剥奪不可・削除不可） */}
              <div className="pmember">
                <span className="avatar sm"><span className="avatar__img placeholder">{ownerInitial}</span></span>
                <div className="pmember__main">
                  <div className="pmember__top">
                    <span className="pmember__name">{ownerName}</span>
                    <span className="badge badge-muted">あなた・作成者</span>
                  </div>
                  <div className="pmember__perms">
                    <span className="perm perm-owner is-on" aria-disabled="true" title="作成者は既定で所有者・剥奪不可">所有者</span>
                    {PERM_LABELS.map(([, label]) => (
                      <span key={label} className="perm is-on" aria-disabled="true">{label}</span>
                    ))}
                  </div>
                </div>
              </div>
              {/* 追加メンバー（権限トグル＋削除） */}
              {members.map((m) => (
                <div className="pmember" key={m.userId}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{m.ini}</span></span>
                  <div className="pmember__main">
                    <div className="pmember__top">
                      <span className="pmember__name">{m.name}</span>
                    </div>
                    <div className="pmember__perms">
                      {PERM_LABELS.map(([key, label]) => (
                        <span key={key} role="button" tabIndex={0} className={`perm${m.perms[key] ? " is-on" : ""}`}
                          onClick={() => togglePerm(m.userId, key)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePerm(m.userId, key); } }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="pmember__remove" aria-label={`${m.name} をパーティーから外す`} onClick={() => removeMember(m.userId)}>✕</button>
                </div>
              ))}
            </div>
            {/* 候補からメンバー追加（同一グループの有効メンバー・自分と追加済みは除外済み・C.4） */}
            <div className="party__add">
              <label className="text-sm" style={{ fontWeight: 600 }}>メンバーを追加（同一グループの所属者）</label>
              <div className="candlist">
                {candidates.map((c) => (
                  <button key={c.user_id} className="cand" type="button" onClick={() => addMember(c)}>
                    <span className="avatar sm"><span className="avatar__img placeholder">{c.display_name.trim().charAt(0) || "?"}</span></span>{c.display_name} ＋
                  </button>
                ))}
                {groupId && candidates.length === 0 && <span className="hint">追加できる候補がいません（全員追加済み、またはグループに他の所属者がいません）。</span>}
                {!groupId && <span className="hint">先にクエストグループを選択してください。</span>}
              </div>
              <div className="hint">追加すると既定権限（<strong>投票・アイデア作成・コメント</strong>）が付与されます。評価者/クエスト管理は個別にオン。</div>
            </div>
          </div>
        </Field>

        <p className="role-note" style={{ marginTop: "var(--space-3)" }}>
          <strong>下書き保存</strong>すると本人だけに表示され、パーティーには公開されません。<strong>作成</strong>で公開し、パーティーに通知します。
        </p>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>キャンセル</Button>
        <Button type="button" variant="outline" onClick={() => void save(false)} disabled={pending || noGroups}>下書き保存</Button>
        <Button type="submit" variant="primary" disabled={pending || noGroups}>{pending ? "保存中…" : "クエストを作成"}</Button>
      </ModalFooter>
    </form>
  );
}
