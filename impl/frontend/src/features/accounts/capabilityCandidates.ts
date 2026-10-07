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
  opts: { holderIds: Set<string>; q: string; groupIds: string[] },
): T[] {
  const needle = opts.q.trim().toLowerCase();
  const groups = opts.groupIds;
  return accounts.filter(
    (a) =>
      a.status === "active" &&
      !opts.holderIds.has(a.account_id) &&
      (!needle || `${a.display_name} ${a.login_id}`.toLowerCase().includes(needle)) &&
      // クエストグループ絞り込み＝未選択なら全件・選択ありは「いずれかに所属」(OR・複数選択=和集合)。
      (groups.length === 0 || (a.memberships ?? []).some((m) => groups.includes(m.group_id))),
  );
}
