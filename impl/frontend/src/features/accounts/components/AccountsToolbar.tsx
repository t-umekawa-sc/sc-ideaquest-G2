// アカウント一覧のツールバー（検索＝氏名/ログインID/メール ＋ 状態フィルタ＝有効/無効）。SC-92/SC-93 で共用（DRY §2.3）。
// 送信（フォーム submit）で親へ確定値を渡す＝入力ごとの再取得はしない（打鍵ごとの API 連打を避ける）。判定はサーバー。
import { useState } from "react";

import { Button } from "@/components/ui";

type Props = {
  q: string;
  status: string;
  onApply: (next: { q: string; status: string }) => void;
};

export function AccountsToolbar({ q, status, onApply }: Props) {
  const [qDraft, setQDraft] = useState(q);
  const [statusDraft, setStatusDraft] = useState(status);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    onApply({ q: qDraft.trim(), status: statusDraft });
  }

  function onReset() {
    setQDraft("");
    setStatusDraft("");
    onApply({ q: "", status: "" });
  }

  return (
    <form className="list-toolbar" role="search" aria-label="アカウント検索" onSubmit={onSubmit}>
      <input
        type="search"
        className="input"
        aria-label="検索（氏名・ログインID・メール）"
        placeholder="氏名・ログインID・メールで検索"
        value={qDraft}
        onChange={(e) => setQDraft(e.target.value)}
      />
      <select
        className="input"
        aria-label="状態で絞り込み"
        value={statusDraft}
        onChange={(e) => setStatusDraft(e.target.value)}
      >
        <option value="">すべての状態</option>
        <option value="active">有効</option>
        <option value="disabled">無効</option>
      </select>
      <Button type="submit" variant="outline">
        検索
      </Button>
      {(q || status) && (
        <Button type="button" variant="default" onClick={onReset}>
          クリア
        </Button>
      )}
    </form>
  );
}
