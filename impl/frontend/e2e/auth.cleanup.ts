import { execSync } from "node:child_process";
import path from "node:path";

import { test as teardown } from "@playwright/test";

// e2e 全体の後始末（Playwright teardown project）。永続DB（db_data ボリューム）にテストが作った
// クエストグループ/アカウント/会社が実行ごとに累積し、admin 系一覧の件数・ページング・検索を
// 不安定にする（§7-2c・非決定フレークの温床）。各 spec 個別の finally 後始末は UI 操作自体が
// フレークになりやすいため、実行末に psql で「テスト専用パターンのみ」をまとめて掃除する。
// 安全＝seed（DEV グループ・実アカウント・seed 会社）に一致しないパターンだけを対象にする。
const IMPL_DIR = path.resolve(__dirname, "..", ".."); // e2e → frontend → impl

function psql(db: string, sql: string) {
  execSync(`docker compose exec -T db psql -U ideaquest -d ${db} -c ${JSON.stringify(sql)}`, {
    cwd: IMPL_DIR,
    stdio: "pipe",
  });
}

teardown("cleanup accumulated e2e test data", () => {
  // 1) ACME 会社DB＝テスト用クエストグループ（QG/QGN/SCDEV 接頭辞）とその所属を削除（実グループ DEV* は対象外）。
  const acme = "ideaquest_company_acme";
  const testGroups = "SELECT id FROM quest_groups WHERE quest_group_code ~ '^(QG|QGN|SCDEV)'";
  psql(acme, `DELETE FROM quest_group_members WHERE quest_group_id IN (${testGroups});`);
  psql(acme, `DELETE FROM quest_group_links WHERE quest_group_id IN (${testGroups});`);
  psql(acme, `DELETE FROM quest_groups WHERE quest_group_code ~ '^(QG|QGN|SCDEV)';`);

  // 2) OPS 会社の e2e 発行アカウント（SC-93 B-TC-124）を FK 順で削除。login_id パターンで限定＝seed 管理者は不可侵。
  const ctl = "ideaquest_control";
  const targets =
    "SELECT a.id FROM accounts a JOIN companies c ON a.company_id=c.id " +
    "WHERE c.company_code='OPS' AND a.login_id LIKE 'e2e-l-%@ops.example'";
  for (const [tbl, col] of [
    ["otp_challenges", "account_id"],
    ["trusted_devices", "account_id"],
    ["account_sync_outbox", "account_id"],
    ["mail_outbox", "account_id"],
    ["system_audit_logs", "actor_account_id"],
  ] as const) {
    psql(ctl, `DELETE FROM ${tbl} WHERE ${col} IN (${targets});`);
  }
  psql(ctl, `DELETE FROM accounts a USING companies c WHERE a.company_id=c.id AND c.company_code='OPS' AND a.login_id LIKE 'e2e-l-%@ops.example';`);

  // 3) SC-91 が作る E2E-* 会社（アカウント無しのもの）を削除＝会社一覧の肥大を防ぐ。孤立 DB は無害（bootstrap がスキップ）。
  psql(ctl, `DELETE FROM companies WHERE company_code LIKE 'E2E-%' AND id NOT IN (SELECT company_id FROM accounts WHERE company_id IS NOT NULL);`);
});
