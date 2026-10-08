import { test, expect } from "./fixtures"; // ワーカ別DB隔離(§4.1)＝専用会社でログイン・DB直操作
import { gotoAuthed, createRecruiting, csrfToken, psql, psqlValue } from "./helpers";

// SC-22 §4.6 評価結果の公開範囲（visibility）＝公開範囲外の閲覧者に評価が表示されないことをブラウザで検証する。
// 根拠＝doc/テスト/F_評価.md（F-TC-214・visibility private）・API設計 F.1（private＝投稿者＋その評価者のみ・
// owner/quest_admin も不可）・data model §3 evaluation_visibility・FR-50。
//
// 構図＝ログインユーザ(ACME-01) を quest の owner にしつつ、アイデアの author・評価者を「別ユーザ」にすることで、
// ACME-01 を private 評価の範囲外（非投稿者・非当該評価者。owner でも private は見えない）に置く。別ユーザは会社DBの
// 既存 user を1人流用（新規作成しない）。idea / private 評価 / 観点スコアを psql で直接 seed し、UI で非表示を確認する。

const ASPECTS = ["novelty", "impact", "feasibility", "fit", "cost"];

test("F-TC-214 private 評価は公開範囲外の閲覧者に表示されない", async ({ page, workerCompany }) => {
  const db = workerCompany.dbName;
  await gotoAuthed(page);
  const stamp = Date.now().toString().slice(-8);
  const questId = await createRecruiting(page, `E2E可視範囲_${stamp}`);

  // 範囲外の構図＝ACME-01 は owner だが author でも当該評価者でもない。別ユーザ(other)が author かつ評価者。
  const meId = psqlValue(db, `SELECT id FROM users WHERE login_id='user@acme.example' LIMIT 1`);
  const otherId = psqlValue(db, `SELECT id FROM users WHERE id<>'${meId}' ORDER BY id LIMIT 1`);
  const ideaId = crypto.randomUUID();
  const evalId = crypto.randomUUID();
  const secret = `SECRETPRIV_${stamp}`; // この総評が UI に出てはいけない

  try {
    psql(db, `INSERT INTO ideas (id, quest_id, author_id, title, body, value, status, is_selected, current_revision) VALUES ('${ideaId}','${questId}','${otherId}','範囲外アイデア_${stamp}','本文','価値','published',false,1);`);
    psql(db, `INSERT INTO evaluations (id, idea_id, evaluator_id, evaluator_kind, status, visibility, submitted_at, overall_comment) VALUES ('${evalId}','${ideaId}','${otherId}','human','submitted','private', now(), '${secret}');`);
    for (const a of ASPECTS) {
      psql(db, `INSERT INTO evaluation_scores (id, evaluation_id, aspect, score) VALUES (gen_random_uuid(),'${evalId}','${a}',4);`);
    }

    await page.goto(`/ideas/${ideaId}`);
    const evalSection = page.getByLabel("評価結果");
    await expect(evalSection).toBeVisible();

    // 範囲外＝private はこの閲覧者（owner だが非投稿者・非当該評価者）に出さない。
    await expect(page.getByText(secret)).toHaveCount(0);          // 総評（秘密）がどこにも出ない
    await expect(page.getByText(/4\.0/)).toHaveCount(0);          // private のスコア平均(4.0)も出ない
    await expect(evalSection.getByText(/まだ提出済みの評価がありません/)).toBeVisible(); // 評価待ち（可視0件）
  } finally {
    psql(db, `DELETE FROM evaluation_scores WHERE evaluation_id='${evalId}';`);
    psql(db, `DELETE FROM evaluations WHERE id='${evalId}';`);
    // 詳細表示でアイデアにチャットグループが作られるため、idea 削除前に chat_groups を落とす（表示のみ＝発言なし）。
    psql(db, `DELETE FROM chat_groups WHERE idea_id='${ideaId}';`);
    psql(db, `DELETE FROM ideas WHERE id='${ideaId}';`);
    const c = await csrfToken(page);
    await page.request.delete(`/api/v1/quests/${questId}`, { headers: { "X-CSRF-Token": c } });
  }
});
