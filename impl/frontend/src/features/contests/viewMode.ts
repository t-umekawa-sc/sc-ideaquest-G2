// SC-54 コンテスト詳細の閲覧モード（⑤ 非参加運営の表示制御・受入指摘）。
// 入力は { can_manage, my_status } のみ＝UI 非依存の純関数（unit テスト可能・描画側はこれを単一ソースに参照＝DRY）。
//
// 背景: 承認制×未参加でも運営（can_manage）は can_view_contest を通り 200＝既に全タブが見える。
// ⑤ は運営の非参加状態に限り「パーティは機能／アイデア・全文検索は中身をガード／
// 特定ユーザが分かるパネル（表彰台・新着議論・活動）は秘匿」に絞る。一般・参加者は現状不変。
export type ContestViewMode = "participant" | "manager-guard" | "invite";
type ContestViewInput = { can_manage: boolean; my_status?: string | null; auto_approve?: boolean | null };

export function contestViewMode(c: ContestViewInput): ContestViewMode {
  if ((c.my_status ?? "none") === "approved") return "participant"; // 参加者＝全表示（運営でも参加なら同じ）
  // ガードは承認制(auto_approve=false)の非参加運営に限定＝中身が参加者限定でプライバシー配慮が要るのはここだけ。
  // auto_approve=true は会社全体に公開＝運営も従来どおり全表示（一般 invite が表彰台を見えるのと逆転させない）。
  if (c.can_manage && !c.auto_approve) return "manager-guard"; // パーティのみ機能・他は秘匿/ガード
  if (c.can_manage) return "participant"; // 公開コンテストの非参加運営＝全表示
  return "invite"; // 非参加の一般（auto_approve 会社内）＝参加の案内のみ（現状不変）
}

export type ContestViewFlags = {
  showTabs: boolean; // タブ列（アイデア/全文検索/パーティ）を出すか＝運営 or 参加者
  showIdentifying: boolean; // 表彰台/新着議論/活動/アクティビティ等「特定ユーザが分かる」パネルを出すか
  guardContent: boolean; // アイデア/全文検索タブの中身をガードメッセージに置換するか
  fetchContent: boolean; // アイデア一覧/ランキング/活動をそもそも取得するか（プライバシー＝クライアントに渡さない）
};

export function contestViewFlags(c: ContestViewInput): ContestViewFlags {
  switch (contestViewMode(c)) {
    case "participant":
      return { showTabs: true, showIdentifying: true, guardContent: false, fetchContent: true };
    case "manager-guard":
      return { showTabs: true, showIdentifying: false, guardContent: true, fetchContent: false };
    case "invite":
      return { showTabs: false, showIdentifying: true, guardContent: false, fetchContent: true };
  }
}
