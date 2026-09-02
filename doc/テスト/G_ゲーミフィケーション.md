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
| G-TC-107 | int | 残高列は DB CHECK(>=0)（並行オーバースペンドの最終防御・M6） | seed 会社の実ユーザー | `users.coin_balance/skill_point_balance/xp` を -1 に更新→commit | いずれも `IntegrityError`（`ck_users_*_nonneg`）＝負残高を DB が拒否（アプリ層ガードの最終防御・migration 0020） | データモデル §5／G.0 |
| G-TC-108 | int | 付与の冪等を DB で担保＝`activities` 部分ユニーク（並行二重付与の最終防御・M6） | 同上 | 同一 `(user,kind,reason,ref_type,ref_id)`（ref付き）を2件 INSERT／`ref_id NULL`（login）を2件 INSERT | ref付き＝`IntegrityError`（`uq_activities_grant_ref` WHERE ref_id IS NOT NULL）で後着拒否／`ref_id NULL` は重複可（login/levelup_sp）＝例外なし | API設計 F.4／migration 0020 |
| G-TC-109 | api | クエスト内フィード＝公開種別のみ・actor 付き／非メンバーは 404（FR-36②・SC-12） | クエスト（owner=自分＋メンバー Bob）に Bob の `idea_post`（公開）・`vote`/`chat`（非公開）を付与 | `GET /quests/{id}/activities`（メンバー／非メンバー） | メンバー＝`200`・`idea_post` は出て `vote`/`chat` は出ない・`actor`（id/氏名）付き／非メンバー＝`404`（門番＝パーティー所属・存在秘匿） | G.5.1／FR-36 |
| G-TC-110 | api | チームフィード＝参加クエスト横断の公開種別のみ・各行 quest 付き・不参加は除外（FR-36③・SC-01） | 参加 qid1(Bob idea_post/vote)・qid2(Carol selection)＋不参加 qid3(Frank idea_post) | `GET /me/feed` | `data` に `(qid1,idea_post)`・`(qid2,selection)` を含み、**qid3 は出ない**（`quest_id ∈ 参加集合`）・`vote` 等非公開は出ない・各行に `quest_title` | G.5.1／FR-36 |

## 2. 画面 e2e（SC-32 魔法スキル・G）

> 対象＝フロント接続済み SC-32（`features/spells/components/SpellsView.tsx`・`/(app)/spells`）。e2e は契約の最終確認（画面↔API）。前提＝dev seed ACME-01。カタログ/SP は `GET /spells` の実データを画面と照合（デモ固定値でないこと）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-201 | e2e | 魔法カタログが実データ（SP残高・解放数・6魔法） | ログイン | `/spells` を表示 | `GET /spells` と照合＝SP残高 `✦{skill_point_balance}`・「解放 {unlocked} / 6」・6魔法（炎/雷/虹/氷/キラキラ/オーラ）が2系統で出る（デモ固定 3/6・✦3 でない） | G／SC-32 |
| G-TC-202 | e2e | SC-30 ショップが実データ（19点・コイン残高） | ログイン | `/shop` を表示 | `GET /items` と照合＝装備カード19点・コイン残高 `◆{coin_balance}`（デモ固定 ◆320 でない） | G.1／SC-30 |
| G-TC-203 | e2e | SC-31 アバターが実データ（所有/装備） | ログイン（未所有） | `/avatar` を表示 | `GET /items` と照合＝未所有アイテムは「🔒 ショップで購入」・装備スロットは実 is_equipped（デモの固定装備でない） | G.1/G.2／SC-31 |
| G-TC-206 | e2e | SC-41 ランキングが実データ（me/総人数） | ログイン | `/ranking` を表示 | `GET /rankings?period=this_week` と照合＝「あなたの順位」の総人数＝実 `me.total_users`・順位＝`me.rank`（デモ固定 全12人中 でない）・期間タブ切替で再取得 | G.5／SC-41 |
| G-TC-207 | e2e | SC-40 実績が実データ（12件/summary・シークレット伏せ） | ログイン | `/achievements` を表示 | `GET /achievements` と照合＝収集サマリー「{unlocked} / {total}」＝実 summary（total 12・デモ固定でない）・シークレット未獲得カードは「？？？」 | G.4／SC-40 |

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
| G-TC-309 | api | 所有装備一覧のマスタ名 locale 出し分けの担保（i18n 結線） | `crown`（ja=王冠/en=Crown）を装備した実ユーザー。`users.locale` を ja→en に切替 | `GET /me/items` を各 locale で | ja は `name`=「王冠」・en は `name`=「Crown」（受信者 locale で選択・§2.1・既定 ja） | コーディング規約 §2.1／G.2 |

