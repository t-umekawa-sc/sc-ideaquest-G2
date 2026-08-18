"use client";

// SC-11 クエスト作成・編集フォーム（URL 付きモーダル／フルページで共有）。
// レイアウト/コピー/フィールドの正＝doc/画面設計/mocks/SC-11_クエスト作成編集.html（DoD＝モック一致）。
// クエスト backend は未実装＝フロントエンド実装フロー規約に沿う画面モック先行（デモ・送信は onDone のみ）。
// カテゴリー＝簡易マルチセレクト（定義済み＋自由入力）、パーティー＝権限トグルの編集（作成者＝所有者固定）。
import { useRef, useState } from "react";

import { Button, Field, ModalBody, ModalFooter, Swatches } from "@/components/ui";
import "@/features/companies/companies.css";
import "../quests.css";

const CATEGORY_SUGGESTIONS = ["業務改善", "新規事業", "コスト削減", "顧客体験", "働き方"];
const GROUPS = ["プロダクト開発部", "全社改善プロジェクト", "カスタマーサクセス"];
// 追加候補（デモ・本番は選択グループの所属者に限定＝GET /quest-groups/{id}/members）。
const CANDIDATES = [
  { name: "佐藤 花子", ini: "佐" },
  { name: "鈴木 一郎", ini: "鈴" },
  { name: "田中 みゆき", ini: "田" },
  { name: "高橋 健", ini: "高" },
];
type PermKey = "manage" | "eval" | "vote" | "idea" | "comment";
const PERM_LABELS: [PermKey, string][] = [["manage", "クエスト管理"], ["eval", "評価者"], ["vote", "投票"], ["idea", "作成"], ["comment", "コメント"]];
type Member = { name: string; ini: string; perms: Record<PermKey, boolean> };
const defaultPerms = (): Record<PermKey, boolean> => ({ manage: false, eval: false, vote: true, idea: true, comment: true });

export function QuestForm({ ownerName, onDone, onCancel }: { ownerName: string; onDone: () => void; onCancel: () => void }) {
  const [color, setColor] = useState("#0D9488");
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [catInput, setCatInput] = useState("");
  const [deadline, setDeadline] = useState("");
  const [theme, setTheme] = useState("");
  const [group, setGroup] = useState(GROUPS[0]);
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState(false);

  const ownerInitial = ownerName.trim().charAt(0) || "?";
  const iconChar = name.trim().charAt(0) || "新";
  const addedNames = new Set(members.map((m) => m.name));

  function onPickIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(URL.createObjectURL(file));
  }
  function onClearIcon() {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  }

  function addCategory(v: string) {
    const t = v.trim();
    if (t && !categories.includes(t)) setCategories((c) => [...c, t]);
    setCatInput("");
  }
  function onCatKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); addCategory(catInput); }
  }

  function addMember(c: { name: string; ini: string }) {
    setMembers((m) => [...m, { name: c.name, ini: c.ini, perms: defaultPerms() }]);
  }
  function removeMember(nm: string) {
    setMembers((m) => m.filter((x) => x.name !== nm));
  }
  function togglePerm(nm: string, key: PermKey) {
    setMembers((m) => m.map((x) => (x.name === nm ? { ...x, perms: { ...x.perms, [key]: !x.perms[key] } } : x)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // クエスト backend 未実装＝デモ（送信せず閉じる）。接続時に POST /quests へ差し替え。
    setPending(true);
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate>
      <ModalBody>
        <p className="role-note" style={{ marginTop: 0 }}>
          <strong>作成</strong>は認証済みなら誰でも（作成者＝所有者）。<strong>編集</strong>は所有者・クエスト管理権限者のみ。
        </p>

        {/* クエストアイコン（任意・ローカルプレビュー＝MinIO 待ち） */}
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

        <Field id="q_color" label="クエストカラー" required>
          <Swatches value={color} onChange={setColor} ariaLabel="クエストカラー" />
        </Field>

        <Field id="q_name" label="件名" required hint="クエストの名前。一覧・詳細・アイコンの頭文字に使われます。">
          <input id="q_name" className="input" placeholder="例: 配送ルート最適化" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <div className="field-row">
          {/* カテゴリー（複数選択＝定義済み＋自由入力） */}
          <Field id="q_cat" label="カテゴリー" required hint="複数選択可。定義済みから選択、なければ入力して Enter で追加。">
            {categories.length > 0 && (
              <div className="tagselect__chips">
                {categories.map((c) => (
                  <span key={c} className="tagselect__chip">{c}<button type="button" aria-label={`${c} を外す`} onClick={() => setCategories((cs) => cs.filter((x) => x !== c))}>✕</button></span>
                ))}
              </div>
            )}
            <input id="q_cat" className="input" role="combobox" aria-expanded={false} placeholder="選択または入力…" value={catInput} onChange={(e) => setCatInput(e.target.value)} onKeyDown={onCatKeyDown} />
            <div className="tagselect__sug">
              {CATEGORY_SUGGESTIONS.filter((s) => !categories.includes(s)).map((s) => (
                <button key={s} type="button" className="tagselect__sugbtn" onClick={() => addCategory(s)}>＋ {s}</button>
              ))}
            </div>
          </Field>

          <Field id="q_deadline" label="期限日" required hint="アイデア募集/クエストの締切日。">
            <input id="q_deadline" className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
          </Field>
        </div>

        <Field id="q_theme" label="目的・テーマ" required>
          <textarea id="q_theme" className="textarea" placeholder="このクエストで何を達成したいか、どんなアイデアを募るか" value={theme} onChange={(e) => setTheme(e.target.value)} required />
        </Field>

        <Field id="q_group" label="クエストグループ" required hint="クエストは1つのグループに属します。パーティー候補は同一グループの所属者に限定されます。">
          <select id="q_group" className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
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
                <div className="pmember" key={m.name}>
                  <span className="avatar sm"><span className="avatar__img placeholder">{m.ini}</span></span>
                  <div className="pmember__main">
                    <div className="pmember__top">
                      <span className="pmember__name">{m.name}</span>
                    </div>
                    <div className="pmember__perms">
                      {PERM_LABELS.map(([key, label]) => (
                        <span key={key} role="button" tabIndex={0} className={`perm${m.perms[key] ? " is-on" : ""}`}
                          onClick={() => togglePerm(m.name, key)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePerm(m.name, key); } }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="pmember__remove" aria-label={`${m.name} をパーティーから外す`} onClick={() => removeMember(m.name)}>✕</button>
                </div>
              ))}
            </div>
            {/* 候補からメンバー追加 */}
            <div className="party__add">
              <label className="text-sm" style={{ fontWeight: 600 }}>メンバーを追加（同一グループの所属者）</label>
              <div className="candlist">
                {CANDIDATES.filter((c) => !addedNames.has(c.name)).map((c) => (
                  <button key={c.name} className="cand" type="button" onClick={() => addMember(c)}>
                    <span className="avatar sm"><span className="avatar__img placeholder">{c.ini}</span></span>{c.name} ＋
                  </button>
                ))}
                {CANDIDATES.every((c) => addedNames.has(c.name)) && <span className="hint">候補は全員追加済みです。</span>}
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
        <Button type="button" variant="outline" onClick={onCancel}>キャンセル</Button>
        <Button type="button" variant="outline" onClick={onDone}>下書き保存</Button>
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "作成中…" : "クエストを作成"}</Button>
      </ModalFooter>
    </form>
  );
}
