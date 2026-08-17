"use client";

// SC-92 アカウント発行の URL 付きモーダル（Intercept Routes・§112）。会社詳細(/admin/companies/[id])からの
// ソフト遷移で /admin/companies/[id]/accounts/new をこのモーダルに差し込む。直アクセス/リロードは対応フルページ。
// 成功時＝ACCOUNTS_CHANGED_EVENT を発火（背景の一覧が購読して再取得）→ close（アニメ後に router.back）。
import { useParams } from "next/navigation";

import { RouteModal } from "@/components/ui";
import { ACCOUNTS_CHANGED_EVENT, AccountFormPanel } from "@/features/accounts";

export default function CompanyAccountIssueModal() {
  const { id } = useParams<{ id: string }>();
  return (
    <RouteModal title="アカウントを発行" size="md">
      {(close) => (
        <AccountFormPanel
          mode="issue"
          scope="company"
          companyId={id}
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
