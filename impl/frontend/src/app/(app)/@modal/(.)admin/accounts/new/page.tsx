"use client";

// SC-93 自社アカウント発行の URL 付きモーダル（Intercept Routes・§112）。一覧(/admin/accounts)からの
// ソフト遷移で /admin/accounts/new をこのモーダルに差し込む。直アクセス/リロードは対応フルページ。
// 成功時＝ACCOUNTS_CHANGED_EVENT を発火（背景の一覧が購読して再取得）→ close（アニメ後に router.back）。
import { RouteModal } from "@/components/ui";
import { ACCOUNTS_CHANGED_EVENT, AccountFormPanel } from "@/features/accounts";

export default function OwnAccountIssueModal() {
  return (
    <RouteModal title="アカウントを発行" size="md">
      {(close) => (
        <AccountFormPanel
          mode="issue"
          scope="own"
          onCancel={close}
          onDone={() => {
            window.dispatchEvent(new Event(ACCOUNTS_CHANGED_EVENT));
            close();
          }}
        />
      )}
    </RouteModal>
  );
}
