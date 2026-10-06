"use client";

// AppHeader（presentational・components）にリアルタイム未読数＋AIジョブ active 件数を供給する薄い client ラッパ
// （features 層）。components→features 依存を作らないため、live 化は features 側で行う（§4.1 一方向依存）。
import { useEffect, useState } from "react";

import { AppHeader, type AdminFlags } from "@/components/layout";
import { AI_JOBS_CHANGED_EVENT, fetchAiJobsSummary } from "@/features/ai-jobs";
import { realtime } from "@/lib/realtime";

import { useRealtimeUnread } from "./RealtimeProvider";

type Props = {
  user: { display_name: string; avatar_url?: string | null };
  balance?: { level: number; coin: number; sp: number; xpPct?: number };
  initialUnread?: number;
  gameEnabled?: boolean; // ゲームモード実効値（§4.11・レビュー#2）。AppHeader へ素通し。
  admin?: AdminFlags; // 管理導線（サイドバー）用フラグ。AppHeader へ素通し。
  publicMode?: boolean; // 公開（コンテスト専用）モード（FR-48 §8.0）。AppHeader へ素通し。
  children: React.ReactNode;
};

export function LiveAppHeader({ user, balance, initialUnread = 0, gameEnabled = true, admin, publicMode = false, children }: Props) {
  const live = useRealtimeUnread();
  // AIジョブの自分の active 件数（queued+running）＝ヘッダー導線バッジ用。マウント時取得＋
  // AI_JOBS_CHANGED_EVENT（クライアント操作＝enqueue/cancel）＋WS `ai_job.changed`（投入/開始/完了/
  // キャンセル＝backend 発）で再取得＝**完了でバッジが減る**（L・リロード不要・S.1a）。
  const [aiActive, setAiActive] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchAiJobsSummary().then((s) => { if (alive && s) setAiActive(s.queued + s.running); }).catch(() => {});
    load();
    window.addEventListener(AI_JOBS_CHANGED_EVENT, load);
    realtime.start();
    const off = realtime.on("ai_job.changed", load); // 完了/失敗/開始/投入で再取得（本人スコープ・自動購読）
    return () => { alive = false; window.removeEventListener(AI_JOBS_CHANGED_EVENT, load); off(); };
  }, []);
  return (
    <AppHeader user={user} balance={balance} unreadCount={live ?? initialUnread} aiActive={aiActive} gameEnabled={gameEnabled} admin={admin} publicMode={publicMode}>
      {children}
    </AppHeader>
  );
}
