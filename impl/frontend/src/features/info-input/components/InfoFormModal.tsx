"use client";

// SC-51 登録/編集のモーダルラッパ。intercept（一覧/詳細からのソフト遷移）＝RouteModal／
// standalone（直アクセス/リロード）＝Modal（マウント後 open でハイドレーション不整合回避）。中身は InfoFormPanel 共通。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal, RouteModal } from "@/components/ui";
import { InfoFormPanel } from "./InfoFormPanel";

function titleFor(mode: "new" | "edit", parentId?: string) {
  if (mode === "edit") return "情報を編集";
  return parentId ? "続報を登録" : "情報を登録";
}

export function InfoFormModal({ mode, infoId, parentId, standalone }: {
  mode: "new" | "edit"; infoId?: string; parentId?: string; standalone?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);
  const title = titleFor(mode, parentId);
  const back = () => router.push("/info-items");

  if (standalone) {
    return (
      <Modal open={open} title={title} size="xl" onClose={() => setOpen(false)} onClosed={back}>
        <InfoFormPanel mode={mode} infoId={infoId} parentId={parentId} onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
      </Modal>
    );
  }
  return (
    <RouteModal title={title} size="xl">
      {(close) => <InfoFormPanel mode={mode} infoId={infoId} parentId={parentId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
