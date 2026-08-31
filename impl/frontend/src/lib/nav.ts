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

// 評価ダイアログを「アイデア詳細から」開いたことのワンショット来歴。背後がアイデア詳細なら
// 評価モーダルの「アイデア詳細を見る」導線は冗長なので隠すために使う（ダッシュボードの評価下書き
// から開いた時は set しない＝リンクを出す）。マウント時に1回だけ消費する。
const EVAL_FROM_IDEA_KEY = "iq_eval_from_idea";

export function markEvalFromIdea(): void {
  try { sessionStorage.setItem(EVAL_FROM_IDEA_KEY, "1"); } catch { /* SSR/未対応環境は無視 */ }
}

export function consumeEvalFromIdea(): boolean {
  try {
    const v = sessionStorage.getItem(EVAL_FROM_IDEA_KEY);
    if (v != null) sessionStorage.removeItem(EVAL_FROM_IDEA_KEY);
    return v != null;
  } catch { return false; }
}

// クエスト詳細の戻るラベルを文脈で出し分けるワンショット来歴。クエスト一覧(SC-10)から詳細へ来た時だけ
// 「← クエスト一覧へ戻る」、それ以外（ダッシュボード等）は「← 戻る」。戻る動作自体は常に router.back()。
// 一覧→詳細のときだけ set（下書き→編集モーダルでは set しない＝消費されず残るのを防ぐ）。
const QUEST_FROM_LIST_KEY = "iq_quest_from_list";

export function markQuestFromList(): void {
  try { sessionStorage.setItem(QUEST_FROM_LIST_KEY, "1"); } catch { /* SSR/未対応環境は無視 */ }
}

export function consumeQuestFromList(): boolean {
  try {
    const v = sessionStorage.getItem(QUEST_FROM_LIST_KEY);
    if (v != null) sessionStorage.removeItem(QUEST_FROM_LIST_KEY);
    return v != null;
  } catch { return false; }
}
