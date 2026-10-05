// SC-95 お知らせ詳細（全社閲覧・ドメイン U・FR-49）。開くと既読化（U.1）。
import { redirect } from "next/navigation";

import { AnnouncementDetailView } from "@/features/announcements";
import { getServerSession } from "@/lib/session";

export default async function AnnouncementDetailPage({ params }: { params: Promise<{ announcementId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { announcementId } = await params;
  return <AnnouncementDetailView announcementId={announcementId} />;
}