## 4. ランキング API（SC-41 全社／SC-12 クエスト内・G.5）

> 対象＝`GET /rankings`（gamification）。スコア＝期間内の 獲得XP＋獲得コイン（`activities` 集計・SP 対象外・§7）。週起点＝月曜00:00 JST。タイブレーク＝XP→コイン→先着。`me` を圏外でも常時同梱。クエスト内は門番（C.0）。決定性のため api テストは `scope=quest:{id}` で集計を隔離。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-401 | api | ランキング集計・順位・me 同梱 | quest 内に U0(score80)/U1(score20)（今週の xp_gain/coin_gain）| `GET /rankings?scope=quest:{id}` | `data` が score 降順（U0→U1）・各行 `xp`/`coin`/`score`・`me`（U0）＝rank1・`total_users=2` | G.5／§7 |
| G-TC-402 | api | 期間フィルタ（this_week は先週分を除外） | 今週分＋先週分（backdate）の付与 | `GET /rankings?period=this_week` / `last_week` | this_week は今週分のみ・last_week は先週分のみ集計 | G.5／§7 週起点 |
| G-TC-403 | api | me は圏外でも同梱 | quest 内に他ユーザーのみ付与・自分は0 | `GET /rankings?scope=quest:{id}` | `me.rank=null`・`me.score=0`・`total_users` は他ユーザー数 | G.5 |
| G-TC-404 | api | クエスト内は門番（非パーティー404） | 非パーティーのクエスト | `GET /rankings?scope=quest:{id}` | 404（存在秘匿・C.0） | G.5／C.0 |
| G-TC-405 | api | period 不正は 422 | — | `GET /rankings?period=xxx` | 422（`field=period`） | G.5 |

## 5. 実績 API（SC-40・G.4・§8-⑲）

> 対象＝`app/tenant/achievements/`（achievements/user_achievements・migration 0016＋シード12）。付与は `ledger.grant` の後フック（engine.evaluate）で即時判定・冪等（reason ルーティング／condition＝count/streak_login/level/all_spells/all_items）。ティア連動コイン（bronze20/silver50/gold150）。決定性のため throwaway ユーザーで閾値到達させる。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-501 | api | 一覧＋summary・シークレット伏せ | 未獲得 | `GET /achievements` | 12件・`summary{unlocked:0,total:12}`・シークレット未獲得は `is_secret:true`・name「？？？」・tier null | G.4 |
| G-TC-502 | api | 台帳フックで自動付与（count） | 評価3件付与（reason=evaluation×3・ledger） | 3件目付与→`GET /achievements` | `evaluator_3` が unlocked・`activities`(coin_gain/achievement_reward/achievements) 20・`coin_balance` +20 | G.4／§8-⑲ |
| G-TC-503 | api | 進捗の反映（未達） | 評価2件付与 | `GET /achievements` | `evaluator_3` の `progress{current:2,target:3}`・unlocked false | G.4 |
| G-TC-504 | api | 報酬は一度きり（冪等） | 評価3件→さらに1件付与 | achievement_reward activity 件数 | evaluator_3 の achievement_reward は1件のまま（UNIQUE＋exists_ref） | G.4 |
| G-TC-505 | api | 全種系（all_spells） | user_spells 6件を seed→spell_unlock 付与 | `GET /achievements` | `spellmaster` unlocked・coin 150 | G.4 |
| G-TC-506 | api | 自分の獲得実績 | evaluator_3 獲得済み | `GET /me/achievements` | evaluator_3 が unlocked_at 付きで返る | G.4 |
| G-TC-507 | api | 実績一覧のマスタ名/説明 locale 出し分けの担保（i18n 結線） | evaluator_3（ja=評価者/en=Evaluator・説明も en 有り）。`users.locale` を ja→en に切替 | `GET /achievements` を各 locale で | ja は `name`=「評価者」/`description`=`condition_label`=「評価を3件確定する」・en は `name`=「Evaluator」/`description`=`condition_label`=「Submit 3 evaluations」（受信者 locale で選択・§2.1） | コーディング規約 §2.1／G.4 |

## 6. ゲーム感フロント単体（実績アンロック祝福・#6・SC-40）

