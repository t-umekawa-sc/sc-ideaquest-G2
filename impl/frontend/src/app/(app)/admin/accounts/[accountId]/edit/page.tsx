"use client";

// SC-93 自社アカウント編集のフルページ・フォールバック（直アクセス/リロード時）。
// 一覧の行アクションからのソフト遷移では @modal 側のモーダルが差し込まれる（Intercept Routes・§112）。
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { AccountFormPanel } from "@/features/accounts";

export default function OwnAccountEditFullPage() {
  const router = useRouter();
  const { accountId } = useParams<{ accountId: string }>();
  const back = () => router.push("/admin/accounts");
  return (
    <section aria-label="アカウントを編集">
      <Link className="backlink" href="/admin/accounts">← 会社アカウント管理へ戻る</Link>
      <h1 className="page-title">アカウントを編集</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 600, margin: "var(--space-4) auto 0" }}>
        <AccountFormPanel mode="edit" scope="own" accountId={accountId} onDone={back} onCancel={back} />
      </div>
    </section>
  );
}
