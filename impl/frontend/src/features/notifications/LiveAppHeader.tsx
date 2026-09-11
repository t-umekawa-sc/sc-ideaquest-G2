"use client";

// AppHeader（presentational・components）にリアルタイム未読数を供給する薄い client ラッパ（features 層）。
// components→features 依存を作らないため、live 化は features 側で行う（§4.1 一方向依存）。
import { AppHeader } from "@/components/layout";

import { useRealtimeUnread } from "./RealtimeProvider";

type Props = {
  user: { display_name: string; avatar_url?: string | null };
  balance?: { level: number; coin: number; sp: number; xpPct?: number };
  initialUnread?: number;
  gameEnabled?: boolean; // ゲームモード実効値（§4.11・レビュー#2）。AppHeader へ素通し。
  children: React.ReactNode;
};

export function LiveAppHeader({ user, balance, initialUnread = 0, gameEnabled = true, children }: Props) {
  const live = useRealtimeUnread();
  return (
    <AppHeader user={user} balance={balance} unreadCount={live ?? initialUnread} gameEnabled={gameEnabled}>
      {children}
    </AppHeader>
  );
}