> 対象＝`impl/frontend/src/features/achievements/celebrate.ts`（純ロジック）。前回このブラウザで観測した「獲得済み実績 id 群」（`localStorage["iq:seenAch:"+accountId]`・アカウント別・JSON 文字列配列）と現在の獲得済み id 群を比べ、**新規に解放された id 群を返す**。視覚（中央オーバーレイ）は `components/AchievementCelebration.tsx`＋`achievements.css` でブラウザ受入（GF-AC）。設計判断＝**初回観測は祝福しない**（既存の獲得を一斉に祝福する誤発火を防ぐ・#2 レベルアップ [`../../impl/frontend/src/features/dashboard/levelup.ts`] と同型）。backend/挙動は不変（純加算的な視覚レイヤ）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-150）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-150 | unit(front) | 新規解放の差分検出＝祝福対象を返す | 前回観測 id 群と現在の獲得 id 群 | `shouldCelebrateUnlock(prevSeen, current)` | 初回観測(null)＝`[]`（記録のみ・誤発火防止）／current のうち prevSeen に無い id を current の順で返す／既知のみ＝`[]` | G.4／#6 |
| G-TC-150 | unit(front) | 観測記録の生成/読取（重複除去・不正は初回扱い） | localStorage 生値 | `parseSeenCodes(raw)`／`nextStoredCodes(prev, current)` | 未記録/非配列/壊れ JSON は `null`（初回扱い）・文字列以外は除外／`nextStoredCodes` は prev∪current を重複除去（実績は失われない前提で減らさない） | G.4／#6 |

## 5. 魔法発動演出のランク差 frontend 単体（SpellCastFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/cast.ts`（純ロジック）。魔法発動の瞬間演出（`components/ui/SpellCastFx.tsx`・チャット SC-24／魔法解放 SC-32 で発火）の「中央にアイコンが表示され外側へ広がる」放射状粒子の配置と、**レアリティ（ランク）が高いほど派手**になる強度を決める。種別の正規化（未知→sparkle）・レアリティ正規化（未知→standard）・粒子数（common<standard<rare）・放射座標（先頭は真上・全周にほぼ等半径・rare ほど広い）を担保。視覚（色/動き/二重リング/グロー）は `design-system.css .spell-cast--*` ＋GF-AC でブラウザ受入。reduce-motion は親が生成抑制＋CSS で無効（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-151）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-151 | unit(front) | 種別/ランクの正規化 | 任意の effect/rarity 文字列 | `castEffect(e)`／`castTier(r)` | 既知はそのまま／未知の effect は `sparkle`・未知の rarity は `standard` に畳む | GF-AC-091／#10 |
| G-TC-151 | unit(front) | ランクが高いほど派手（粒子数） | common/standard/rare | `castParticleCount(r)` | `common < standard < rare`・未知は standard 相当 | GF-AC-091 |
| G-TC-151 | unit(front) | 中央から外側へ放射状に広がる粒子配置 | rarity | `castParticles(r)` | 数は `castParticleCount` と一致／先頭は真上（dx≈0, dy<0）／全周にほぼ等半径で散る（上下左右いずれにも向く）／rare の半径 > common／決定的 | GF-AC-091 |

### 5-B. 属性別デリバリー（発射方式）の純ロジック（Phase B・SpellDeliveryFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/cast.ts`（純ロジック追加分）。モック §17 の「属性ごとに飛び方が違う」発射方式を production へ移植する Phase B の決定的レイアウト。effect→デリバリー種別（火球/稲妻/氷礫/ビーム/三日月）・稲妻のジグザグ折れ線（両端は発射元/着弾点に接続・中間が交互に振れる）・氷礫4片の相対レイアウト（大小/回転）・三日月の本数（距離が長いほど道中で増える・4..9 でクランプ）を担保。座標→画面上の実位置変換（角度/距離）と視覚（色/グロー/マズル）は `components/ui/SpellDeliveryFx.tsx`＋`design-system.css` で GF-AC 受入。reduce-motion は親が生成抑制（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-152）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-152 | unit(front) | effect→発射方式の対応 | 任意の effect 文字列 | `castDelivery(e)` | fire/sparkle=`ball`・thunder=`bolt`・ice=`shards`・rainbow=`beam`・aura=`crescents`／未知は sparkle 相当＝`ball` | GF-AC-091／#10 |
| G-TC-152 | unit(front) | 稲妻のジグザグ折れ線 | 分割数 seg | `boltPoints(seg)` | 点数は seg+1／t は 0→1 単調増加で両端 0/1／両端の横オフセット off=0（発射元/着弾点に接続）／中間に +と− 両方の振れがある／決定的 | GF-AC-091 |
| G-TC-152 | unit(front) | 氷礫4片の相対レイアウト | なし | `iceShards()` | 4片／大小が異なる（scale が一様でない）／左右いずれにもズレる片がある（dx に +と−）／決定的 | GF-AC-091 |
| G-TC-152 | unit(front) | 三日月の本数（距離で増える） | 発射元→着弾点の距離 | `crescentCount(d)` | 4..9 にクランプ／距離が長いほど単調非減少／近距離=4・十分遠い=9 | GF-AC-091 |

