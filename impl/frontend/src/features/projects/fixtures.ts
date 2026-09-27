// タスクチャットのデモデータ（試作＝共有 IdeaChatView〔taskSource〕の表示用・backend 未接続スライス）。
// projects/tasks/members は実 API（api.ts）へ結線済み。チャット結線は次スライス（chat_thread owner_type='task'）。
import type { DemoChatMessage } from "./types";

const U = (id: string, name: string) => ({ user_id: id, display_name: name, avatar_image_url: null });

export const DEMO_TASK_CHAT: Record<string, DemoChatMessage[]> = {
  __sample: [
    { id: "m1", author: U("u-inv1", "鈴木（企画）"), domain: "innovation", body: "この画面、企画では『ワンタップ』想定でした。承認は不要では？", at: "2026-09-24T02:00:00Z" },
    { id: "m2", author: U("u-dev1", "田中（開発リード）"), domain: "dev", body: "実装だと修正時に承認が要るケースがあります。ここは仕様確定したいです。", at: "2026-09-24T02:05:00Z" },
    { id: "m3", author: U("u-inv1", "鈴木（企画）"), domain: "innovation", body: "なるほど、修正時のみ承認で合わせましょう。", at: "2026-09-24T02:10:00Z" },
  ],
};
