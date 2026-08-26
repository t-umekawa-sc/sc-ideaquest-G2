// 全文検索 API（J・GET /quests/{id}/search）。SC-12 全文検索タブ。
import { apiFetch } from "@/lib/api/client";

export type SearchType = "idea" | "chat" | "attachment";

export type SearchRow = {
  type: SearchType;
  field: string;
  quest: { id: string; title: string };
  idea_id: string | null;
  idea_title: string | null;
  chat_message_id: string | null;
  attachment_id: string | null;
  snippet_html: string;
  score: number;
  target: string;
};

export type SearchResult = {
  data: SearchRow[];
  page_info: { total: number; page: number; per_page: number };
};

export function searchQuest(
  questId: string,
  { q, types, page = 1, perPage = 20 }: { q: string; types?: SearchType; page?: number; perPage?: number },
): Promise<SearchResult | null> {
  const p = new URLSearchParams({ q, page: String(page), per_page: String(perPage) });
  if (types) p.set("types", types);
  return apiFetch<SearchResult>(`/quests/${questId}/search?${p.toString()}`);
}
