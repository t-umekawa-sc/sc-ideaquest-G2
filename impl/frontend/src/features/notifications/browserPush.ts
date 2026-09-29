// ブラウザ通知 Tier1（前景・Web Notifications API）＝宛先が明確な通知（メンション・参加リクエスト等）の
// 気づきを高める（決定 2026-09-29・FR-24／L）。有効化はデバイス単位（ブラウザ許可＋localStorage フラグ）＝
// backend 変更なし。発火はタブ非アクティブ時（document.hidden）のみ・ゲーム層の自己報酬は除外。
// 発火可否（shouldBrowserNotify）は純ロジックとして分離し unit 検証（H-TC-301）。DOM/Notification/localStorage は
// 薄いアダプタ（enable/permission/maybeBrowserNotify）に隔離（e2e/手動検証）。Tier2（Web Push）はバックログ O3。

export const BROWSER_NOTIFY_KEY = "iq_browser_notify";
// OS 通知を出さない通知種別＝ゲーム層の自己報酬（対人性が薄くノイズになりやすい・§4.11 と整合）。
export const BROWSER_NOTIFY_EXCLUDE = new Set<string>(["achievement", "magic_reaction"]);

export type BrowserNotifyData = {
  type?: string;
  body?: string;
  context?: string | null;
  icon?: string | null;
  tag?: string | null;
};

export type NotifyEnv = {
  supported: boolean; // "Notification" in window
  permission: NotificationPermission; // granted / denied / default
  enabled: boolean; // localStorage の有効フラグ（デバイス単位）
  hidden: boolean; // document.hidden（タブ非アクティブ）
};

/** OS 通知を発火するか（純ゲート・テスト対象 H-TC-301）。全条件を満たす時のみ true。 */
export function shouldBrowserNotify(data: BrowserNotifyData, env: NotifyEnv): boolean {
  if (!env.supported || env.permission !== "granted" || !env.enabled) return false;
  if (!env.hidden) return false; // 前景では出さない（ベルで十分・ノイズ回避・決定 2026-09-29）
  if (data.type && BROWSER_NOTIFY_EXCLUDE.has(data.type)) return false; // ゲーム層の自己報酬は除外
  if (!data.body) return false; // 表示本文が無ければ出さない
  return true;
}

// ---- DOM/ブラウザ API アダプタ（SSR/未対応で安全に no-op） ----

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // プライベートモード等で例外になりうる
  }
}

export function browserNotifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function browserNotifyPermission(): NotificationPermission {
  return browserNotifySupported() ? Notification.permission : "denied";
}

export function browserNotifyEnabled(): boolean {
  return safeLocalStorage()?.getItem(BROWSER_NOTIFY_KEY) === "1";
}

export function setBrowserNotifyEnabled(on: boolean): void {
  safeLocalStorage()?.setItem(BROWSER_NOTIFY_KEY, on ? "1" : "0");
}

/** SC-02 のトグルから呼ぶ＝許可を要求し、granted なら有効フラグを立てる。結果の permission を返す。 */
export async function enableBrowserNotifications(): Promise<NotificationPermission> {
  if (!browserNotifySupported()) return "denied";
  let p = Notification.permission;
  if (p === "default") p = await Notification.requestPermission();
  if (p === "granted") setBrowserNotifyEnabled(true);
  return p;
}

function currentEnv(): NotifyEnv {
  return {
    supported: browserNotifySupported(),
    permission: browserNotifyPermission(),
    enabled: browserNotifyEnabled(),
    hidden: typeof document !== "undefined" ? document.hidden : false,
  };
}

/** 通知受信時に OS 通知を出す（発火可否は shouldBrowserNotify）。クリックで window をフォーカスし href へ遷移。 */
export function maybeBrowserNotify(data: BrowserNotifyData, href?: string | null): void {
  if (!shouldBrowserNotify(data, currentEnv())) return;
  try {
    // icon（data.icon）は絵文字/名称でURLでない場合があるため使わない（壊れアイコン回避）。tag で同種を折り畳む。
    const n = new Notification(data.body || "新しい通知", {
      body: data.context || undefined,
      tag: data.tag || undefined,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* noop */
      }
      if (href) window.location.href = href;
      n.close();
    };
  } catch {
    /* 発火失敗は非致命（許可取消し等） */
  }
}
