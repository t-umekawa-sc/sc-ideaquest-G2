"use client";

// SC-90 メンバー追加ピッカー（B.4）。URL 付きモーダル（intercept）とフルページ（直アクセス）で共有。
// ディレクトリはライブ検索（入力で即絞込・250ms デバウンス・検索ボタン無し）。参加ロールは member 固定（admin 任命不可）。
// 「開いたまま複数追加」する UX＝追加しても閉じない。追加ごとに GROUP_MEMBERS_CHANGED_EVENT を発火して
// 背景の一覧が再取得する（跨ルート更新）。閉じるは onClose（アニメ後に router.back / 一覧へ遷移）。
// レイアウト/クラスの正＝doc/画面設計/mocks/SC-90_クエストグループ管理.html（DoD＝モック一致）。
import { useCallback, useEffect, useState } from "react";

import { Avatar, Button, ModalBody, ModalFooter } from "@/components/ui";
import { GROUP_MEMBERS_CHANGED_EVENT, addMember, companyDirectory, listMyGroups, type DirectoryEntry } from "../api";
import "@/features/companies/companies.css";
import "../qgadmin.css";

export function MemberAddPanel({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [groupName, setGroupName] = useState<string | null>(null);
  const [dirQuery, setDirQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [total, setTotal] = useState(0);   // page_info.total＝「もっと見る」の残り判定
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); // 初回取得完了まで＝リスト領域内でローディング表示
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const PER = 20;

  // 追加先グループ名の表示用（自分が admin のグループから id 一致を解決）。取得失敗は表示のみ影響。
  useEffect(() => {
    void listMyGroups()
      .then((res) => setGroupName((res?.data ?? []).find((g) => g.group_id === groupId)?.name ?? null))
      .catch(() => {});
  }, [groupId]);

  // 先頭ページ取得（検索変更/マウント/追加後にリセット）。既参加者はサーバー除外（SC-90）。
  const loadFirst = useCallback(async () => {
    setLoading(true);
    try {
      const res = await companyDirectory(dirQuery || undefined, groupId, 1, PER);
      setDirectory(res?.data ?? []);
      setTotal(res?.page_info?.total ?? 0);
      setPage(1);
    } catch {
      setError("ディレクトリの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [dirQuery, groupId]);

  // もっと見る＝次ページを取得して末尾に追加（対象ピッカーと同じ＝内部スクロールにしない）。
  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const next = page + 1;
      const res = await companyDirectory(dirQuery || undefined, groupId, next, PER);
      setDirectory((prev) => [...prev, ...(res?.data ?? [])]);
      setPage(next);
    } catch {
      setError("ディレクトリの取得に失敗しました。");
    } finally {
      setMoreLoading(false);
    }
  };

  // ライブ検索（モック SC-90 準拠＝入力で即絞込・250ms デバウンス）。マウント時も取得。
  useEffect(() => {
    const t = setTimeout(() => void loadFirst(), 250);
    return () => clearTimeout(t);
  }, [loadFirst]);

  const hasNext = directory.length < total;

  async function onAdd(accountId: string) {
    setError(null);
    try {
      await addMember(groupId, accountId);
      window.dispatchEvent(new Event(GROUP_MEMBERS_CHANGED_EVENT)); // 背景の一覧が購読して再取得
      // 追加済みは候補から即除去（再取得せず表示位置を維持＝もっと見るで読み込んだ分を保つ）。
      setDirectory((prev) => prev.filter((d) => d.account_id !== accountId));
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      setError("参加追加に失敗しました。");
    }
  }

  return (
    <>
      <ModalBody>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-row">
          <label>追加先グループ</label>
          <div className="form-note">
            {groupName ? `${groupName}（あなたが管理するグループ・参加ロールはメンバー固定）` : "—"}
          </div>
        </div>
        <div className="form-row dialog-section is-quiet">
          <label htmlFor="dir_search">会社ディレクトリを検索</label>
          <input
            id="dir_search"
            className="input"
            type="search"
            placeholder="氏名・ログインIDで検索"
            value={dirQuery}
            onChange={(e) => setDirQuery(e.target.value)}
          />
          <div className="hint">
            自社の有効アカウントから選択。既にこのグループに参加中の人は表示されません。氏名・アバターのみ表示（メール・ロール・他グループ所属は非開示）。
          </div>
        </div>
        {/* 候補リスト＝内部スクロールにせず縦に伸ばす（対象ピッカー10d と統一）。件数は「もっと見る」で制御。
            ローディング/空は min-height の領域で中央表示（取得直後の高さジャンプを抑える）。 */}
        <div className="dir-list" aria-busy={loading}>
          {loading ? (
            <div className="dir-list__status">読み込み中…</div>
          ) : directory.length === 0 ? (
            <div className="dir-list__status">
              候補がありません。未発行の場合は<strong>会社アカウント管理者</strong>へ発行を依頼してください。
            </div>
          ) : (
            directory.map((d) => (
              <div className="dir-row" key={d.account_id}>
                <Avatar name={d.display_name} imageUrl={d.avatar_url ?? undefined} size="sm" />
                <span className="dir-row__name">{d.display_name}</span>
                <Button type="button" variant="primary" onClick={() => onAdd(d.account_id)}>追加</Button>
              </div>
            ))
          )}
        </div>
        {hasNext ? (
          <div className="dir-more">
            <Button type="button" variant="outline" size="sm" disabled={moreLoading} onClick={() => void loadMore()}>
              {moreLoading ? "読み込み中…" : `もっと見る（残り ${total - directory.length}）`}
            </Button>
          </div>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>閉じる</Button>
      </ModalFooter>
    </>
  );
}
