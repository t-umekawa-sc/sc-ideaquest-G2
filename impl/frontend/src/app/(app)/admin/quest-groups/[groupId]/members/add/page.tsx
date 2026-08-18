"use client";

// SC-90 メンバー追加のフルページ・フォールバック（直アクセス/リロード時）。
// クエストグループ管理(/admin/quest-groups)からのソフト遷移では @modal 側のモーダルが差し込まれる（§112）。
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { MemberAddPanel } from "@/features/qgadmin";

export default function MemberAddFullPage() {
  const router = useRouter();
  const { groupId } = useParams<{ groupId: string }>();
  const back = () => router.push("/admin/quest-groups");
  return (
    <section aria-label="メンバーを追加">
      <Link className="backlink" href="/admin/quest-groups">← クエストグループ管理へ戻る</Link>
      <h1 className="page-title">メンバーを追加</h1>
      <div className="modal__panel sectioned" style={{ maxWidth: 600, margin: "var(--space-4) auto 0" }}>
        <MemberAddPanel groupId={groupId} onClose={back} />
      </div>
    </section>
  );
}
