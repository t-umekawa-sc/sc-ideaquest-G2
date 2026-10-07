// 能力付与ダイアログの候補絞り込み（純関数・SC-93 CapabilitiesSection）。
// 有効(active)かつ当該能力を未付与＋氏名/ログインID検索＋クエストグループ所属で絞る（UI 非依存＝unit テスト可能）。
export type CandidateAccount = {
  account_id: string;
  display_name: string;
  login_id: string;
  status: string;
  memberships?: { group_id: string }[] | null;
};

// 氏名/ログインID 検索 ＋ クエストグループ所属（複数=OR）の共通述語。
function matchesSearchAndGroup(a: CandidateAccount, needle: string, groupIds: string[]): boolean {
  return (
    (!needle || `${a.display_name} ${a.login_id}`.toLowerCase().includes(needle)) &&
    (groupIds.length === 0 || (a.memberships ?? []).some((m) => groupIds.includes(m.group_id)))
  );
}

export function filterCapabilityCandidates<T extends CandidateAccount>(
  accounts: T[],
  opts: { holderIds: Set<string>; q: string; groupIds: string[] },
): T[] {
  const needle = opts.q.trim().toLowerCase();
  // 付与候補＝active かつ「当該能力を未保持」＋検索/グループ一致。
  return accounts.filter(
    (a) => a.status === "active" && !opts.holderIds.has(a.account_id) && matchesSearchAndGroup(a, needle, opts.groupIds),
  );
}

export function filterRevokeCandidates<T extends CandidateAccount>(
  accounts: T[],
  opts: { heldByAccount: Map<string, Set<string>>; revokeCaps: string[]; q: string; groupIds: string[] },
): T[] {
  const needle = opts.q.trim().toLowerCase();
  // 剥奪候補＝active かつ「選択した権限のいずれかを保持」＋検索/グループ一致（付与の逆）。
  return accounts.filter(
    (a) =>
      a.status === "active" &&
      opts.revokeCaps.some((c) => opts.heldByAccount.get(a.account_id)?.has(c)) &&
      matchesSearchAndGroup(a, needle, opts.groupIds),
  );
}
