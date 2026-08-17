"use client";

// SC-91 会社作成の URL 付きモーダル（Intercept Routes・§112）。一覧(/admin/companies)からのソフト遷移で
// /admin/companies/new をこのモーダルに差し込む。直アクセス/リロードは (app)/admin/companies/new のフルページ。
// 成功時＝COMPANIES_CHANGED_EVENT を発火（背景の一覧が購読して再取得）→ close（アニメ後に router.back）。
import { RouteModal } from "@/components/ui";
import { COMPANIES_CHANGED_EVENT, CompanyCreateForm } from "@/features/companies";

export default function CompanyCreateInterceptModal() {
  return (
    <RouteModal title="会社（テナント）を作成" size="md">
      {(close) => (
        <CompanyCreateForm
          onCancel={close}
          onDone={() => {
            window.dispatchEvent(new Event(COMPANIES_CHANGED_EVENT));
            close();
          }}
        />
      )}
    </RouteModal>
  );
}
