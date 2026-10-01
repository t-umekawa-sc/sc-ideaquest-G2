import { execSync } from "node:child_process";
import path from "node:path";

import { test as setup } from "@playwright/test";

// e2e 実行ライフサイクルの最前段＝「pristine 復元」。フル e2e は共有 dev DB（db_data ボリューム）に
// 書き込み、seed フィクスチャを破壊的に変更する（投票/評価/クエスト前進・削除）。cleanup（末尾）は
// テスト作成物の狭いホワイトリスト削除しかできず、消費・変更された seed 行を元に戻せない。結果 DB は
// 実行のたび bootstrap からズレ続け、件数/並び/状態の assertion が「毎回同じ顔ぶれ」で落ちる（§5）。
// 対策＝毎実行の冒頭で会社DBを DROP → bootstrap で再作成（最新 migration + demo seed）し、常に同一の
// 既知状態から始める（方式A・テスト規約）。bootstrap は冪等だが既存行はスキップするため、復元には
// DROP が必須。永続テンプレDBは持たない（migration head のドリフト事故を避ける）＝新しい migration
// 先を増やさない（backend pytest と同じ思想）。
const IMPL_DIR = path.resolve(__dirname, "..", ".."); // e2e → frontend → impl

// 復元対象＝デモ会社DBのみ（control DB は drop しない＝OPS/会社行は不変・bootstrap が冪等に通る）。
// ワーカ別DB隔離（§4.1）が有効（E2E_WORKER_COMPANIES=N）なら ACME-W0..W{N-1} の会社DBも対象に含める
// ＝各ワーカ専用会社も毎回 pristine に戻す。N は backend の seed 数と一致させること。
const WORKER_N = Number(process.env.E2E_WORKER_COMPANIES ?? 0) || 0;
const COMPANY_DBS = [
  "ideaquest_company_acme",
  "ideaquest_company_acme2",
  ...Array.from({ length: WORKER_N }, (_, i) => `ideaquest_company_acme_w${i}`),
];

function dc(args: string): string {
  return execSync(`docker compose ${args}`, { cwd: IMPL_DIR, stdio: "pipe" }).toString();
}

// bootstrap（create DB + migrate + seed）は会社2つ分で 30〜60 秒かかる＝Playwright 既定 30s を超える。
setup.setTimeout(180_000);

setup("reset company DBs to pristine bootstrap state", () => {
  // 1) 会社DBを FORCE DROP（backend の既存接続を切断。pool_pre_ping=true なので再作成後は透過再接続）。
  for (const db of COMPANY_DBS) {
    execSync(
      `docker compose exec -T db psql -U ideaquest -d postgres -c ${JSON.stringify(
        `DROP DATABASE IF EXISTS ${db} WITH (FORCE);`,
      )}`,
      { cwd: IMPL_DIR, stdio: "pipe" },
    );
  }
  // 2) bootstrap で会社DBを再作成（最新 Alembic migration + demo seed・APP_ENV=dev）＝毎回同一状態。
  dc("exec -T backend python -m scripts.bootstrap");
});
