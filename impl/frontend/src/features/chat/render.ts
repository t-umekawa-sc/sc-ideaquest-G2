// チャット本文（PM-JSON）に対する純ロジック（テスト規約 unit 層＝node 環境で単体検証可）。TT5＝TipTap 移行。
//   表示は **サーバの `body_html`**（`pm_to_html` 派生・保存時 `sanitize_pm` 済み）を描画する＝クライアント側の
//   plain→HTML 変換（旧 renderTextHtml）は廃止。mention ノードの直列化は W_リッチテキスト W-TC-006。
//   resolveMentionIds＝PM-JSON の mention ノードを走査し宛先 user_id 群へ（送信用）。番兵 `__all__`（全員）は
//     当該パーティの全メンバーへ展開、個別ノードは attrs.id（=user_id）をそのまま、重複排除（E-TC-230）。
//   pmText＝PM-JSON の平文化（空判定/引用チップ/プレビュー用）。mention は `@label` としてテキスト化。
//   resolveMagic＝魔法リアクションはゲーム層の演出＝game_mode OFF（gameEnabled=false）では null＝非表示（§4.11）。
export type Member = { user_id: string; name: string };

// 全員メンションの番兵 id（決定 2026-09-29／TT5 構造化 2026-10-09）。送信時に全メンバーへ展開する。
export const ALL_MENTION_ID = "__all__";

type PMNode = { type?: string; attrs?: Record<string, unknown> | null; content?: PMNode[]; text?: string };

function walk(node: PMNode | null | undefined, visit: (n: PMNode) => void): void {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

// PM-JSON の mention ノードを走査して宛先 user_id 群へ解決（composer の送信用・重複排除）。
//   番兵 `__all__` は当該パーティの全メンバーへ展開（宛先が明確な一括通知・FR-24／E.6）。
export function resolveMentionIds(doc: unknown, members: Member[]): string[] {
  const ids = new Set<string>();
  walk(doc as PMNode, (n) => {
    if (n.type !== "mention") return;
    const id = n.attrs?.id;
    if (id === ALL_MENTION_ID) members.forEach((m) => ids.add(m.user_id));
    else if (typeof id === "string" && id) ids.add(id);
  });
  return [...ids];
}

// PM-JSON → 平文（空判定・引用チップ・プレビュー用）。mention は `@label` としてテキスト化。
export function pmText(doc: unknown): string {
  const parts: string[] = [];
  walk(doc as PMNode, (n) => {
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    else if (n.type === "mention") parts.push("@" + String(n.attrs?.label ?? ""));
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export type MagicReaction = {
  spell_id: string;
  effect?: string;
  icon?: string;
  actor?: string;
  actor_avatar?: string | null;
  mine?: boolean;
};

export function resolveMagic(reactions: unknown, gameEnabled: boolean): MagicReaction | null {
  if (!gameEnabled) return null;
  return (reactions as { magic?: MagicReaction } | null | undefined)?.magic ?? null;
}
