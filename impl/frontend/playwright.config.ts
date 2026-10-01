import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// e2e はフルスタック（frontend+backend+db+redis）に対して実行する。
// baseURL は既定 http://localhost:3000（compose の frontend）。
//
// 認証は storageState 方式（e2e/auth.setup.ts）＝共有 user@acme を1回だけログインして Cookie を
// 保存し、各 spec は既定でそれを再利用する（テストごとの再ログイン廃止）。これで並列フル実行時の
// ログインレート制限（(IP+login_id) 単位・dev 既定 50/300s）超過による 429→大量 fail を防ぐ。
// 破棄系/認証フロー spec（sc-00-*）は spec 側で `test.use({ storageState: {cookies:[],origins:[]} })`
// を宣言して未認証にし、自前でログインする。
const USER_STATE = path.join(__dirname, "playwright", ".auth", "user.json");

// ワーカ別DB隔離（§4.1・fixtures.ts）が有効なときは、workers を seed 済みワーカ会社数
// （E2E_WORKER_COMPANIES）に一致させる＝parallelIndex 0..N-1 が ACME-W0..W{N-1} に対応する。
// 未設定（通常スタック）は Playwright 既定（コア50%）。
const WORKER_N = Number(process.env.E2E_WORKER_COMPANIES ?? 0) || 0;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  ...(WORKER_N > 0 ? { workers: WORKER_N } : {}),
  // 並列フル実行で共有 backend への競合由来のタイミングフレークが残り得る。ワーカ別DB隔離（fixtures.ts）
  // で会社スコープの競合は断つ。残る control-plane/タイミングのフレークは失敗テストのみ再試行して吸収する
  // （実バグは全試行で落ちるためマスクされない＝Playwright は再試行 pass を "flaky" として可視化）。
  retries: 2,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // reset（会社DBを pristine bootstrap に復元）→ setup（認証状態を作る）→ chromium（本体）→
    // cleanup（末尾でテストデータを掃除・§7-2c）。reset を最前段に置くことで、フル実行のたび DB を
    // 既知状態から始め「毎回同じ失敗が再現する」蓄積ドリフトを構造的に断つ（方式A・テスト規約）。
    { name: "reset", testMatch: /db\.reset\.ts/ },
    { name: "setup", testMatch: /auth\.setup\.ts/, dependencies: ["reset"], teardown: "cleanup" },
    { name: "cleanup", testMatch: /auth\.cleanup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: USER_STATE },
      dependencies: ["setup"],
      testIgnore: /(auth\.(setup|cleanup)|db\.reset)\.ts/,
    },
  ],
});
