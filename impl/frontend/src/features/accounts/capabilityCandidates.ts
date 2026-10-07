// 能力付与ダイアログの候補絞り込み（純関数・SC-93 CapabilitiesSection）。
// 有効(active)かつ当該能力を未付与＋氏名/ログインID検索＋クエストグループ所属で絞る（UI 非依存＝unit テスト可能）。
export type CandidateAccount = {
  account_id: string;
  display_name: string;
  login_id: string;
  status: string;
  memberships?: { group_id: string }[] | null;
};

export function filterCapabilityCandidates<T extends CandidateAccount>(
  accounts: T[],
  opts: { holderIds: Set<string>; q: string; groupId: string },
): T[] {
  const needle = opts.q.trim().toLowerCase();
  return accounts.filter(
    (a) =>
      a.status === "active" &&
      !opts.holderIds.has(a.account_id) &&
      (!needle || `${a.display_name} ${a.login_id}`.toLowerCase().includes(needle)) &&
      (!opts.groupId || (a.memberships ?? []).some((m) => m.group_id === opts.groupId)),
  );
}
