"use client";

// SC-04 AIジョブ詳細のモーダルラッパ。intercept（一覧からのソフト遷移）＝RouteModal／
// standalone（直アクセス/リロード）＝Modal。中身は AiJobDetailPanel（読み取り専用）。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal, RouteModal } from "@/components/ui";

import { AiJobDetailPanel } from "./AiJobDetailPanel";

export function AiJobDetailModal({ jobId, standalone }: { jobId: string; standalone?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);
  const back = () => router.push("/ai-jobs");
  const title = "AI処理の詳細";

  if (standalone) {
    return (
      <Modal open={open} title={title} size="lg" onClose={() => setOpen(false)} onClosed={back}>
        <AiJobDetailPanel jobId={jobId} onClose={() => setOpen(false)} />
      </Modal>
    );
  }
  return (
    <RouteModal title={title} size="lg">
      {(close) => <AiJobDetailPanel jobId={jobId} onClose={close} />}
    </RouteModal>
  );
}
