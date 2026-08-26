// リアルタイム配信の WS クライアント（単一多重接続・L・§1.12）。
// 同一オリジンの /api/v1/realtime を張り（next rewrite が backend へ WS プロキシ）、Cookie セッションで認証。
// 受信専用＋購読制御のみ（書き込みは REST・L.0）。再接続はバックオフ。真実は REST（配信は速報）。
"use client";

type Envelope = { topic: string; type: string; data: unknown; id?: string };
type Handler = (data: unknown, evt: Envelope) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private typeHandlers = new Map<string, Set<Handler>>();
  private topicHandlers = new Map<string, Set<Handler>>();
  private topics = new Set<string>(); // chat 動的購読（再接続で張り直す）
  private backoff = 1000;
  private shouldRun = false;

  start(): void {
    if (typeof window === "undefined") return;
    this.shouldRun = true;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (typeof window === "undefined" || !this.shouldRun) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/v1/realtime`);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.topics.forEach((t) => this.send({ op: "subscribe", topic: t })); // 再購読
    };
    ws.onmessage = (e) => {
      let m: Envelope & { op?: string };
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.op) return; // 購読制御の ack（subscribed/unsubscribed/error）は無視
      this.typeHandlers.get(m.type)?.forEach((h) => h(m.data, m));
      this.topicHandlers.get(m.topic)?.forEach((h) => h(m.data, m));
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.shouldRun) {
        const delay = this.backoff;
        this.backoff = Math.min(this.backoff * 2, 15000);
        window.setTimeout(() => this.connect(), delay);
      }
    };
    ws.onerror = () => ws.close();
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /** イベント種別（notification.created 等）で購読。返り値で解除。 */
  on(type: string, handler: Handler): () => void {
    const set = this.typeHandlers.get(type) ?? new Set<Handler>();
    set.add(handler);
    this.typeHandlers.set(type, set);
    return () => set.delete(handler);
  }

  /** トピック（chat:{cg}）単位で購読ハンドラを登録。返り値で解除。 */
  onTopic(topic: string, handler: Handler): () => void {
    const set = this.topicHandlers.get(topic) ?? new Set<Handler>();
    set.add(handler);
    this.topicHandlers.set(topic, set);
    return () => set.delete(handler);
  }

  /** chat トピックをサーバーへ購読要求（門番あり・L.2）。 */
  subscribe(topic: string): void {
    this.topics.add(topic);
    this.send({ op: "subscribe", topic });
  }

  unsubscribe(topic: string): void {
    this.topics.delete(topic);
    this.send({ op: "unsubscribe", topic });
  }
}

export const realtime = new RealtimeClient();
