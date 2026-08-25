# テストパターン G. ゲーミフィケーション（魔法カタログ・解放）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../データモデル.md`](../データモデル.md) §5.19/§5.20・§7（XP/コイン/SP 台帳）／API設計 E.4（魔法の前提）・SC-32。台帳（`activities`・残高・レベル）canonical は `app/tenant/gamification/ledger.py`（実装済み）。
> 対象＝魔法カタログ/解放の縦スライス＝`app/tenant/gamification/`（application/router）。解放＝SP 消費（`ledger.grant(SP_SPEND)`・reason=spell_unlock）＋`user_spells` 追加を同一 UoW。前提魔法・SP 充足・二重解放防止はサーバー強制。
> 前提＝seed 一般ユーザー ACME-01。魔法マスタ（`spells`）は migration 0013 でシード済み（烈火系 flame_1/2/3・静輝系 light_1/2/3）。SP は teardown で影響しないようテスト内で付与/確認。変更系は Origin/CSRF。

## 1. 魔法カタログ・解放 API（SC-32・E.4 前提）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-101 | api | カタログ取得（解放状態＋can_unlock） | SP=0・未解放 | `GET /spells` | 200・6件・`unlocked=false`・起点（flame_1/light_1）は前提無・`can_unlock` は SP 充足で判定・`skill_point_balance` 返る | §5.19/§5.20 |
| G-TC-102 | api | 解放成功（SP 消費＋user_spells） | SP≥コスト・起点 spell | `POST /spells/{id}/unlock` | 200・`unlocked=true`・`skill_point_balance` が sp_cost 分減・`activities`(reason=spell_unlock, kind=sp_spend) 記帳・`user_spells` 追加 | §7／§5.20 |
| G-TC-103 | api | SP 不足は拒否 | SP<コスト | `POST /spells/{id}/unlock` | 409 `insufficient_sp`・残高不変 | §7 |
| G-TC-104 | api | 前提未解放は拒否 | 上位 spell（requires あり）・前提未解放・SP 充足 | `POST /spells/{id}/unlock` | 409 `prerequisite_not_met` | §5.19 |
| G-TC-105 | api | 二重解放は拒否 | 解放済み spell | `POST /spells/{id}/unlock` | 409 `already_unlocked`・SP 二重消費なし | §5.20 |
| G-TC-106 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `POST /spells/{id}/unlock` | 403 csrf_failed／401 | A.0 |

## 2. 画面 e2e（SC-32 魔法スキル・G）

> 対象＝フロント接続済み SC-32（`features/spells/components/SpellsView.tsx`・`/(app)/spells`）。e2e は契約の最終確認（画面↔API）。前提＝dev seed ACME-01。カタログ/SP は `GET /spells` の実データを画面と照合（デモ固定値でないこと）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-201 | e2e | 魔法カタログが実データ（SP残高・解放数・6魔法） | ログイン | `/spells` を表示 | `GET /spells` と照合＝SP残高 `✦{skill_point_balance}`・「解放 {unlocked} / 6」・6魔法（炎/雷/虹/氷/キラキラ/オーラ）が2系統で出る（デモ固定 3/6・✦3 でない） | G／SC-32 |

## 3. ショップ/装備 API（SC-30/SC-31・G.1/G.2）

> 対象＝`app/tenant/shop/`（items/user_items・migration 0015＋シード19点）。購入＝残高検証＋コイン消費（ledger COIN_SPEND・reason=shop_purchase）＋所有行作成。装備＝部分マップ（各スロット1点＝部分ユニーク）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-301 | api | 装備マスタ＋所有/装備/残高 | 未所有 | `GET /items` | 200・19点・各行 `owned`/`is_equipped`・`coin_balance` | G.1／§5.25 |
| G-TC-302 | api | 購入成功（コイン消費＋所有） | 残高≥価格・未所有 | `POST /items/{id}/purchase` | 200・`owned=true`・`coin_balance` が price 分減・`activities`(coin_spend/shop_purchase/items) 記帳 | G.1／§7 |
| G-TC-303 | api | 残高不足は 409 | 残高<価格 | `POST purchase` | 409 `insufficient_balance`・残高不変 | G.1 |
| G-TC-304 | api | 所有済みは 409 | 所有済み | `POST purchase` | 409 `already_owned`・二重消費なし | G.1／§5.26 |
| G-TC-305 | api | 自分の所有装備（スロット別） | 数点所有 | `GET /me/items` | `slots`（head/face/body/hand/background）＋`equipped` | G.2 |
| G-TC-306 | api | 装備更新（各スロット1点・切替/解除） | 同スロット2点所有 | `PUT /me/equipment`（装備→別装備→null） | 装備で `equipped[slot]`＝item・切替で1点のみ（部分ユニーク）・null で解除 | G.2／§8-⑩ |
| G-TC-307 | api | 未所有/スロット不一致は 422 | 未所有 item / 別スロット item | `PUT /me/equipment` | 422（`field`＝slot） | G.2 |
| G-TC-308 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `POST purchase`／`PUT equipment` | 403 csrf_failed／401 | A.0 |
