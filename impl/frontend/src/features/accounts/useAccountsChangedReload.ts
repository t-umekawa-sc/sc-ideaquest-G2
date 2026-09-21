"use client";

// アカウント一覧の「変更イベント購読＋再取得」。SC-92/SC-93 で共有（DRY §2.3）。
//
// なぜ follow-up reload が要るか＝所属（memberships）は発行時に会社DB `users` ミラーが未生成のため
// 同期適用できず、outbox ワーカが「users ミラー生成→quest_group_members 適用」を非同期で行う（B.5 step3）。
// 発行直後の即時再取得はワーカ適用前のことがあり所属列が「—」のまま残る。そこで即時に加えて数回だけ
// 遅延再取得して非同期反映に追随する（bounded＝無限ポーリングにしない・管理系で低頻度）。
import { useEffect } from "react";

// 即時（0）＋数回の遅延再取得（ms）。ワーカのパス間隔（sub-second〜数秒）を数回でカバーする。
const FOLLOWUP_DELAYS_MS = [1200, 3000, 6000] as const;

export function useAccountsChangedReload(
  eventName: string,
  reload: (opts?: { silent?: boolean }) => void | Promise<unknown>,
): void {
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // すべて silent＝一覧はすでに表示済み。背後で差し替えるだけにしてローディング切替のチラつき/カクつきを避ける。
    const onChanged = () => {
      void reload({ silent: true });
      for (const t of timers.splice(0)) clearTimeout(t);
      for (const ms of FOLLOWUP_DELAYS_MS) timers.push(setTimeout(() => void reload({ silent: true }), ms));
    };
    window.addEventListener(eventName, onChanged);
    return () => {
      window.removeEventListener(eventName, onChanged);
      for (const t of timers) clearTimeout(t);
    };
  }, [eventName, reload]);
}
