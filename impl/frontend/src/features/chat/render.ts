// チャット本文の描画とゲーム層ガードの純ロジック（テスト規約 unit 層＝node 環境で単体検証可）。
// IdeaChatView から抽出（受入不具合の回帰テストを単体で捕まえるため・テスト規約 §5.3）。
//   renderTextHtml＝エスケープ→簡易書式（太字/コード/リンク）→@メンション強調。強調するのは
//     members の nospace（display_name の空白除去トークン）に一致した @token のみ（composer 側の
//     抽出＝extractMentionIds と同じ契約）。空白入り「@テスト 太郎」は full name として強調しない。
//   resolveMagic＝魔法リアクションはゲーム層の演出＝game_mode OFF（gameEnabled=false）では null＝表示しない（§4.11）。
export type Member = { user_id: string; name: string; nospace: string };

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
  s = s.replace(/@([^\s@]+)/g, (m, name) => (names.includes(name) ? `<span class="mention">@${name}</span>` : m));
  return s;
}

export function resolveMagic(reactions: unknown, gameEnabled: boolean): MagicReaction | null {
  if (!gameEnabled) return null;
  return (reactions as { magic?: MagicReaction } | null | undefined)?.magic ?? null;
}
