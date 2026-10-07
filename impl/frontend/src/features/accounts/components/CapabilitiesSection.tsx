"use client";

// SC-93/SC-92「②会社レベル能力（capability）」の汎用付与UI（API設計 T.4・FR-47・決定D/I/J）。
// info_curator 専用だった旧 InfoCuratorSection を全能力に汎用化＝上部の能力セレクタで対象を切替え、
// 選択能力の保有者一覧（DataTable・⋯ から剥奪）＋「権限を付与する」ダイアログ（会社ディレクトリ検索）を回す。
// 認可はサーバー権威（会社アカウント管理者/system_admin のみ・per-account EP で付与/剥奪）。
import { useCallback, useEffect, useMemo, useState } from "react";

import { Avatar, Button, DataTable, Modal, ModalBody, ModalFooter, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { grantCapability, listCapabilityHolders, listOwnAccounts, listOwnCompanyQuestGroups, revokeCapability } from "../api";
import type { CapabilityHolder, CapabilityKey } from "../api";
import { filterCapabilityCandidates } from "../capabilityCandidates";
import { useAllAccounts } from "../useAllAccounts";
import "@/features/companies/companies.css"; // admin-create/admin-toolbar（SC-93 の他セクションと同居）
import "@/features/qgadmin/qgadmin.css"; // dir-list/dir-row/dir-more（メンバー追加ダイアログと同構成）

const PER = 20; // 付与ダイアログの「もっと見る」1回の増分（クライアント側スライス）。

// 付与できる能力（§5.3・T.4）＝ラベルと説明。付与/剥奪の動詞ラベルにも使う。
const CAPS: { key: CapabilityKey; label: string; noun: string; hint: string }[] = [
  { key: "info_curator", label: "情報判定", noun: "情報判定権限",
    hint: "情報インプットの属性付与・情報判定（triage）・アーカイブを行える権限です。内容の作成・関連リンクは全員が可能で、この権限はキュレーションに限られます。" },
  { key: "quest_create", label: "クエスト作成", noun: "クエスト作成権限",
    hint: "業務用クエストの作成・編集・削除を行える権限です（決定K）。既存のクエスト作成者は移行時に自動付与されています。" },
  { key: "contest_create", label: "コンテスト作成", noun: "コンテスト運営権限",
    hint: "アイデアコンテストの作成・編集・会期遷移・表彰確定・参加承認を行える権限です（決定I＝一般ユーザーにも付与可）。" },
  { key: "contest_evaluator", label: "審査員", noun: "審査員権限",
    hint: "コンテスト配下アイデアの評価（審査）を行える権限です（決定J＝偏り防止で運営が指名）。会社横断で有効です。" },
];

export function CapabilitiesSection() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const { accounts } = useAllAccounts(listOwnAccounts);
  const [cap, setCap] = useState<CapabilityKey>("info_curator"); // 選択中の能力
  const [holders, setHolders] = useState<CapabilityHolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); // 付与ダイアログの開閉
  const [q, setQ] = useState(""); // 会社ディレクトリ検索
  const [group, setGroup] = useState(""); // クエストグループ絞り込み（""=すべて）
  const [groups, setGroups] = useState<{ group_id: string; name: string }[]>([]); // 自社クエストグループ候補
  const [shown, setShown] = useState(PER); // 「もっと見る」で増える表示件数

  const meta = useMemo(() => CAPS.find((c) => c.key === cap) ?? CAPS[0], [cap]);

  // 付与ダイアログのクエストグループ絞り込み候補＝自社のクエストグループ一覧（1回取得）。
  useEffect(() => {
    void listOwnCompanyQuestGroups()
      .then((res) => setGroups((res?.data ?? []).map((g) => ({ group_id: g.group_id, name: g.name }))))
      .catch(() => setGroups([]));
  }, []);

  const reload = useCallback(async (key: CapabilityKey) => {
    setLoading(true);
    try { const res = await listCapabilityHolders(key); setHolders(res?.data ?? []); }
    catch { setHolders([]); /* 403 等は空表示（画面自体は管理者のみ到達） */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(cap); }, [reload, cap]);

  const holderIds = useMemo(() => new Set(holders.map((c) => c.account_id)), [holders]);
  // 付与候補＝有効(active)かつ当該能力を未付与＋氏名/ログインID検索＋クエストグループ所属（純関数・T-TC-209）。
  const candidates = useMemo(
    () => filterCapabilityCandidates(accounts, { holderIds, q, groupId: group }),
    [accounts, holderIds, q, group],
  );
  const visible = candidates.slice(0, shown);
  const hasNext = candidates.length > shown;

  // 検索/グループ変更・ダイアログ開閉・能力切替で表示件数をリセット（メンバー追加ダイアログの先頭ページ相当）。
  useEffect(() => { setShown(PER); }, [q, group, open, cap]);
  // 能力を切り替えたら付与ダイアログは閉じる（対象能力の取り違え防止）。
  useEffect(() => { setOpen(false); }, [cap]);

  const grant = async (accountId: string) => {
    setBusy(true);
    try {
      await grantCapability(accountId, cap);
      snack({ type: "success", title: `${meta.noun}を付与しました` });
      await reload(cap); // 付与応答は能力配列のみ＝保有者一覧を再取得（付与済みは候補から自動的に外れる）。
    } catch (e) {
      snack({ type: "error", title: "付与できませんでした", msg: e instanceof ApiError && e.status === 409 ? "既に付与済みです。" : "時間をおいて再度お試しください。" });
      void reload(cap);
    } finally { setBusy(false); }
  };

  const revoke = async (c: CapabilityHolder) => {
    const ok = await confirm({ variant: "danger", title: `${meta.noun}を剥奪`, msg: `「${c.display_name}」の${meta.noun}を剥奪しますか？（付与済みの成果・判定は残ります）`, confirmLabel: "剥奪する" });
    if (!ok) return;
    setBusy(true);
    try { await revokeCapability(c.account_id, cap); snack({ type: "success", title: `「${c.display_name}」の権限を剥奪しました` }); }
    catch { snack({ type: "error", title: "剥奪できませんでした", msg: "時間をおいて再度お試しください。" }); }
    finally { setBusy(false); void reload(cap); }
  };

  const columns: DataTableColumn<CapabilityHolder>[] = [
    {
      key: "name", label: "氏名", locked: true, width: 260, sortable: true, filter: { type: "text" },
      sortVal: (c) => c.display_name, searchVal: (c) => c.display_name, csvVal: (c) => c.display_name,
      render: (c) => (<span className="co"><Avatar name={c.display_name} size="sm" /><strong>{c.display_name}</strong></span>),
    },
    {
      key: "granted", label: "付与", width: 220, sortable: true,
      sortVal: (c) => c.granted_at, csvVal: (c) => `${c.granted_by ?? "—"}・${c.granted_at.slice(0, 10)}`,
      render: (c) => <span className="badge badge-muted">{c.granted_by ?? "—"}・{c.granted_at.slice(0, 10)}</span>,
    },
    {
      key: "_actions", label: "", actions: true, locked: true, width: 80,
      render: (c) => <RowMenu items={[{ label: `${meta.noun}を剥奪`, danger: true, onClick: () => void revoke(c) }]} />,
    },
  ];

  return (
    <section className="card admin-create admin-create--table caps-section" aria-label="②会社レベル能力の管理" style={{ marginTop: "var(--space-4)" }}>
      <div className="admin-toolbar">
        <h2>権限（能力）の付与</h2>
      </div>
      {/* 能力タブ＝対象の能力を切り替える（選択能力の保有者一覧＋付与/剥奪を回す）。 */}
      <div className="tabs" role="tablist" aria-label="能力の種類">
        {CAPS.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={cap === c.key}
                  className={`tab${cap === c.key ? " is-active" : ""}`} onClick={() => setCap(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      {/* 付与ボタンはタブ内（選択中の能力に対して付与・ユーザー要望）。説明と同じ行に右寄せ。 */}
      <div className="caps-toolbar">
        <p className="hint" style={{ margin: 0 }}>{meta.hint}</p>
        <button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>＋ 権限を付与する</button>
      </div>

      {loading ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<CapabilityHolder>
          storageKey="sc93-capabilities"
          data={holders}
          columns={columns}
          rowId={(c) => c.account_id}
          unit="名"
          perPage={5}
          perPageOptions={[5, 10, 20, 50]}
          searchFields="氏名"
          exportName={`${meta.label}の権限`}
          emptyText={`${meta.noun}を持つユーザーはまだいません。「＋ 権限を付与する」から付与してください。`}
          cardLayout={(c) => ({ title: c.display_name, badges: [{ label: `付与 ${c.granted_at.slice(0, 10)}` }] })}
        />
      )}

      {open && (
        <Modal open={open} onClose={() => setOpen(false)} title={`${meta.noun}を付与`} size="md">
          <ModalBody>
            <div className="form-row dialog-section is-quiet">
              <label htmlFor="cap_search">会社ディレクトリを検索</label>
              <input id="cap_search" className="input" type="search" placeholder="氏名・ログインIDで検索" value={q} onChange={(e) => setQ(e.target.value)} />
              {/* クエストグループでの絞り込み（ユーザー要望）＝所属メンバーだけに絞る（""=すべて）。 */}
              <select id="cap_group" className="select" aria-label="クエストグループで絞り込み" value={group} onChange={(e) => setGroup(e.target.value)} style={{ marginTop: "var(--space-2)" }}>
                <option value="">クエストグループ: すべて</option>
                {groups.map((g) => <option key={g.group_id} value={g.group_id}>{g.name}</option>)}
              </select>
              <div className="hint">自社の有効アカウントから選択。既に{meta.label}権限を持つ人は表示されません。</div>
            </div>
            <div className="dir-list">
              {visible.length === 0 ? (
                <div className="dir-list__status">{q.trim() || group ? "条件に一致するユーザーがいません（検索・クエストグループ絞り込みを見直してください）。" : "候補がありません。未発行の場合はアカウントを発行してください。"}</div>
              ) : (
                visible.map((a) => (
                  <div className="dir-row" key={a.account_id}>
                    <Avatar name={a.display_name} imageUrl={a.avatar_url ?? undefined} size="sm" />
                    <span className="dir-row__name">{a.display_name}（{a.login_id}）</span>
                    <Button type="button" variant="primary" disabled={busy} onClick={() => void grant(a.account_id)}>付与</Button>
                  </div>
                ))
              )}
            </div>
            {hasNext ? (
              <div className="dir-more">
                <Button type="button" variant="outline" size="sm" onClick={() => setShown((s) => s + PER)}>
                  もっと見る（残り {candidates.length - shown}）
                </Button>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>閉じる</Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}
