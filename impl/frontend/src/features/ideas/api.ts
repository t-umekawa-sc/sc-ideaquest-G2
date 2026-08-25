// ideas 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/D_アイデア・添付・版・投票・フォロー.md D.1〜D.6。
// backend は CRUD＋公開の 6 EP（一覧/詳細/作成/編集/公開/削除）＋投票 POST/DELETE（D.5）＋フォロー POST/DELETE（D.6）。添付（D.3）は後続スライス。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type IdeaCard = components["schemas"]["IdeaCardDTO"];
export type IdeaListResponse = components["schemas"]["IdeaListResponse"];
export type IdeaDetail = components["schemas"]["IdeaDetailDTO"];
export type IdeaCreateInput = components["schemas"]["IdeaCreateRequest"];
export type IdeaUpdateInput = components["schemas"]["IdeaUpdateRequest"];
export type IdeaPublishInput = components["schemas"]["IdeaPublishRequest"];
export type IdeaStakeholderInput = components["schemas"]["IdeaStakeholderInput"];
export type IdeaVoteType = components["schemas"]["IdeaVoteRequest"]["type"];
export type IdeaVoteResult = components["schemas"]["IdeaVoteResponse"];
export type IdeaAttachment = components["schemas"]["IdeaAttachmentDTO"];
export type IdeaAttachmentsResult = components["schemas"]["IdeaAttachmentsResponse"];
export type IdeaRevision = components["schemas"]["IdeaRevisionDTO"];
export type IdeaRevisionListResponse = components["schemas"]["IdeaRevisionListResponse"];
export type IdeaRevisionDiff = components["schemas"]["IdeaRevisionDiffResponse"];
export type IdeaDiffField = components["schemas"]["IdeaDiffField"];
export type IdeaDiffSegment = components["schemas"]["IdeaDiffSegment"];

// アイデアの変更（作成/公開/編集/削除）通知イベント名。URL モーダル（別ルート）からの成功時に window へ発火し、
// クエスト詳細のアイデアタブ（QuestDetailView）が購読して再取得する（跨ルートの疎結合ブリッジ・QUESTS_CHANGED と同方式）。
export const IDEAS_CHANGED_EVENT = "ideaquest:ideas-changed";

// クエストのアイデア一覧（SC-12 アイデアタブ・D.1）。可視性＝公開＋自分の下書き（サーバー強制）。
// 本スライスはクライアント一覧（モック整合）に載せるため limit を大きめに1ページ取得（カーソルは後続）。
export function listIdeas(
  questId: string,
  params?: { limit?: number; cursor?: string },
): Promise<IdeaListResponse | null> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params?.limit ?? 100));
  if (params?.cursor) qs.set("cursor", params.cursor);
  return apiFetch<IdeaListResponse>(`/quests/${questId}/ideas?${qs.toString()}`);
}

// アイデア詳細（SC-22 表示／SC-21 編集プリフィル・D.1）。可視性はサーバー強制（範囲外は 404）。
export function getIdea(ideaId: string): Promise<IdeaDetail | null> {
  return apiFetch<IdeaDetail>(`/ideas/${ideaId}`);
}

// アイデア作成（SC-21・D.2）。status=published は即公開（strict 検証＋パーティー通知＋チャット作成・XP は G 依存で no-op）。
// status=draft は本人のみ表示（loose 検証）。作成者＝author。
export function createIdea(questId: string, input: IdeaCreateInput): Promise<IdeaDetail | null> {
  return apiFetch<IdeaDetail>(`/quests/${questId}/ideas`, { method: "POST", body: JSON.stringify(input) });
}

// アイデア編集（SC-21/SC-22・D.2）。差分＝送るフィールドのみ。公開中の編集は版を記録し投票者/フォロワーに通知（H は no-op）。
export function updateIdea(ideaId: string, input: IdeaUpdateInput): Promise<IdeaDetail | null> {
  return apiFetch<IdeaDetail>(`/ideas/${ideaId}`, { method: "PATCH", body: JSON.stringify(input) });
}

