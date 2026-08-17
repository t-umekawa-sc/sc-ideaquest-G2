"use client";

// SC-92 アカウント発行のフルページ・フォールバック（直アクセス/リロード時）。
// 会社詳細からのソフト遷移では @modal/(.)admin/companies/[id]/accounts/new のモーダルが差し込まれる（Intercept Routes・§112）。
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { AccountFormPanel } from "@/features/accounts";

export default function CompanyAccountIssueFullPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const back = () => router.push(`/admin/companies/${id}`);
  return (
    <section aria-label="アカウントを発行">
      <Link className="backlink" href={`/admin/companies/${id}`}>← 会社詳細へ戻る</Link>
      <h1 className="page-title">アカウントを発行</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 600, margin: "var(--space-4) auto 0" }}>
        <AccountFormPanel mode="issue" scope="company" companyId={id} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
