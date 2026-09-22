"use client";

// SC-52 詳細のモーダルラッパ。intercept（一覧からのソフト遷移）＝RouteModal（close で router.back）／
// standalone（直アクセス/リロード＝フルページ）＝Modal（close で /info-items へ）。中身は InfoDetailView 共通。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal, RouteModal, useConfirm } from "@/components/ui";
import { InfoDetailView } from "./InfoDetailView";

// 未保存（dirty）で閉じる時の破棄確認（SC-50 §78・全閉じ経路をガード）。
// ステージした参考資料/編集を黙って破棄しないため、footer「閉じる」・背景・Esc・× の全経路で出す。
const DISCARD_CONFIRM = {
  title: "編集を破棄しますか？",
  msg: "保存していない変更（内容・属性・参考資料の追加/削除）があります。閉じると破棄されます。",
  variant: "danger" as const,
  confirmLabel: "破棄して閉じる",
  cancelLabel: "編集に戻る",
};

export function InfoDetailModal({ infoId, standalone }: { infoId: string; standalone?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  // standalone（フルページ直アクセス）は SSR で open にするとハイドレーション不整合になるため、
  // マウント後にクライアントで開く（初期＝閉じ＝null）。intercept は RouteModal（クライアント遷移）で open。
  const [open, setOpen] = useState(false);
  // dirty 状態は InfoDetailView が持つ（内容/属性/参考資料）＝onDirtyChange で受け取り、閉じるガードで参照する。
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (standalone) setOpen(true); }, [standalone]);

  // 閉じてよいか＝未保存が無い、または破棄確認で「破棄して閉じる」を選んだとき true。
  const guard = async () => !dirty || (await confirm(DISCARD_CONFIRM));

  if (standalone) {
    const requestClose = async () => { if (await guard()) setOpen(false); };
    return (
      <Modal open={open} title="情報の詳細" size="xl" onClose={requestClose} onClosed={() => router.push("/info-items")}>
        {/* onClose＝確定済みの閉じ（保存成功/アーカイブ・ガード無し）／onRequestClose＝footer「閉じる」＝ガード有り。 */}
        <InfoDetailView infoId={infoId} onClose={() => setOpen(false)} onRequestClose={requestClose} onDirtyChange={setDirty} />
      </Modal>
    );
  }
  return (
    // 背景/Esc/× は RouteModal の beforeClose でガード。footer「閉じる」は onRequestClose でガード。
    <RouteModal title="情報の詳細" size="xl" beforeClose={guard}>
      {(close) => (
        <InfoDetailView
          infoId={infoId}
          onClose={close}
          onRequestClose={async () => { if (await guard()) close(); }}
          onDirtyChange={setDirty}
        />
      )}
    </RouteModal>
  );
}
