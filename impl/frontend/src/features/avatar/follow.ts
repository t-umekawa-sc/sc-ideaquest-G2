// マスコット追従アニメ（#20 暫定・ダッシュボード）の実効表示判定＝純ロジック（デザイン標準 §4.9 系）。
// 実効表示 = follow（ユーザー設定 accounts.mascot_follow が ON）AND NOT reduced（実効抑制＝OS reduce OR reduce_motion）。
// **抑制が最優先**＝抑制中は follow=true でも出さない（「動きを減らす」ON なら追従も自動 OFF）。
// UI は本ヘルパで発火可否を判定し matchMedia/設定読み取りを各所に散らさない（DRY・`reduceMotion()` と同流儀）。
export function mascotFollowEffective(reduced: boolean, follow: boolean): boolean {
  return follow && !reduced;
}
