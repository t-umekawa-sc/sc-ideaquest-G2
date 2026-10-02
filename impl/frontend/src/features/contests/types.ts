// アイデアコンテスト（SC-53/54・FR-46）の表示ラベル。公開性は会社 access_mode（本機能に visibility は無い）。
export const CONTEST_STATUS_LABEL: Record<string, string> = {
  draft: "準備中",
  open: "公募中",
  judging: "審査中",
  closed: "表彰確定",
  archived: "保管",
};

// 利用可能な badge は muted/success/danger（§デザイン標準）。公募中(open)のみ目立たせる。
export const CONTEST_STATUS_BADGE: Record<string, string> = {
  draft: "badge-muted",
  open: "badge-success",
  judging: "badge-muted",
  closed: "badge-muted",
  archived: "badge-muted",
};

export const CONTEST_MODE_LABEL: Record<string, string> = {
  bounded: "会期型（締切・表彰）",
  rolling: "常設型",
};

// 会期タブ（一覧）＝開催中/予定/終了の括り。status の集合で表現。
export const CONTEST_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "open", label: "公募中", statuses: ["open"] },
  { key: "upcoming", label: "予定", statuses: ["draft"] },
  { key: "judging", label: "審査中", statuses: ["judging"] },
  { key: "closed", label: "終了", statuses: ["closed", "archived"] },
];

export const contestStatusLabel = (s: string) => CONTEST_STATUS_LABEL[s] ?? s;
