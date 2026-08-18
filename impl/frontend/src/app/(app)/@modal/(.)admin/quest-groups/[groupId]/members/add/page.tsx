"use client";

// SC-90 メンバー追加の URL 付きモーダル（Intercept Routes・§112）。クエストグループ管理からのソフト遷移で
// /admin/quest-groups/[groupId]/members/add をこのモーダルに差し込む。直アクセス/リロードは対応フルページ。
// 追加ごとに MemberAddPanel が GROUP_MEMBERS_CHANGED_EVENT を発火（背景の一覧が購読して再取得）。
import { useParams } from "next/navigation";

import { RouteModal } from "@/components/ui";
import { MemberAddPanel } from "@/features/qgadmin";

export default function MemberAddModal() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <RouteModal title="メンバーを追加" size="md">
      {(close) => <MemberAddPanel groupId={groupId} onClose={close} />}
    </RouteModal>
  );
}
