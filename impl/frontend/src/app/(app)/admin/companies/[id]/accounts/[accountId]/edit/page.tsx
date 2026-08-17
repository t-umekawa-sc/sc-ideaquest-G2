"use client";

// SC-92 アカウント編集のフルページ・フォールバック（直アクセス/リロード時）。
// 一覧の行アクションからのソフト遷移では @modal 側のモーダルが差し込まれる（Intercept Routes・§112）。
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { AccountFormPanel } from "@/features/accounts";

export default function CompanyAccountEditFullPage() {
  const router = useRouter();
  const { id, accountId } = useParams<{ id: string; accountId: string }>();
  const back = () => router.push(`/admin/companies/${id}`);
  return (
    <section aria-label="アカウントを編集">
      <Link className="backlink" href={`/admin/companies/${id}`}>← 会社詳細へ戻る</Link>
      <h1 className="page-title">アカウントを編集</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 600, margin: "var(--space-4) auto 0" }}>
        <AccountFormPanel mode="edit" scope="company" companyId={id} accountId={accountId} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
