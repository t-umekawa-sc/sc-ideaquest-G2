"use client";

// SC-50「この情報からクエストを作成」のモーダルラッパ。intercept（詳細/一覧からのソフト遷移）＝RouteModal／
// standalone（直アクセス/リロード）＝Modal（マウント後 open）。中身は QuestFromInfoPanel 共通。
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Modal, RouteModal } from "@/components/ui";
import { QuestFromInfoPanel } from "./QuestFromInfoPanel";

export function QuestFromInfoModal({ infoId, standalone }: { infoId: string; standalone?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const nextHref = useRef<string | null>(null); // 作成成功時の遷移先（onClosed で単一遷移＝back との競合回避）
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);

  if (standalone) {
    // 直アクセス/リロード＝閉じアニメ後に nextHref（作成した下書き）へ、無ければ情報一覧へ。
    const requestClose = (to?: string) => { nextHref.current = typeof to === "string" ? to : null; setOpen(false); };
    return (
      <Modal open={open} title="この情報からクエストを作成" size="xl"
        onClose={() => requestClose()}
        onClosed={() => router.push(nextHref.current ?? "/info-items")}>
        <QuestFromInfoPanel infoId={infoId} onCancel={() => requestClose()} onDone={(to) => requestClose(to)} />
      </Modal>
    );
  }
  return (
    <RouteModal title="この情報からクエストを作成" size="xl">
      {(close) => <QuestFromInfoPanel infoId={infoId} onCancel={() => close()} onDone={(to) => close(to)} />}
    </RouteModal>
  );
}
