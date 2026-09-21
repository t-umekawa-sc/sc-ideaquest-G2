"use client";

// SC-93/SC-92「情報判定権限（info_curator）」の管理（N.5）＝会社アカウント管理者/system_admin。
// 情報インプットの属性付与・情報判定・アーカイブを行える権限。account_id で付与/剥奪（セッション会社固定）。
// UI＝クエストグループ管理（SC-90）と同構成＝付与済みユーザーの一覧（DataTable・⋯ から剥奪）＋
// 「権限を付与する」→ メンバー追加ダイアログ風（会社ディレクトリ検索＋もっと見る＋行の「付与」）。
import { useCallback, useEffect, useMemo, useState } from "react";

import { Avatar, Button, DataTable, Modal, ModalBody, ModalFooter, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { grantInfoCurator, listInfoCurators, listOwnAccounts, revokeInfoCurator } from "../api";
import type { InfoCurator } from "../api";
import { useAllAccounts } from "../useAllAccounts";
import "@/features/companies/companies.css"; // admin-create/admin-toolbar（SC-93 の他セクションと同居）
import "@/features/qgadmin/qgadmin.css"; // dir-list/dir-row/dir-more（メンバー追加ダイアログと同構成）

const PER = 20; // 付与ダイアログの「もっと見る」1回の増分（クライアント側スライス）。

export function InfoCuratorSection() {
  const snack = useSnackbar();
  const confirm = useConfirm();
  const { accounts } = useAllAccounts(listOwnAccounts);
  const [curators, setCurators] = useState<InfoCurator[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); // 付与ダイアログの開閉
  const [q, setQ] = useState(""); // 会社ディレクトリ検索
  const [shown, setShown] = useState(PER); // 「もっと見る」で増える表示件数

  const reload = useCallback(async () => {
    setLoading(true);
    try { const res = await listInfoCurators(); setCurators(res?.data ?? []); }
    catch { /* 403 等は空表示（画面自体は管理者のみ到達） */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const curatorIds = useMemo(() => new Set(curators.map((c) => c.account_id)), [curators]);
  // 付与候補＝有効（active）かつ未付与のアカウント。検索は氏名/ログインID の部分一致（クライアント側・管理系は小規模）。
  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts
      .filter((a) => a.status === "active" && !curatorIds.has(a.account_id))
      .filter((a) => !needle || `${a.display_name} ${a.login_id}`.toLowerCase().includes(needle));
  }, [accounts, curatorIds, q]);
  const visible = candidates.slice(0, shown);
  const hasNext = candidates.length > shown;

  // 検索変更・ダイアログ開閉で表示件数をリセット（メンバー追加ダイアログの先頭ページ相当）。
  useEffect(() => { setShown(PER); }, [q, open]);

  const grant = async (accountId: string) => {
    setBusy(true);
    try {
      const res = await grantInfoCurator(accountId);
      setCurators(res?.data ?? curators);
      snack({ type: "success", title: "情報判定権限を付与しました" });
      // 付与済みは curatorIds 変化で候補から自動的に外れる（ダイアログは開いたまま＝連続付与）。
    } catch (e) {
      snack({ type: "error", title: "付与できませんでした", msg: e instanceof ApiError && e.status === 409 ? "既に付与済みです。" : "時間をおいて再度お試しください。" });
      void reload();
    } finally { setBusy(false); }
  };

  const revoke = async (c: InfoCurator) => {
    const ok = await confirm({ variant: "danger", title: "情報判定権限を剥奪", msg: `「${c.display_name}」の情報判定権限を剥奪しますか？（付与済みの属性/判定は残ります）`, confirmLabel: "剥奪する" });
    if (!ok) return;
    setBusy(true);
    try { await revokeInfoCurator(c.account_id); snack({ type: "success", title: `「${c.display_name}」の権限を剥奪しました` }); }
    catch { snack({ type: "error", title: "剥奪できませんでした", msg: "時間をおいて再度お試しください。" }); }
    finally { setBusy(false); void reload(); }
  };

  const columns: DataTableColumn<InfoCurator>[] = [
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
      render: (c) => <RowMenu items={[{ label: "情報判定権限を剥奪", danger: true, onClick: () => void revoke(c) }]} />,
    },
  ];

  return (
    <section className="card admin-create admin-create--table" aria-label="情報判定権限の管理" style={{ marginTop: "var(--space-4)" }}>
      <div className="admin-toolbar">
        <h2>情報判定権限（情報インプット）</h2>
        <button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>＋ 権限を付与する</button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        情報インプットの<strong>属性付与・情報判定（triage）・アーカイブ</strong>を行える権限です。内容の作成・関連リンクは全員が可能で、この権限は<strong>キュレーション</strong>に限られます。
      </p>

      {loading ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<InfoCurator>
          storageKey="sc93-info-curators"
          data={curators}
          columns={columns}
          rowId={(c) => c.account_id}
          unit="名"
          perPage={5}
          perPageOptions={[5, 10, 20, 50]}
          searchFields="氏名"
          exportName="情報判定権限"
          emptyText="情報判定権限を持つユーザーはまだいません。「＋ 権限を付与する」から付与してください。"
          cardLayout={(c) => ({ title: c.display_name, badges: [{ label: `付与 ${c.granted_at.slice(0, 10)}` }] })}
        />
      )}

      {open && (
        <Modal open={open} onClose={() => setOpen(false)} title="情報判定権限を付与" size="md">
          <ModalBody>
            <div className="form-row dialog-section is-quiet">
              <label htmlFor="curator_search">会社ディレクトリを検索</label>
              <input id="curator_search" className="input" type="search" placeholder="氏名・ログインIDで検索" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="hint">自社の有効アカウントから選択。既に権限を持つ人は表示されません。</div>
            </div>
            <div className="dir-list">
              {visible.length === 0 ? (
                <div className="dir-list__status">候補がありません。未発行の場合はアカウントを発行してください。</div>
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