### 5-C. 着弾バースト（属性別幾何）の純ロジック（Phase C・SpellCastFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/cast.ts`（純ロジック追加分）。モック §17 の `buildBurst` 相当＝着弾の瞬間に属性ごとに違う幾何で弾ける（雷=放射レイ／氷=結晶シャード／虹=多色リング／オーラ/キラキラ=粒子／炎=噴煙）。effect→バースト種別（`castBurstKind`）と、中心から全周へ等間隔・等半径に配る決定的レイアウト（`radialBurst`）を担保。視覚（色/グロー/リング）は `components/ui/SpellCastFx.tsx`＋`design-system.css .spell-cast__*` で GF-AC 受入。数の派手さは既存 `castParticleCount`（common<standard<rare）を流用。reduce-motion は親が生成抑制＋CSS 無効（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-153）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-153 | unit(front) | effect→バースト種別の対応 | 任意の effect 文字列 | `castBurstKind(e)` | fire=`plume`・thunder=`rays`・ice=`shards`・rainbow=`rings`・aura=`motes`・sparkle=`motes`／未知は sparkle 相当＝`motes` | GF-AC-091／#10 |
| G-TC-153 | unit(front) | 中心から全周へ等間隔・等半径に配る | 個数 n／半径 r／起点角 | `radialBurst(n, r, startDeg?)` | 要素数は n（n≤0 は空）／各点の半径は r にほぼ一致（丸め誤差のみ）／隣接角は 360/n で等間隔／既定起点は真上（先頭 dx≈0, dy<0）／決定的 | GF-AC-091 |

### 5-D. 属性別永続エフェクトの純ロジック（Phase D・SpellPersistFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/cast.ts`（純ロジック追加分）。モック §17 `buildPersist` 相当＝発動後にメッセージ枠へ着地するリッチな永続を production 化。属性ごとに DOM を生成する `components/ui/SpellPersistFx.tsx` の決定的レイアウトを担保。まず炎＝下辺の火柱（`firePillars`＝8本の左位置/高さ/遅延/周期をばらす）。視覚（グラデ/マスク/首振り）は `design-system.css .spell-fx__*` で GF-AC 受入。属性は増分で追加（雷/虹/オーラ/氷ツリーは後続）。reduce-motion は CSS で animation 無効（静的）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-154）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-154 | unit(front) | 炎の火柱レイアウト（枠幅で本数↑） | 枠幅 w | `firePillars(w)` | left は左→右へ単調増加で 0..100%／高さ h は一様でない／**本数は枠幅に比例**（幅広ほど増える・下限8）／決定的 | GF-AC-091／#10 |
| G-TC-154 | unit(front) | 雷の落ちる稲妻/スパークの配置 | なし | `thunderBolts()`／`thunderSparks()` | 稲妻3本・スパーク2個／left は 0..100% に収まる／決定的 | GF-AC-091／#10 |
| G-TC-154 | unit(front) | 虹の全幅アーク（平行7バンド） | なし | `rainbowArcBands()` | 7バンド／色は7色すべて相異／足の高さ feetY は i 昇順で単調増加／各 path は右端(x=198)→左端(x=2)を上弧で結ぶ（両端まで架かる）／決定的 | GF-AC-091／#10 |
| G-TC-154 | unit(front) | オーラの活力の粒（枠全体に分散・幅で数↑） | 枠の実寸 w×h | `auraMotes(w, h)` | **数は枠幅に比例**／原点 startX は枠全体に横分散（0..100%・左右両側に散る）／各粒は上へ浮上（dy<0）／決定的 | GF-AC-091／#10 |
| G-TC-154 | unit(front) | 氷のヒビ伝播ツリー（実寸・アスペクト追従） | 枠の実寸 w×h | `iceCrackTree(w, h)` | 四隅から t1×4→枝分かれ t2×8→t3×8→末端 t4×4／**隅→中心の向き・長さは隅→中心距離に比例**（幅広でも中央まで届く）／致命ヒビ(fa/fb/fc)は既存節点を左→右になぞる折れ線5本／left/top(%) は有限値／決定的 | GF-AC-091／#10 |
