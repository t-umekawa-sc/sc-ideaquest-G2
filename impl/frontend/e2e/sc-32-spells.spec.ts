import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures"; // ワーカ別DB隔離（§4.1）＝各ワーカ専用会社の user@acme でログイン
import { gotoAuthed } from "./helpers";

// SC-32 魔法スキル（G 実接続）＝魔法カタログ/SP残高が実データ（getSpells）で描画される。
// SP残高/解放は会社スコープ（user@acme）＝並列競合を避けるためワーカ別会社DBで隔離。
// 解放成功の分岐は backend G-TC-102〜105 で担保（SP 前提のため e2e は実データ照合に限定）。
// 根拠＝doc/テスト/G_ゲーミフィケーション.md §2（G-TC-201）・SC-32。


test("G-TC-201 SC-32 spell catalog renders real data", async ({ page }) => {
  await gotoAuthed(page);
  // 実データ（GET /spells）を取得して画面と照合。
  const cat = await page.request.get("/api/v1/spells").then((r) => r.json());
  const unlocked = cat.data.filter((s: { unlocked: boolean }) => s.unlocked).length;

  await page.goto("/spells");
  await expect(page.getByRole("heading", { name: "魔法 / スキル" })).toBeVisible();
  // SP 残高・解放数が実データと一致（デモ固定 ✦3・解放3/6 でない）。
  await expect(page.locator(".sp-hero__num")).toHaveText(`✦ ${cat.skill_point_balance}`);
  await expect(page.locator(".sp-hero__unlocked")).toHaveText(`解放 ${unlocked} / 6`);
  // 6魔法（2系統）が実データで出る。
  await expect(page.locator(".spell-card")).toHaveCount(6);
  for (const name of ["炎", "雷", "虹", "氷", "キラキラ", "オーラ"]) {
    await expect(page.locator(".spell-card__name", { hasText: name }).first()).toBeVisible();
  }
});
