import { defineConfig, devices } from "@playwright/test";

// e2e はフルスタック（frontend+backend+db+redis）に対して実行する。
// baseURL は既定 http://localhost:3000（compose の frontend）。
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
