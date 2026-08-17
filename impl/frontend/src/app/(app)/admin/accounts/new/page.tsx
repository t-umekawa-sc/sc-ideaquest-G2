"use client";

// SC-93 自社アカウント発行のフルページ・フォールバック（直アクセス/リロード時）。
// 一覧(/admin/accounts)からのソフト遷移では @modal/(.)admin/accounts/new のモーダルが差し込まれる（§112）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AccountFormPanel } from "@/features/accounts";

export default function OwnAccountIssueFullPage() {
  const router = useRouter();
  const back = () => router.push("/admin/accounts");
  return (
    <section aria-label="アカウントを発行">
      <Link className="backlink" href="/admin/accounts">← 会社アカウント管理へ戻る</Link>
      <h1 className="page-title">アカウントを発行</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 600, margin: "var(--space-4) auto 0" }}>
        <AccountFormPanel mode="issue" scope="own" onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
