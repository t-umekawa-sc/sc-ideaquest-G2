// アクティビティフィード（FR-36・G.5.1）＝クエスト内(SC-12)/チーム(SC-01)。他者フィードは公開種別のみ（サーバー強制）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type FeedActivity = components["schemas"]["FeedActivityDTO"];
export type QuestFeed = components["schemas"]["QuestFeedResponse"];
export type TeamFeed = components["schemas"]["TeamFeedResponse"];

const q = (cursor?: string | null) => (cursor ? `?limit=8&cursor=${encodeURIComponent(cursor)}` : "?limit=8");

// クエスト内フィード（SC-12・門番＝パーティー所属）。
export function getQuestActivities(questId: string, cursor?: string | null): Promise<QuestFeed | null> {
  return apiFetch<QuestFeed>(`/quests/${questId}/activities${q(cursor)}`);
}

// チームフィード（SC-01・参加クエスト横断・各行に quest 付き）。
export function getTeamFeed(cursor?: string | null): Promise<TeamFeed | null> {
  return apiFetch<TeamFeed>(`/me/feed${q(cursor)}`);
}
