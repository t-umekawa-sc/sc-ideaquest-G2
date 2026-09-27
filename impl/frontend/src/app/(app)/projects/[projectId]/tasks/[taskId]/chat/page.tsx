// タスクチャット（FR-43・Q.4）＝共有 IdeaChatView をタスク source で駆動＝アイデア/コンセプトチャットと同一 UI。
// 正＝doc/画面設計/screens/SC-71_プロジェクト詳細.md §4.4。session ガードのみ。
import { redirect } from "next/navigation";

import { TaskChatView } from "@/features/projects/components/TaskChatView";
import { getServerSession } from "@/lib/session";

export default async function TaskChatPage({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId, taskId } = await params;
  return <TaskChatView projectId={projectId} taskId={taskId} />;
}
