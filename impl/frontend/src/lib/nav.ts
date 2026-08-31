// 一覧→詳細→戻る の共通「一覧へ戻る」操作（デザイン標準 §4.5 ⑨・line 191）。
// 一覧は検索/ソート/絞込/ページを URL クエリに持つため、履歴を戻す（router.back）と
// 絞込・ページ・スクロール位置ごと元の一覧に復帰する。直接アクセス（履歴なし）は
// 素の一覧 href へフォールバック。client/server どちらの一覧モードでも同一挙動。
// useRouter() の戻り値（back/push を持つ）をそのまま渡せる構造的型で受ける。
type BackRouter = { back: () => void; push: (href: string) => void };

export function backToListOr(router: BackRouter, fallbackHref: string): void {
  if (typeof window !== "undefined" && window.history.length > 1) router.back();
  else router.push(fallbackHref);
}

// アイデア詳細の戻るラベルを文脈で出し分けるためのワンショット来歴（sessionStorage）。
// クエストのアイデア一覧から詳細へドリルインした時だけ「← {クエスト名}へ戻る」にし、
// それ以外（ダッシュボードの評価下書き経由・チャット・直リンク等）は「← 戻る」にする。
// 戻る動作自体は常に router.back()（backToListOr）＝ラベルは戻り先の見た目上のヒント。
const IDEA_FROM_QUEST_KEY = "iq_idea_from_quest";

export function markIdeaFromQuest(questId: string): void {
  try { sessionStorage.setItem(IDEA_FROM_QUEST_KEY, questId); } catch { /* SSR/未対応環境は無視 */ }
}

// マウント時に1回だけ読んで消費する（残すと次の別経由で誤ってクエスト名が出るため one-shot）。
export function consumeIdeaFromQuest(): string | null {
  try {
    const v = sessionStorage.getItem(IDEA_FROM_QUEST_KEY);
    if (v != null) sessionStorage.removeItem(IDEA_FROM_QUEST_KEY);
    return v;
  } catch { return null; }
}
