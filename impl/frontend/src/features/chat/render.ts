// チャット本文の描画とゲーム層ガードの純ロジック（テスト規約 unit 層＝node 環境で単体検証可）。
// IdeaChatView から抽出（受入不具合の回帰テストを単体で捕まえるため・テスト規約 §5.3）。
//   renderTextHtml＝エスケープ→簡易書式（太字/コード/リンク）→@メンション強調。強調するのは
//     members の nospace（display_name の空白除去トークン）に一致した @token・および全員トークン
//     （@全員/@all）のみ（composer 側の抽出＝resolveMentionIds と同じ契約）。空白入り「@テスト 太郎」は
//     full name として強調しない。
//   resolveMentionIds＝本文の @token を members の user_id 群へ解決（送信用）。@全員/@all は全メンバーへ展開。
//   resolveMagic＝魔法リアクションはゲーム層の演出＝game_mode OFF（gameEnabled=false）では null＝表示しない（§4.11）。
export type Member = { user_id: string; name: string; nospace: string };

// 全員メンションのトークン判定（`@全員`／`@all`・大小無視）。決定 2026-09-29・データモデル §5.17／API E.6。
// 専用マーカーは持たず、送信時に全メンバーの user_id へ展開する（サーバー契約は不変）。
export function isAllMentionToken(token: string): boolean {
  return token === "全員" || token.toLowerCase() === "all";
}

export type MagicReaction = {
  spell_id: string;
  effect?: string;
  icon?: string;
  actor?: string;
  actor_avatar?: string | null;
  mine?: boolean;
};

export function renderTextHtml(raw: string, members: Member[]): string {
  let s = (raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  const names = members.map((m) => m.nospace);
  s = s.replace(/@([^\s@]+)/g, (m, name) => (names.includes(name) || isAllMentionToken(name) ? `<span class="mention">@${name}</span>` : m));
  return s;
}

// 本文の @token を members の user_id 群へ解決（composer の送信用・重複排除）。
//   @全員/@all は当該パーティの全メンバーへ展開する（宛先が明確な一括通知・FR-24／E.6）。
//   個別トークンは nospace 完全一致のみ（renderTextHtml の強調契約と一致）。
export function resolveMentionIds(body: string, members: Member[]): string[] {
  const ids = new Set<string>();
  for (const m of (body || "").matchAll(/@([^\s@]+)/g)) {
    const token = m[1];
    if (isAllMentionToken(token)) {
      members.forEach((mem) => ids.add(mem.user_id));
      continue;
    }
    const mem = members.find((x) => x.nospace === token);
    if (mem) ids.add(mem.user_id);
  }
  return [...ids];
}

export function resolveMagic(reactions: unknown, gameEnabled: boolean): MagicReaction | null {
  if (!gameEnabled) return null;
  return (reactions as { magic?: MagicReaction } | null | undefined)?.magic ?? null;
}
