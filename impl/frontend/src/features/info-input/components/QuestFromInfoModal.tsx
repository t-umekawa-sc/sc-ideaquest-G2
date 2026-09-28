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

  if (standalone) {
    // 直アクセス/リロード（呼び元モーダルが無い）＝閉じアニメ後に情報詳細ページへ戻す（登録系ダイアログ標準
    // ＝作成後は詳細へ遷移せず呼び元へ。intercept の router.back に相当する行き先を明示する）。
    const requestClose = () => setOpen(false);
    return (
      <Modal open={open} title="この情報からクエストを作成" size="xl"
        onClose={requestClose}
        onClosed={() => router.push(`/info-items/${infoId}`)}>
        <QuestFromInfoPanel infoId={infoId} onCancel={requestClose} onDone={requestClose} />
      </Modal>
    );
  }
  return (
    <RouteModal title="この情報からクエストを作成" size="xl">
      {(close) => <QuestFromInfoPanel infoId={infoId} onCancel={() => close()} onDone={() => close()} />}
    </RouteModal>
  );
}
