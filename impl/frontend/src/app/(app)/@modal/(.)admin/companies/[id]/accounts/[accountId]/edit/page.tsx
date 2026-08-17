"use client";

// SC-92 アカウント編集の URL 付きモーダル（Intercept Routes・§112）。会社詳細の一覧行アクションからの
// ソフト遷移で /admin/companies/[id]/accounts/[accountId]/edit をこのモーダルに差し込む。
// 既存値は AccountFormPanel が id で解決してプリフィル。成功時＝ACCOUNTS_CHANGED_EVENT を発火 → close。
import { useParams } from "next/navigation";

import { RouteModal } from "@/components/ui";
import { ACCOUNTS_CHANGED_EVENT, AccountFormPanel } from "@/features/accounts";

export default function CompanyAccountEditModal() {
  const { id, accountId } = useParams<{ id: string; accountId: string }>();
  return (
    <RouteModal title="アカウントを編集" size="md">
      {(close) => (
        <AccountFormPanel
          mode="edit"
          scope="company"
          companyId={id}
          accountId={accountId}
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
