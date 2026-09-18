"use client";

// 参加リクエストの承認/却下ダイアログ（FR-40・C.9.1）＝SC-12 パーティータブ／SC-01 ダッシュボード／通知リンクの3経路で共有。
// 申請者プロフィール（承認判断材料）＋**対象クエストの概要**（どのクエストの申請か分かるように）＋承諾/拒否。
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Avatar, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
import { QuestIcon } from "@/components/layout";
import { ApiError } from "@/lib/api/client";
import { supportsWebGL } from "@/features/avatar/webgl";
import {
  approveJoinRequest, getJoinRequestProfile, rejectJoinRequest,
  type JoinRequestProfile, type JoinRequestRow,
} from "../api";

// 3Dビューアは WebGL/DOM 依存＝SSR 不可。client でのみ動的ロード（§9.3）。
const AvatarViewer3D = dynamic(() => import("@/features/avatar/components/AvatarViewer3D").then((m) => m.AvatarViewer3D), { ssr: false });

// クエスト概要（どのクエストの申請か・管理者の判断材料）。
export type JoinRequestQuestSummary = {
  title: string; status?: string | null; color?: string | null;
  categories?: string[] | null; deadline?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き", recruiting: "募集中", in_progress: "進行中", evaluating: "評価中", completed: "完了",
};

export function JoinRequestDialog({
  questId, request, quest, groupNames = {}, open, onClose, onClosed, onDecided,
}: {
  questId: string;
  request: JoinRequestRow;
  quest?: JoinRequestQuestSummary | null;
  groupNames?: Record<string, string>;
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
  onDecided?: (userId: string, action: "approve" | "reject") => void;
}) {
  const snackbar = useSnackbar();
  const [profile, setProfile] = useState<JoinRequestProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [webgl, setWebgl] = useState(false);
  useEffect(() => { setWebgl(supportsWebGL()); }, []);

  // 開いたら申請者の判断材料（参加中クエスト/アイデア/チャット＋ゲーム層）を取得。
  useEffect(() => {
    if (!open) return;
    setProfile(null);
    void getJoinRequestProfile(questId, request.user.user_id).then(setProfile).catch(() => setProfile(null));
  }, [open, questId, request.user.user_id]);

  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      if (action === "approve") await approveJoinRequest(questId, request.user.user_id);
      else await rejectJoinRequest(questId, request.user.user_id);
      onClose();
      snackbar({ type: "success", msg: action === "approve" ? "パーティーに追加しました。" : "参加リクエストを却下しました。" });
      onDecided?.(request.user.user_id, action);
    } catch (err) {
      snackbar({
        type: "error",
        title: action === "approve" ? "承諾できませんでした" : "却下できませんでした",
        msg: err instanceof ApiError && err.status === 403 ? "権限がありません。" : "時間をおいて再度お試しください。",
      });
    } finally {
      setBusy(false);
    }
  };

  const depts = request.user.group_ids.map((id) => groupNames[id]).filter(Boolean);

  return (
    <Modal open={open} onClose={onClose} onClosed={onClosed} title="参加リクエスト" size="sm">
      <ModalBody>
        {/* 対象クエストの概要（どのクエストへの申請か・管理者の判断材料）＝ダイアログ内コンテンツ標準（囲みなし＋仕切り線）。 */}
        {quest && (
          <div className="dialog-section">
            <div className="dialog-label">対象クエスト</div>
            <div className="dialog-subject">
              <QuestIcon name={quest.title} color={quest.color ?? undefined} size="lg" />
              <div style={{ minWidth: 0 }}>
                <div className="dialog-subject__title">{quest.title}</div>
                <div className="dialog-subject__meta">
                  {quest.status && <span className="badge">{STATUS_LABEL[quest.status] ?? quest.status}</span>}
                  {(quest.categories ?? []).slice(0, 2).map((c) => <span key={c} className="badge badge-muted">{c}</span>)}
                  {quest.deadline && <span className="muted text-xs">⏳ {quest.deadline}</span>}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="dialog-section">
          <div className="dialog-label">申請者</div>
          <div className="dialog-subject">
            <Avatar name={request.user.display_name} imageUrl={request.user.avatar_image_url ?? undefined} size="lg" noTooltip />
            <div style={{ minWidth: 0 }}>
              <div className="dialog-subject__title">{request.user.display_name}</div>
              {depts.length > 0 && (
                <div className="dialog-subject__meta">
                  {depts.map((n) => <span key={n} className="badge badge-muted">{n}</span>)}
                </div>
              )}
              <div className="muted text-sm" style={{ marginTop: 3 }}>申請日: {new Date(request.created_at).toLocaleString("ja-JP")}{request.status === "rejected" && "（却下済み）"}</div>
            </div>
          </div>
        </div>
        {request.message && (
          <div className="dialog-section">
            <div className="dialog-label">希望理由</div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{request.message}</p>
          </div>
        )}
        {/* 承認判断材料（C.9.1）＝中核指標。ゲーム層は viewer のゲームモード ON 時のみ backend が game を返す。 */}
        <div className="dialog-section">
          <div className="dialog-label">これまでの活動</div>
          <dl className="dialog-grid">
            <dt>参加中クエスト</dt><dd>👥 {profile?.active_quest_count ?? "—"}</dd>
            <dt>投稿アイデア</dt><dd>💡 {profile?.published_idea_count ?? "—"}</dd>
            <dt>チャット</dt><dd>💬 {profile?.chat_message_count ?? "—"}</dd>
          </dl>
        </div>
        {profile?.game && (
          <div className="dialog-section">
            <div className="dialog-label join-req-label--center">ゲームプロフィール</div>
            <div className="join-req-game">
              <div className="join-req-game__avatar">
                {webgl
                  ? <AvatarViewer3D base={profile.game.avatar_base === "female" ? "female" : "male"} />
                  : <Avatar name={request.user.display_name} imageUrl={request.user.avatar_image_url ?? undefined} size="lg" noTooltip />}
              </div>
              <div className="join-req-game__badges">
                <span className="badge">Lv.{profile.game.level}</span>
                <span className="badge badge-muted">🏆 {profile.game.rank != null ? `${profile.game.rank}位 / ${profile.game.rank_total}人` : "ランキング圏外"}</span>
                <span className="badge badge-muted">🎖️ 実績 {profile.game.achievement_count}個</span>
              </div>
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        {request.status === "pending" ? (
          <>
            <button type="button" className="btn dialog-close-left" disabled={busy} onClick={onClose}>閉じる</button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => decide("reject")}>拒否</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide("approve")}>承諾</button>
          </>
        ) : (
          <>
            <button type="button" className="btn dialog-close-left" disabled={busy} onClick={onClose}>閉じる</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide("approve")}>承諾（復活）</button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
