"use client";

// SC-91 会社作成のフルページ・フォールバック（直アクセス/リロード時）。
// 一覧からのソフト遷移では @modal/(.)admin/companies/new のモーダルが差し込まれる（Intercept Routes・§112）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CompanyCreateForm } from "@/features/companies";

export default function CompanyCreateFullPage() {
  const router = useRouter();
  const back = () => router.push("/admin/companies");
  return (
    <section aria-label="会社を作成">
      <Link className="backlink" href="/admin/companies">← 会社一覧へ戻る</Link>
      <h1 className="page-title">会社（テナント）を作成</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 600, margin: "var(--space-4) auto 0" }}>
        <CompanyCreateForm onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
