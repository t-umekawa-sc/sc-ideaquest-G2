"use client";

// 通知のリアルタイム文脈（ヘッダーベルの未読数）。WS で notification.created / notification.unread_count を
// 受けて即時更新（L・§1.12）。初期値は getUnreadCount で seed。真実は REST（配信は速報）。
import { createContext, useContext, useEffect, useState } from "react";

import { realtime } from "@/lib/realtime";
import { getUnreadCount, notificationHref, type NotificationDTO } from "./api";
import { maybeBrowserNotify } from "./browserPush";

const UnreadContext = createContext<number | undefined>(undefined);

/** ヘッダーベル等が未読数を購読する（Provider 配下でのみ数値・外では undefined）。 */
export function useRealtimeUnread(): number | undefined {
  return useContext(UnreadContext);
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    void getUnreadCount().then((r) => { if (alive && r) setUnread(r.unread_count); }); // 初期 seed
    realtime.start();
    const offs = [
      realtime.on("notification.created", (d) => {
        const u = (d as { unread_count?: number }).unread_count;
        setUnread((cur) => (typeof u === "number" ? u : cur + 1));
        // ブラウザ通知 Tier1（前景）＝タブ非アクティブ時に OS 通知（発火可否は browserPush のゲート）。
        // WS の data は REST 表現（body/context/tag/ref を含む・§8-⑳）＝追加 fetch 不要。遷移先は notificationHref で共有。
        const n = d as NotificationDTO;
        maybeBrowserNotify(n, notificationHref(n));
      }),
      realtime.on("notification.unread_count", (d) => {
        const u = (d as { unread_count?: number }).unread_count;
        if (typeof u === "number") setUnread(u);
      }),
    ];
    return () => { alive = false; offs.forEach((f) => f()); };
  }, []);

  return <UnreadContext.Provider value={unread}>{children}</UnreadContext.Provider>;
}