// 下書きを公開（draft→published・D.2・アトミック）。作成者のみ・strict 検証。任意で内容も同時更新可。
export function publishIdea(ideaId: string, input: IdeaPublishInput = {}): Promise<IdeaDetail | null> {
  return apiFetch<IdeaDetail>(`/ideas/${ideaId}/publish`, { method: "POST", body: JSON.stringify(input) });
}

// アイデアを論理削除（SC-22・D.2・作成者/クエスト管理者）。子データは監査保持。
export function deleteIdea(ideaId: string): Promise<null> {
  return apiFetch<null>(`/ideas/${ideaId}`, { method: "DELETE" }) as Promise<null>;
}

// 投票を登録/切替（SC-22 右レール・D.5・vote 権限・1人1票 upsert）。締切後/completed/下書きは 409・権限なしは 403。
// 応答＝更新後の集計（my_vote/summary/xp_awarded）。可否はサーバー権威（フロントは 409/403 で理由提示＋ロールバック）。
export function voteIdea(ideaId: string, type: IdeaVoteType): Promise<IdeaVoteResult | null> {
  return apiFetch<IdeaVoteResult>(`/ideas/${ideaId}/vote`, { method: "POST", body: JSON.stringify({ type }) });
}

// 投票を取消（D.5・冪等・XP は戻さない）。completed は 409。
export function removeVote(ideaId: string): Promise<null> {
  return apiFetch<null>(`/ideas/${ideaId}/vote`, { method: "DELETE" }) as Promise<null>;
}

// アイデアをフォロー（SC-22・D.6・冪等・パーティー所属）。completed 後の新規は 409。
export function followIdea(ideaId: string): Promise<null> {
  return apiFetch<null>(`/ideas/${ideaId}/follow`, { method: "POST" }) as Promise<null>;
}

// フォロー解除（D.6・冪等・completed 後も可）。
export function unfollowIdea(ideaId: string): Promise<null> {
  return apiFetch<null>(`/ideas/${ideaId}/follow`, { method: "DELETE" }) as Promise<null>;
}

// 添付を追加（SC-21/SC-22・D.3・multipart）。検証はサーバー強制（20MB/10件/MIME allowlist）。
// FormData は Content-Type をブラウザに任せる（apiFetch が boundary 自動付与）。
export function uploadAttachments(ideaId: string, files: File[]): Promise<IdeaAttachmentsResult | null> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  return apiFetch<IdeaAttachmentsResult>(`/ideas/${ideaId}/attachments`, { method: "POST", body: fd });
}

// 添付を削除（D.3・編集権限・完了は 409）。
export function deleteAttachment(ideaId: string, attachmentId: string): Promise<null> {
  return apiFetch<null>(`/ideas/${ideaId}/attachments/${attachmentId}`, { method: "DELETE" }) as Promise<null>;
}

// 添付ダウンロード（D.3・§1.10）＝権限検証後の短TTL 署名URL を取得。呼び出し側で window.open 等。
export function getAttachmentDownloadUrl(attachmentId: string): Promise<{ url: string } | null> {
  return apiFetch<{ url: string }>(`/attachments/${attachmentId}/download`);
}

// 版タイムライン（SC-22 更新履歴モーダル・D.4）。新しい順・可視性はサーバー強制（範囲外は 404）。
export function getRevisions(
  ideaId: string,
  params?: { limit?: number; cursor?: string },
): Promise<IdeaRevisionListResponse | null> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params?.limit ?? 50));
  if (params?.cursor) qs.set("cursor", params.cursor);
  return apiFetch<IdeaRevisionListResponse>(`/ideas/${ideaId}/revisions?${qs.toString()}`);
}

// 版差分（SC-22・D.4）。既定＝前版比較／from で比較元を指定（投票時点からの差分）。サーバーが2版を比較して算出。
export function getRevisionDiff(
  ideaId: string,
  revision: number,
  params?: { from?: number },
): Promise<IdeaRevisionDiff | null> {
  const qs = new URLSearchParams();
  if (params?.from !== undefined) qs.set("from", String(params.from));
  const query = qs.toString();
  return apiFetch<IdeaRevisionDiff>(`/ideas/${ideaId}/revisions/${revision}/diff${query ? `?${query}` : ""}`);
}
