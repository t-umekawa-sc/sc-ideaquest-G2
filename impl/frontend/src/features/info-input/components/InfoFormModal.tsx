"use client";

// SC-51 登録（新規/続報）のモーダルラッパ。intercept（一覧からのソフト遷移）＝RouteModal／
// standalone（直アクセス/リロード）＝Modal（マウント後 open でハイドレーション不整合回避）。中身は InfoFormPanel。
// ※編集は詳細ダイアログ（SC-52）のインライン編集（PATCH）に一本化＝本ラッパは新規/続報のみ。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal, RouteModal } from "@/components/ui";
import { InfoFormPanel } from "./InfoFormPanel";

export function InfoFormModal({ parentId, standalone }: { parentId?: string; standalone?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);
  const title = parentId ? "続報を登録" : "情報を登録";
  const back = () => router.push("/info-items");

  if (standalone) {
    return (
      <Modal open={open} title={title} size="xl" onClose={() => setOpen(false)} onClosed={back}>
        <InfoFormPanel parentId={parentId} onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
      </Modal>
    );
  }
  return (
    <RouteModal title={title} size="xl">
      {(close) => <InfoFormPanel parentId={parentId} onCancel={close} onDone={close} />}
    </RouteModal>
  );
}
