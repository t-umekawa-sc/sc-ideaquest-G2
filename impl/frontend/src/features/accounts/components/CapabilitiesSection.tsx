"use client";

// SC-93/SC-92「②会社レベル能力（capability）」の汎用付与UI（API設計 T.4・FR-47・決定D/I/J）。
// info_curator 専用だった旧 InfoCuratorSection を全能力に汎用化＝上部の能力セレクタで対象を切替え、
// 選択能力の保有者一覧（DataTable・⋯ から剥奪）＋「権限を付与する」ダイアログ（会社ディレクトリ検索）を回す。
// 認可はサーバー権威（会社アカウント管理者/system_admin のみ・per-account EP で付与/剥奪）。
import { useCallback, useEffect, useMemo, useState } from "react";

import { Avatar, Button, DataTable, Modal, ModalBody, ModalFooter, Multiselect, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { grantCapability, listCapabilityHolders, listOwnAccounts, listOwnCompanyQuestGroups, revokeCapability } from "../api";
import type { CapabilityHolder, CapabilityKey } from "../api";
import { filterCapabilityCandidates, filterRevokeCandidates } from "../capabilityCandidates";
import { useAllAccounts } from "../useAllAccounts";
import "@/features/companies/companies.css"; // admin-create/admin-toolbar（SC-93 の他セクションと同居）
import "@/features/qgadmin/qgadmin.css"; // dir-list/dir-row/dir-more（メンバー追加ダイアログと同構成）
import "@/features/info-input/info-input.css"; // pick-filters/pick-filter-row/pick-divider（「対象を選ぶ」と同レイアウト）

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
  const [everLoaded, setEverLoaded] = useState(false); // 初回ロード済みか（タブ切替のちらつき防止＝2回目以降はテーブルを差し替えない）
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); // 付与ダイアログの開閉
  const [q, setQ] = useState(""); // 会社ディレクトリ検索
  const [groupIds, setGroupIds] = useState<string[]>([]); // クエストグループ絞り込み（空=すべて・複数選択=OR）
  const [groups, setGroups] = useState<{ group_id: string; name: string }[]>([]); // 自社クエストグループ候補
  const [grantCaps, setGrantCaps] = useState<CapabilityKey[]>(["info_curator"]); // 付与ダイアログで同時付与する能力（複数可）
  const [revokeOpen, setRevokeOpen] = useState(false); // 剥奪ダイアログの開閉（付与の逆）
  const [revokeCaps, setRevokeCaps] = useState<CapabilityKey[]>(["info_curator"]); // 剥奪ダイアログで同時剥奪する能力（複数可）
  const [heldByAccount, setHeldByAccount] = useState<Map<string, Set<CapabilityKey>>>(new Map()); // account_id→保有能力（剥奪候補の算出）
  const [shown, setShown] = useState(PER); // 「もっと見る」で増える表示件数

  const meta = useMemo(() => CAPS.find((c) => c.key === cap) ?? CAPS[0], [cap]);
  const groupOptions = useMemo(() => groups.map((g) => ({ value: g.group_id, label: g.name })), [groups]);

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
    finally { setLoading(false); setEverLoaded(true); }
  }, []);
  useEffect(() => { void reload(cap); }, [reload, cap]);

  const holderIds = useMemo(() => new Set(holders.map((c) => c.account_id)), [holders]);
  // 付与候補＝有効(active)かつ当該能力を未付与＋氏名/ログインID検索＋クエストグループ所属（純関数・T-TC-209）。
  const candidates = useMemo(
    () => filterCapabilityCandidates(accounts, { holderIds, q, groupIds }),
    [accounts, holderIds, q, groupIds],
  );
  const visible = candidates.slice(0, shown);
  const hasNext = candidates.length > shown;
  // 剥奪候補＝選択した権限のいずれかを保持する active（付与の逆・純関数）。
  const revokeCandidates = useMemo(
    () => filterRevokeCandidates(accounts, { heldByAccount, revokeCaps, q, groupIds }),
    [accounts, heldByAccount, revokeCaps, q, groupIds],
  );
  const revokeVisible = revokeCandidates.slice(0, shown);
  const revokeHasNext = revokeCandidates.length > shown;

  // 検索/グループ変更・ダイアログ開閉・能力切替で表示件数をリセット（メンバー追加ダイアログの先頭ページ相当）。
  useEffect(() => { setShown(PER); }, [q, groupIds, open, revokeOpen, cap]);
  // 能力を切り替えたら両ダイアログは閉じる（対象能力の取り違え防止）。
  useEffect(() => { setOpen(false); setRevokeOpen(false); }, [cap]);
  // ダイアログを開くたび「付与/剥奪する能力」を現在のタブ1つに初期化（既定＝今見ている能力）。
  useEffect(() => { if (open) setGrantCaps([cap]); }, [open, cap]);
  useEffect(() => { if (revokeOpen) setRevokeCaps([cap]); }, [revokeOpen, cap]);

  // 剥奪ダイアログを開いたら全能力の保有者を取得→account_id→保有能力マップを作る（剥奪候補の算出に使う）。
  useEffect(() => {
    if (!revokeOpen) return;
    let cancelled = false;
    Promise.all(CAPS.map((c) =>
      listCapabilityHolders(c.key).then((r) => [c.key, r?.data ?? []] as const).catch(() => [c.key, []] as const)))
      .then((entries) => {
        if (cancelled) return;
        const m = new Map<string, Set<CapabilityKey>>();
        for (const [key, list] of entries) for (const h of list) {
          const s = m.get(h.account_id) ?? new Set<CapabilityKey>();
          s.add(key); m.set(h.account_id, s);
        }
        setHeldByAccount(m);
      });
    return () => { cancelled = true; };
  }, [revokeOpen]);

  const toggleGrantCap = (key: CapabilityKey) =>
    setGrantCaps((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const toggleRevokeCap = (key: CapabilityKey) =>
    setRevokeCaps((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const grant = async (accountId: string, name: string) => {
    if (grantCaps.length === 0) { snack({ type: "error", title: "付与する権限を1つ以上選んでください" }); return; }
    setBusy(true);
    try {
      // 選択された能力を同時付与（複数可・各 per-account EP・既に保持は 409 を握り潰す＝冪等扱い）。
      await Promise.all(grantCaps.map((c) =>
        grantCapability(accountId, c).catch((e) => { if (!(e instanceof ApiError && e.status === 409)) throw e; })));
      const names = grantCaps.map((k) => CAPS.find((c) => c.key === k)?.noun ?? k).join("・");
      snack({ type: "success", title: `「${name}」に ${names} を付与しました` });
      await reload(cap); // 保有者一覧を再取得（現タブの能力を付与していれば候補から外れる）。
    } catch {
      snack({ type: "error", title: "付与できませんでした", msg: "時間をおいて再度お試しください。" });
      void reload(cap);
    } finally { setBusy(false); }
  };

  // 対象者（絞り込み結果）全員に、選択中の権限をまとめて付与（確認必須・大量操作のため件数を明示）。
  const grantAll = async () => {
    if (grantCaps.length === 0 || candidates.length === 0) return;
    const names = grantCaps.map((k) => CAPS.find((c) => c.key === k)?.noun ?? k).join("・");
    const ok = await confirm({ title: "全員に付与", msg: `対象者 ${candidates.length} 名すべてに ${names} を付与しますか？`, confirmLabel: "付与する" });
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(candidates.flatMap((a) => grantCaps.map((c) =>
        grantCapability(a.account_id, c).catch((e) => { if (!(e instanceof ApiError && e.status === 409)) throw e; }))));
      snack({ type: "success", title: `${candidates.length} 名に ${names} を付与しました` });
      await reload(cap);
    } catch {
      snack({ type: "error", title: "一部の付与に失敗しました", msg: "時間をおいて再度お試しください。" });
      void reload(cap);
    } finally { setBusy(false); }
  };

  // 剥奪ダイアログの一括剥奪＝対象が保持する「選択中の権限」をまとめて剥奪（確認ダイアログ必須）。
  const revokeMany = async (accountId: string, name: string) => {
    const held = heldByAccount.get(accountId) ?? new Set<CapabilityKey>();
    const target = revokeCaps.filter((c) => held.has(c));
    if (target.length === 0) return;
    const names = target.map((k) => CAPS.find((c) => c.key === k)?.noun ?? k).join("・");
    const ok = await confirm({ variant: "danger", title: "権限を剥奪", msg: `「${name}」から ${names} を剥奪しますか？（付与済みの成果・判定は残ります）`, confirmLabel: "剥奪する" });
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(target.map((c) => revokeCapability(accountId, c)));
      snack({ type: "success", title: `「${name}」から ${names} を剥奪しました` });
      // 保有マップを即時更新（候補から外す）＋現タブの一覧を再取得。
      setHeldByAccount((prev) => {
        const m = new Map(prev); const s = new Set(m.get(accountId)); target.forEach((c) => s.delete(c));
        if (s.size) m.set(accountId, s); else m.delete(accountId); return m;
      });
      await reload(cap);
    } catch {
      snack({ type: "error", title: "剥奪できませんでした", msg: "時間をおいて再度お試しください。" });
    } finally { setBusy(false); }
  };

  // 対象者（選択権限の保有者）全員から、保持する選択中の権限をまとめて剥奪（確認必須）。
  const revokeAll = async () => {
    if (revokeCaps.length === 0 || revokeCandidates.length === 0) return;
    const names = revokeCaps.map((k) => CAPS.find((c) => c.key === k)?.noun ?? k).join("・");
    const ok = await confirm({ variant: "danger", title: "全員から剥奪", msg: `対象者 ${revokeCandidates.length} 名すべてから（保持する）${names} を剥奪しますか？（付与済みの成果・判定は残ります）`, confirmLabel: "剥奪する" });
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(revokeCandidates.flatMap((a) => {
        const held = heldByAccount.get(a.account_id) ?? new Set<CapabilityKey>();
        return revokeCaps.filter((c) => held.has(c)).map((c) => revokeCapability(a.account_id, c));
      }));
      snack({ type: "success", title: `${revokeCandidates.length} 名から ${names} を剥奪しました` });
      setHeldByAccount((prev) => {
        const m = new Map(prev);
        for (const a of revokeCandidates) { const s = new Set(m.get(a.account_id)); revokeCaps.forEach((c) => s.delete(c)); if (s.size) m.set(a.account_id, s); else m.delete(a.account_id); }
        return m;
      });
      await reload(cap);
    } catch {
      snack({ type: "error", title: "一部の剥奪に失敗しました", msg: "時間をおいて再度お試しください。" });
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
      {/* 付与/剥奪ボタンはタブ内（選択中の能力が既定・ダイアログ内で複数選択可）。説明と同じ行に右寄せ。 */}
      <div className="caps-toolbar">
        <p className="hint" style={{ margin: 0 }}>{meta.hint}</p>
        <div className="caps-toolbar__actions">
          <button className="btn btn-danger" type="button" onClick={() => setRevokeOpen(true)}>− 権限を剥奪する</button>
          <button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>＋ 権限を付与する</button>
        </div>
      </div>

      {/* 初回だけ「読み込み中…」を出し、タブ切替（2回目以降）は前のテーブルを残したまま差し替え＝ちらつき防止。 */}
      {loading && !everLoaded ? (
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
        // レイアウトは「対象を選ぶ」(TargetPicker) に合わせる＝セクション見出し＋左ラベル行＋仕切り線（§受入）。
        <Modal open={open} onClose={() => setOpen(false)} title="権限を付与" size="md">
          <ModalBody>
            {/* 🔍 絞り込み＝検索＋クエストグループ（複数選択・候補のみ＝.multiselect）。 */}
            <div className="pick-filters">
              <div className="pick-filters__title">🔍 絞り込み</div>
              <div className="pick-filter-row">
                <span className="pick-filter-lbl">検索</span>
                <div className="dt-search">
                  <span className="dt-search__ic" aria-hidden="true">🔍</span>
                  <input className="input" type="search" placeholder="氏名・ログインIDで検索…" aria-label="氏名・ログインID検索" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
              <div className="pick-filter-row">
                <span className="pick-filter-lbl">グループ</span>
                <Multiselect
                  options={groupOptions}
                  value={groupIds}
                  onChange={setGroupIds}
                  ariaLabel="クエストグループで絞り込み"
                  placeholder="クエストグループで絞り込み（すべて）"
                  emptyText="クエストグループがありません"
                />
              </div>
            </div>

            <hr className="pick-divider" />
            {/* 🏷️ 付与する権限＝複数同時に選べる（既定は現在のタブの能力・ユーザー要望）。 */}
            <div className="pick-kindsel">
              <div className="pick-kindsel__title">🏷️ 付与する権限</div>
              <div className="pick-filter-row">
                <span className="pick-filter-lbl">権限</span>
                <div className="pick-checks">
                  {CAPS.map((c) => (
                    <label key={c.key} className="checkbox">
                      <input type="checkbox" checked={grantCaps.includes(c.key)} onChange={() => toggleGrantCap(c.key)} /><span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <span className="hint">選んだ権限を、下で選んだユーザーに同時に付与します（既に{meta.label}権限を持つ人は候補に出ません）。</span>
            </div>

            <hr className="pick-divider" />
            {/* 📋 対象者＝絞り込み結果（会社の有効アカウント・各行の「付与」で選択能力をまとめて付与）。 */}
            <div className="pick-results-title">📋 対象者</div>
            <div className="pick-count-row"><span className="pick-count">該当 {candidates.length} 名</span></div>
            <div className="dir-list">
              {visible.length === 0 ? (
                <div className="dir-list__status">{q.trim() || groupIds.length ? "条件に一致するユーザーがいません（検索・クエストグループ絞り込みを見直してください）。" : "候補がありません。未発行の場合はアカウントを発行してください。"}</div>
              ) : (
                visible.map((a) => (
                  <div className="dir-row" key={a.account_id}>
                    <Avatar name={a.display_name} imageUrl={a.avatar_url ?? undefined} size="sm" />
                    <span className="dir-row__name">{a.display_name}（{a.login_id}）</span>
                    <Button type="button" variant="primary" disabled={busy || grantCaps.length === 0} onClick={() => void grant(a.account_id, a.display_name)}>付与</Button>
                  </div>
                ))
              )}
            </div>
            {hasNext ? (
              <div className="pick-more-wrap">
                <Button type="button" variant="outline" size="sm" onClick={() => setShown((s) => s + PER)}>
                  もっと見る（残り {candidates.length - shown}）
                </Button>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>閉じる</Button>
            <Button type="button" variant="primary" disabled={busy || grantCaps.length === 0 || candidates.length === 0} onClick={() => void grantAll()}>
              対象者 {candidates.length} 名すべてに付与
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {revokeOpen && (
        // 付与の逆＝剥奪ダイアログ。レイアウトは付与と同一（🔍絞り込み/🏷️剥奪する権限/📋対象者）。
        <Modal open={revokeOpen} onClose={() => setRevokeOpen(false)} title="権限を剥奪" size="md">
          <ModalBody>
            {/* 🔍 絞り込み＝検索＋クエストグループ（付与ダイアログと同じ q/groupIds を共用）。 */}
            <div className="pick-filters">
              <div className="pick-filters__title">🔍 絞り込み</div>
              <div className="pick-filter-row">
                <span className="pick-filter-lbl">検索</span>
                <div className="dt-search">
                  <span className="dt-search__ic" aria-hidden="true">🔍</span>
                  <input className="input" type="search" placeholder="氏名・ログインIDで検索…" aria-label="氏名・ログインID検索" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
              <div className="pick-filter-row">
                <span className="pick-filter-lbl">グループ</span>
                <Multiselect
                  options={groupOptions}
                  value={groupIds}
                  onChange={setGroupIds}
                  ariaLabel="クエストグループで絞り込み"
                  placeholder="クエストグループで絞り込み（すべて）"
                  emptyText="クエストグループがありません"
                />
              </div>
            </div>

            <hr className="pick-divider" />
            {/* 🏷️ 剥奪する権限＝複数同時に選べる（既定は現在のタブの能力）。 */}
            <div className="pick-kindsel">
              <div className="pick-kindsel__title">🏷️ 剥奪する権限</div>
              <div className="pick-filter-row">
                <span className="pick-filter-lbl">権限</span>
                <div className="pick-checks">
                  {CAPS.map((c) => (
                    <label key={c.key} className="checkbox">
                      <input type="checkbox" checked={revokeCaps.includes(c.key)} onChange={() => toggleRevokeCap(c.key)} /><span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <span className="hint">選んだ権限を保持するユーザーだけが候補に出ます。各行の「剥奪」で、その人が持つ選択中の権限をまとめて剥奪します。</span>
            </div>

            <hr className="pick-divider" />
            {/* 📋 対象者＝選択権限の保有者（各行に保有中の選択権限をバッジ表示＋「剥奪」）。 */}
            <div className="pick-results-title">📋 対象者</div>
            <div className="pick-count-row"><span className="pick-count">該当 {revokeCandidates.length} 名</span></div>
            <div className="dir-list">
              {revokeVisible.length === 0 ? (
                <div className="dir-list__status">{revokeCaps.length === 0 ? "剥奪する権限を選んでください。" : "選択した権限を持つユーザーがいません。"}</div>
              ) : (
                revokeVisible.map((a) => {
                  const heldSel = revokeCaps.filter((c) => heldByAccount.get(a.account_id)?.has(c));
                  return (
                    <div className="dir-row" key={a.account_id}>
                      <Avatar name={a.display_name} imageUrl={a.avatar_url ?? undefined} size="sm" />
                      <span className="dir-row__name">
                        {a.display_name}（{a.login_id}）
                        {heldSel.map((c) => <span key={c} className="badge badge-muted" style={{ marginLeft: 6 }}>{CAPS.find((x) => x.key === c)?.label}</span>)}
                      </span>
                      <Button type="button" variant="danger" disabled={busy} onClick={() => void revokeMany(a.account_id, a.display_name)}>剥奪</Button>
                    </div>
                  );
                })
              )}
            </div>
            {revokeHasNext ? (
              <div className="pick-more-wrap">
                <Button type="button" variant="outline" size="sm" onClick={() => setShown((s) => s + PER)}>
                  もっと見る（残り {revokeCandidates.length - shown}）
                </Button>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setRevokeOpen(false)}>閉じる</Button>
            <Button type="button" variant="danger" disabled={busy || revokeCaps.length === 0 || revokeCandidates.length === 0} onClick={() => void revokeAll()}>
              対象者 {revokeCandidates.length} 名すべてから剥奪
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}
