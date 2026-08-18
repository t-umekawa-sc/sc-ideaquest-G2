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
  const [error, setError] = useState<string | null>(null);

  // 追加先グループ名の表示用（自分が admin のグループから id 一致を解決）。取得失敗は表示のみ影響。
  useEffect(() => {
    void listMyGroups()
      .then((res) => setGroupName((res?.data ?? []).find((g) => g.group_id === groupId)?.name ?? null))
      .catch(() => {});
  }, [groupId]);

  const fetchDirectory = useCallback(async () => {
    try {
      const res = await companyDirectory(dirQuery || undefined);
      setDirectory(res?.data ?? []);
    } catch {
      setError("ディレクトリの取得に失敗しました。");
    }
  }, [dirQuery]);

  // ライブ検索（モック SC-90 準拠＝入力で即絞込・250ms デバウンス）。マウント時も取得。
  useEffect(() => {
    const t = setTimeout(() => void fetchDirectory(), 250);
    return () => clearTimeout(t);
  }, [fetchDirectory]);

  async function onAdd(accountId: string) {
    setError(null);
    try {
      await addMember(groupId, accountId);
      window.dispatchEvent(new Event(GROUP_MEMBERS_CHANGED_EVENT)); // 背景の一覧が購読して再取得
      void fetchDirectory(); // 追加済みは候補から消す（モック挙動）
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
        <div className="form-row">
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
        <div className="dir-list">
          {directory.map((d) => (
            <div className="dir-row" key={d.account_id}>
              <Avatar name={d.display_name} size="sm" />
              <span className="dir-row__name">{d.display_name}</span>
              <Button type="button" variant="primary" onClick={() => onAdd(d.account_id)}>追加</Button>
            </div>
          ))}
        </div>
        {directory.length === 0 && (
          <div className="list-empty">
            候補がありません。未発行の場合は<strong>会社アカウント管理者</strong>へ発行を依頼してください。
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>閉じる</Button>
      </ModalFooter>
    </>
  );
}
