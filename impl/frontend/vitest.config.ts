// フロントエンドの単体テスト（純関数・テスト規約 unit 層）設定。
// jsdom は使わず node 環境（対象は URL パラメータ組み立て等の純ロジック）。
// パスエイリアス `@/*` は tsconfig と同じく src へ解決する。
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
