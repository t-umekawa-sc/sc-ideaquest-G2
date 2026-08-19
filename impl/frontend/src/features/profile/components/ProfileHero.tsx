// SC-03 上部「3Dアバター表示グループ」（読取）＝ゲーム風パネル(pixel-panel)内に置く presentational。
// 表示名/ロール/残高はサーバ側 GET /me（親 page）から受け取る（編集後は router.refresh() で追従）。
// 3D アバター（VRM）は読取表示＝着せ替えは SC-31。残高は表示のみ（canonical は G の activities）。
import Link from "next/link";

import "../profile.css";

const ROLE_LABEL: Record<string, string> = {
  general: "一般",
  company_account_admin: "会社アカウント管理者",
  system_admin: "システム管理者",
};

type Balance = {
  level: number; xpPct: number; xpToNext: number;
  xpInLevel: number; levelSpan: number; xp: number;
  coin: number; sp: number;
};

export function ProfileHero({
  displayName, systemRole, balance,
}: { displayName: string; systemRole: string; balance: Balance }) {
  const roleLabel = ROLE_LABEL[systemRole] ?? systemRole;
  return (
    <div className="prof-head">
      <div className="avatar3d">
        <span className="avatar3d__tag">3D アバター</span>
        {/* 3D アバターは読取表示（本番は three-vrm/R3F）＝着せ替えは SC-31。素の img で描画。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="avatar3d__img" src="/assets/mascot-hero.png" alt="あなたの3Dアバター" />
      </div>
      <div className="prof-head__body">
        <div className="prof-head__name">{displayName}</div>
        <div className="prof-head__role"><span className="badge badge-muted" title="システムロール">{roleLabel}</span></div>
        <div className="prof-stats">
          <div className="prof-stats__line">
            <span className="pixel-stat level">Lv.{balance.level}</span>
            {/* XPバー＝ホバー/フォーカスで獲得XPのツールチップ（SC-01 ダッシュボードと同一・共通様式）。 */}
            <div
              className="xp-bar-wrap has-tip"
              role="img"
              tabIndex={0}
              data-tip={`獲得 XP ${balance.xpInLevel} / ${balance.levelSpan}（累計 ${balance.xp}）`}
              aria-label={`獲得 XP ${balance.xpInLevel} / ${balance.levelSpan}、累計 ${balance.xp}`}
            >
              <div className="xp-bar"><span style={{ width: `${balance.xpPct}%` }} /></div>
            </div>
            <span className="prof-stats__next">NEXT {balance.xpToNext} XP</span>
          </div>
          <div className="prof-stats__line">
            <span className="pixel-stat coin">◆ {balance.coin} コイン</span>
            <span className="pixel-stat skill">✦ SP {balance.sp}</span>
          </div>
        </div>
        <div className="prof-head__actions">
          <Link className="btn btn-outline btn-sm" href="/avatar">▶ きせかえ（装備を変更）</Link>
          <Link className="btn btn-outline btn-sm" href="/shop">🛒 ショップ</Link>
        </div>
      </div>
    </div>
  );
}
