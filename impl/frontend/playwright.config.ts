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

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: USER_STATE },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
