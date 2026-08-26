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
  id: string; title: string; quest: { id: string; title: string };
  poster: { name: string; avatar: string | null }; value: string;
  vote_summary: VoteSummary; deadline: string | null;
};

export type FollowedIdea = {
  id: string; title: string; quest: { id: string; title: string; quest_status: string | null };
  poster: { name: string; avatar: string | null }; value: string;
  vote_summary: VoteSummary; updated_at: string | null; following: boolean;
};

export type QuestCard = {
  id: string; title: string; color?: string; status: string; categories?: string[];
  deadline?: string | null; member_count?: number; idea_count?: number;
  owner?: { name?: string } | null; my_state?: string;
};

export type RankRow = { rank: number; user: { id: string; name: string; avatar?: string | null; level?: number }; score: number; xp: number; coin: number };
export type WeeklyRanking = { data: RankRow[]; me: { rank: number | null; score: number; xp: number; coin: number; total_users: number } };

export type DashboardData = {
  hero: DashHero | null;
  drafts: Draft[];
  unvoted_ideas: UnvotedIdea[];
  quests: QuestCard[];
  followed_ideas: FollowedIdea[];
  weekly_ranking: WeeklyRanking | null;
  notifications: { data: NotificationDTO[]; unread_count: number } | null;
  roles: { is_qg_admin: boolean; is_company_account_admin: boolean; is_system_admin: boolean };
  login_bonus: { xp: number } | null;
};

export function getDashboard(): Promise<DashboardData | null> {
  return apiFetch<DashboardData>("/dashboard");
}
