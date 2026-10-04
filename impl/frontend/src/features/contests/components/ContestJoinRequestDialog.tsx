"use client";

// アイデアコンテストの参加リクエスト承認/却下ダイアログ（FR-46）＝SC-01 ダッシュボード／SC-54 パーティタブで共有。
// クエストの JoinRequestDialog（C.9.1）に合わせた構成＝上から 対象コンテスト概要／申請者／コンテスト内活動／ゲームプロフィール。
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Avatar, Modal, ModalBody, ModalFooter, useSnackbar } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { supportsWebGL } from "@/features/avatar/webgl";

import {
  decideContestParticipation, getContestParticipantProfile,
  type ContestParticipantProfile,
} from "../api";
import { CONTEST_STATUS_BADGE, contestStatusLabel } from "../types";

// 3Dビューアは WebGL/DOM 依存＝SSR 不可。client でのみ動的ロード（§9.3）。
const AvatarViewer3D = dynamic(() => import("@/features/avatar/components/AvatarViewer3D").then((m) => m.AvatarViewer3D), { ssr: false });

const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");

// 申請者（ダッシュボード/パーティタブの双方から渡せる最小形）。
export type ContestReqApplicant = {
  user_id: string; display_name: string; avatar_image_url?: string | null;
  created_at?: string | null; status?: string;
};
// 対象コンテストの概要（どのコンテストへの申請か・判断材料）。
export type ContestReqSummary = {
  theme: string; status?: string | null; starts_at?: string | null; ends_at?: string | null;
};

export function ContestJoinRequestDialog({
  contestId, request, contest, open, onClose, onClosed, onDecided,
}: {
  contestId: string;
  request: ContestReqApplicant;
  contest: ContestReqSummary;
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
  onDecided?: (userId: string, action: "approve" | "reject") => void;
}) {
  const snackbar = useSnackbar();
  const [profile, setProfile] = useState<ContestParticipantProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [webgl, setWebgl] = useState(false);
  useEffect(() => { setWebgl(supportsWebGL()); }, []);

  // 開いたら判断材料（このコンテスト内の活動＋ゲーム層）を取得。
  useEffect(() => {
    if (!open) return;
    setProfile(null);
    void getContestParticipantProfile(contestId, request.user_id).then(setProfile).catch(() => setProfile(null));
  }, [open, contestId, request.user_id]);

  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      const r = await decideContestParticipation(contestId, request.user_id, action === "approve" ? "approved" : "rejected");
      if (!r) { snackbar({ type: "error", title: action === "approve" ? "承認できませんでした" : "却下できませんでした", msg: "権限が必要です。" }); return; }
      onClose();
      snackbar({ type: "success", msg: action === "approve" ? "参加を承認しました。" : "参加を却下しました。" });
      onDecided?.(request.user_id, action);
    } catch (err) {
      snackbar({
        type: "error",
        title: action === "approve" ? "承認できませんでした" : "却下できませんでした",
        msg: err instanceof ApiError && err.status === 403 ? "権限がありません。" : "時間をおいて再度お試しください。",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} onClosed={onClosed} title="参加リクエスト" size="sm">
      <ModalBody>
        {/* ① 対象アイデアコンテストの概要（どのコンテストへの申請か・判断材料）。 */}
        <div className="dialog-section">
          <div className="dialog-label">対象アイデアコンテスト</div>
          <div className="dialog-subject">
            <div style={{ minWidth: 0 }}>
              <div className="dialog-subject__title">🏆 {contest.theme}</div>
              <div className="dialog-subject__meta">
                {contest.status && <span className={`badge ${CONTEST_STATUS_BADGE[contest.status] ?? "badge-muted"}`}>{contestStatusLabel(contest.status)}</span>}
                <span className="muted text-xs">⏳ {fmtDate(contest.starts_at)} 〜 {fmtDate(contest.ends_at)}</span>
              </div>
            </div>
          </div>
        </div>
        {/* ② 申請者の情報。 */}
        <div className="dialog-section">
          <div className="dialog-label">申請者</div>
          <div className="dialog-subject">
            <Avatar name={request.display_name} imageUrl={request.avatar_image_url ?? undefined} size="lg" noTooltip />
            <div style={{ minWidth: 0 }}>
              <div className="dialog-subject__title">{request.display_name}</div>
              {request.created_at && (
                <div className="muted text-sm" style={{ marginTop: 3 }}>
                  申請日: {new Date(request.created_at).toLocaleString("ja-JP")}{request.status === "rejected" && "（却下済み）"}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* ③ これまでのアイデアコンテスト内の活動。 */}
        <div className="dialog-section">
          <div className="dialog-label">このコンテスト内の活動</div>
          <dl className="dialog-grid">
            <dt>投稿アイデア</dt><dd>💡 {profile?.posted_idea_count ?? "—"}</dd>
            <dt>投票</dt><dd>🗳️ {profile?.vote_count ?? "—"}</dd>
            <dt>チャット</dt><dd>💬 {profile?.chat_message_count ?? "—"}</dd>
          </dl>
        </div>
        {/* ④ ゲームプロフィール（viewer のゲームモード ON 時のみ backend が game を返す）。 */}
        {profile?.game && (
          <div className="dialog-section">
            <div className="dialog-label join-req-label--center">ゲームプロフィール</div>
            <div className="join-req-game">
              <div className="join-req-game__avatar">
                {webgl
                  ? <AvatarViewer3D base={profile.game.avatar_base === "female" ? "female" : "male"} />
                  : <Avatar name={request.display_name} imageUrl={request.avatar_image_url ?? undefined} size="lg" noTooltip />}
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
        {request.status === "rejected" ? (
          <>
            <button type="button" className="btn btn-outline dialog-close-left" disabled={busy} onClick={onClose}>閉じる</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide("approve")}>承認（再承認）</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-outline dialog-close-left" disabled={busy} onClick={onClose}>閉じる</button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => decide("reject")}>却下</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide("approve")}>承認</button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
