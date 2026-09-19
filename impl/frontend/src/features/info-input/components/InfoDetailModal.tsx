"use client";

// SC-52 詳細のモーダルラッパ。intercept（一覧からのソフト遷移）＝RouteModal（close で router.back）／
// standalone（直アクセス/リロード＝フルページ）＝Modal（close で /info-items へ）。中身は InfoDetailView 共通。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal, RouteModal } from "@/components/ui";
import { InfoDetailView } from "./InfoDetailView";

export function InfoDetailModal({ infoId, standalone }: { infoId: string; standalone?: boolean }) {
  const router = useRouter();
  // standalone（フルページ直アクセス）は SSR で open にするとハイドレーション不整合になるため、
  // マウント後にクライアントで開く（初期＝閉じ＝null）。intercept は RouteModal（クライアント遷移）で open。
  const [open, setOpen] = useState(false);
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);

  if (standalone) {
    return (
      <Modal open={open} title="情報の詳細" size="xl" onClose={() => setOpen(false)} onClosed={() => router.push("/info-items")}>
        <InfoDetailView infoId={infoId} onClose={() => setOpen(false)} />
      </Modal>
    );
  }
  return (
    <RouteModal title="情報の詳細" size="xl">
      {(close) => <InfoDetailView infoId={infoId} onClose={close} />}
    </RouteModal>
  );
}
