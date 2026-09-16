"use client";

// SC-21 アイデア編集の URL 付きモーダル本体（Intercept 側から使用・クエスト編集モーダルと対称）。
// ダッシュボードの下書きカード等からのソフト遷移で /ideas/[ideaId]/edit をこのモーダルに差し込む
// （背景はダッシュボードのまま＝詳細ページへフル遷移しない）。プリフィルは IdeaForm が取得する。
import { RouteModal } from "@/components/ui";
import type { Locale } from "@/lib/forms/validation";

import { IDEAS_CHANGED_EVENT } from "../api";
import { IdeaForm } from "./IdeaForm";

export function IdeaEditModal({ ideaId, locale = "ja" }: { ideaId: string; locale?: Locale }) {
  return (
    <RouteModal title="アイデアを編集" size="lg">
      {(close) => (
        <IdeaForm
          mode="edit"
          ideaId={ideaId}
          locale={locale}
          onCancel={close}
          onDone={() => {
            window.dispatchEvent(new Event(IDEAS_CHANGED_EVENT));
            close();
          }}
        />
      )}
    </RouteModal>
  );
}
