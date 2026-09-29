"use client";

// SC-81 経営資料 登録/編集のモーダルラッパ。intercept（一覧からのソフト遷移）＝RouteModal／
// standalone（直アクセス/リロード）＝Modal。中身は StrategyFormPanel。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal, RouteModal } from "@/components/ui";

import { StrategyFormPanel } from "./StrategyFormPanel";

export function StrategyFormModal({ docId, fromId, standalone }: { docId?: string; fromId?: string; standalone?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);
  const title = docId ? "経営資料を編集" : fromId ? "経営資料を複製" : "経営資料を登録";
  const back = () => router.push("/strategy-documents");

  if (standalone) {
    return (
      <Modal open={open} title={title} size="xl" onClose={() => setOpen(false)} onClosed={back}>
        <StrategyFormPanel docId={docId} fromId={fromId} onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
      </Modal>
    );
  }
  return (
    <RouteModal title={title} size="xl">
      {(close) => <StrategyFormPanel docId={docId} fromId={fromId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
