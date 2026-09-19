"use client";

// SC-50「この情報からクエストを作成」のモーダルラッパ。intercept（詳細/一覧からのソフト遷移）＝RouteModal／
// standalone（直アクセス/リロード）＝Modal（マウント後 open）。中身は QuestFromInfoPanel 共通。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal, RouteModal } from "@/components/ui";
import { QuestFromInfoPanel } from "./QuestFromInfoPanel";

export function QuestFromInfoModal({ infoId, standalone }: { infoId: string; standalone?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);
  const back = () => router.push("/info-items");

  if (standalone) {
    return (
      <Modal open={open} title="この情報からクエストを作成" size="xl" onClose={() => setOpen(false)} onClosed={back}>
        <QuestFromInfoPanel infoId={infoId} onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
      </Modal>
    );
  }
  return (
    <RouteModal title="この情報からクエストを作成" size="xl">
      {(close) => <QuestFromInfoPanel infoId={infoId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
