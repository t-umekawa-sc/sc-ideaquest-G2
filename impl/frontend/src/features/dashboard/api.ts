// SC-01 ダッシュボード集約 API（I.1・GET /dashboard）。読取合成の殻＝1往復で全パネル。
import { apiFetch } from "@/lib/api/client";
import type { NotificationDTO } from "@/features/notifications/api";

export type VoteSummary = { approve: number; oppose: number };

export type DashHero = {
  id: string; display_name: string; locale: string; avatar_image_url: string | null;
  level: number; xp: number; xp_to_next: number; level_span: number;
  coin_balance: number; skill_point_balance: number;
};

export type DraftQuest = { kind: "quest"; quest_id: string; title: string; categories: string[]; deadline: string | null };
export type DraftIdea = { kind: "idea"; idea_id: string; title: string; quest: { id: string; title: string }; updated_at: string | null };
export type DraftEval = { kind: "evaluation"; idea: { id: string; title: string }; quest: { id: string; title: string } | null; progress: { scored: number; total: number } };
export type Draft = DraftQuest | DraftIdea | DraftEval;

export type UnvotedIdea = {
  id: string; title: string; quest: { id: string; title: string; color?: string | null };
  poster: { name: string; avatar: string | null }; value: string;
  icon_image_url?: string | null;
  vote_summary: VoteSummary; deadline: string | null;
};

export type FollowedIdea = {
  id: string; title: string; quest: { id: string; title: string; quest_status: string | null; color?: string | null };
  poster: { name: string; avatar: string | null }; value: string;
  icon_image_url?: string | null;
  vote_summary: VoteSummary; updated_at: string | null; following: boolean;
};

// 💬 新着の議論＝参加クエスト横断で自分の未読チャット（他ユーザー投稿）があるアイデア（レビュー#3）。
// 🕒 最近の議論（recent_chats）＝同じ形だが**未読フィルタなし・更新順**（既読/未読・自分投稿問わず）＝新着とは別動線（SC-01 §4.8c）。
export type UnreadChatIdea = {
  id: string; title: string; quest: { id: string; title: string; color?: string | null };
  poster: { name: string; avatar: string | null };
  unread_chat_count: number; last_chat_at: string | null;
};

export type QuestCard = {
  id: string; title: string; color?: string; status: string; categories?: string[];
  deadline?: string | null; member_count?: number; idea_count?: number;
  owner?: { name?: string } | null; my_state?: string; is_owner?: boolean;
};

// 未処理の受信参加リクエスト（owner/quest_admin・FR-40）＝クエスト概要＋申請者。カードクリックで承認/却下ダイアログ。
export type IncomingJoinRequest = {
  quest: { id: string; title: string; color?: string | null; status?: string | null; categories?: string[] | null; deadline?: string | null };
  user: { user_id: string; display_name: string; avatar_image_url?: string | null };
  message?: string | null;
  created_at?: string | null;
};

// 未処理のコンテスト参加リクエスト（運営・FR-46）＝コンテスト概要＋申請者。カードクリックで承認/却下。
export type IncomingContestRequest = {
  contest: { id: string; theme: string; status?: string | null; starts_at?: string | null; ends_at?: string | null };
  user: { user_id: string; display_name: string; avatar_image_url?: string | null };
  created_at?: string | null;
};

// フォロー中クエスト（§4.6b）／参加リクエスト状況（§4.6c）＝発見カタログのメタカード（my_state 由来・FR-40）。
export type WatchQuestCard = {
  id: string; title: string; purpose?: string | null; color?: string; icon_image_url?: string | null;
  categories?: string[]; status: string; deadline?: string | null;
  member_count?: number; idea_count?: number; my_state?: string;
  owner?: { display_name?: string } | null;
};

// コンテスト一覧カード（contests application `_list_item`・Zone D 募集中／Zone E 参加中・FR-46）。
export type ContestCard = {
  id: string; mode: string; status: string; theme: string; description?: string | null;
  starts_at?: string | null; ends_at?: string | null; created_at?: string | null;
  auto_approve?: boolean; participant_count?: number; my_status?: string;
};

// 運営からのお知らせ（Zone D・FR-49・§4.3a 選別済み最大3）。
export type DashAnnouncement = {
  id: string; title: string; excerpt: string; pinned: boolean; published_at: string | null; is_read: boolean;
};

export type RankRow = { rank: number; user: { id: string; name: string; avatar?: string | null; level?: number }; score: number; xp: number; coin: number };
export type WeeklyRanking = { data: RankRow[]; me: { rank: number | null; score: number; xp: number; coin: number; total_users: number } };

// 📣 チームアクティビティ「活動の活発さ」＝参加クエスト横断の日次活動件数（直近14日・今日含む）＋今週/先週/増減率（SC-01 §4.8b）。
export type TeamActivitySpark = {
  daily: { date: string; count: number }[];
  this_week: number;
  prev_week: number;
  delta_pct: number | null;
};

export type DashboardData = {
  hero: DashHero | null;
  drafts: Draft[];
  unvoted_ideas: UnvotedIdea[];
  quests: QuestCard[];
  followed_ideas: FollowedIdea[];
  unread_chats: UnreadChatIdea[];
  recent_chats: UnreadChatIdea[];  // 🕒 最近の議論（更新順・既読/未読問わず・別動線）
  team_activity_spark: TeamActivitySpark | null;  // 📣 チームアクティビティ 活動の活発さ（SC-01 §4.8b）
  weekly_ranking: WeeklyRanking | null;
  notifications: { data: NotificationDTO[]; unread_count: number } | null;
  roles: { is_qg_admin: boolean; is_company_account_admin: boolean; is_system_admin: boolean };
  login_bonus: { xp: number } | null;
  followed_quests: WatchQuestCard[];  // §4.6b フォロー中のクエスト（非参加・following）
  join_requests: WatchQuestCard[];    // §4.6c 参加リクエスト状況（pending/rejected）
  incoming_join_requests: IncomingJoinRequest[];  // 未処理の受信参加リクエスト（owner/quest_admin）
  incoming_contest_requests: IncomingContestRequest[];  // 未処理のコンテスト参加リクエスト（運営・FR-46）
  recommended_quests: WatchQuestCard[];  // Zone D おすすめのクエスト（発見カタログ my_state=none・再設計§3.1）
  open_contests: ContestCard[];          // Zone D 募集中のコンテスト（open・未参加・FR-46）
  joined_contests: ContestCard[];        // Zone E 参加中のアイデアコンテスト（approved・FR-46）
  requested_contests: ContestCard[];     // Zone E 参加リクエスト中のアイデアコンテスト（requested・FR-46）
  announcements: DashAnnouncement[];     // Zone D 運営からのお知らせ（§4.3a 選別・最大3・FR-49）
  announcements_unread_count: number;    // お知らせ未読数（FR-49）
};

export function getDashboard(): Promise<DashboardData | null> {
  return apiFetch<DashboardData>("/dashboard");
}
