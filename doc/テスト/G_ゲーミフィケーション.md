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
| G-TC-106b | api | 乖離の自己修復（台帳だけ残り user_spells 欠落） | 消費台帳(spell_unlock)を1件だけ挿入＋残高は課金済み想定・user_spells 無し | `POST /spells/{id}/unlock` | 500 でなく 200・`unlocked=true`・**二重課金しない**（残高不変）・`user_spells` を補完・消費台帳は増えない（`uq_activities_grant_ref` 重複INSERT回避）＝連打の敗者/DB復旧の取り残し耐性 | §5.20／§7 |
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

### 5-E. canvas エンジンの決定的部分（スプライト/軌道）frontend 単体（Phase E・SpellCanvasFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/engines/sprites.ts`（純ロジック）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17b-h` の canvas+rAF エンジン）を production の canvas ハーネス（`components/ui/SpellCanvasFx.tsx`＋`features/spells/useSpellEngine.ts`）へ移植するにあたり、**canvas 本体（imperative＋`Math.random()` で非決定的）は GF-AC ブラウザ受入**に委ね、決定的に抽出できる「ドット絵スプライトのデコード」と「UFO のパターン別軌道（prog→座標）」のみ unit で担保する。`decodeSprite(art,colMap)`＝`.`透過を除外し各非透過セルを `{x,y,char,color}` に解決（未知文字＝色 null）。`ufoPosition(pat,prog,params)`＝進行 prog(0..1) から (x,y) を算出（両端で x=x0/x1・パターン別に y のうねり方が変わる）。視覚（彩色のきらめき/金の流れ星/UFO の見た目・推進排気）は §17L-h（ライト版）の GF-AC でブラウザ受入。※ダーク版（§17h＝夜空/天の川/オーロラ）は明色パネルで見えないため `sparkle.ts` はライト版へ再移植済み（`UFO_COL` も明色パネル向けの暗縁取り配色）。reduce-motion はハーネスが `reduceStatic()` を呼び rAF を回さない（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-155）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-155 | unit(front) | ドット絵スプライトのデコード | `UFO_ART`（15×8）／`UFO_COL` | `decodeSprite(art, colMap)` | `.` は出力に含めない／非透過セル総数は固定（76 セル）／各セルは行内 x・行 y を持つ／`colMap` にある文字は色解決・未知文字（`L`＝点滅ライト）は色 null で char を保持（4 セル）／決定的 | GF-AC-091／#10 |
| G-TC-155 | unit(front) | UFO のパターン別軌道（prog→座標） | パターン番号 pat／進行 prog／params(x0,x1,yBase,amp,freq,H) | `ufoPosition(pat, prog, p)` | 全 pat で `prog=0→x≈x0`・`prog=1→x≈x1`（pat7 のループ区間 0.4..0.6 を除く）／pat0 は常に y=yBase（直線）／pat2 は中央 prog=0.5 で y>yBase（下ディップ）・pat3 は y<yBase（上山）で符号が反対／x,y は有限値／決定的 | GF-AC-091／#10 |

### 5-F. 炎 canvas エンジンの決定的部分（解像度/可読性フェード）frontend 単体（Phase E・SpellCanvasFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/engines/fire.ts`（純ロジック分）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17L-b` の延焼 canvas+rAF エンジン）を production の canvas ハーネスへ移植。**canvas 本体（延焼のセルオートマトン＝`rng` で非決定的）は §17L-b／実アプリの GF-AC ブラウザ受入**に委ね、決定的に抽出できる 2 点のみ unit で担保する。`fireGrid(w,h,scale)`＝実寸(CSS px)→低解像度グリッド(cols×rows)＝ドット絵の解像度（下限 140×20・約 scale px/セル）。`fireFade(above)`＝下辺から数えた高さ above 行に対する不透明度係数（根元=不透明→上端ほど透過＝**重なった文字が透けて読める**可読性の担保）。視覚（延焼の動き/火の玉/黒煙/火花/暖色ハロー）は §17L-b の GF-AC で受入。reduce-motion はハーネスが `reduceStatic()`（延焼済み静止 1 枚）を呼び rAF を回さない（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-156）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-156 | unit(front) | 実寸→低解像度グリッド（ドット絵の解像度） | 実寸 w×h／scale | `fireGrid(w, h, scale)` | cols/rows は整数／下限 140×20 でクランプ／十分大きい w では `cols≈round(w/scale)`（幅広ほどセル数↑・単調非減少）／決定的 | GF-AC-091／#10 |
| G-TC-156 | unit(front) | 可読性フェード（根元不透明→上端透過） | 下辺からの高さ above（行） | `fireFade(above)` | above≤3（根元）は 1／above が増えるほど単調非増加／下限 0.28 でクランプ（0 未満にならない＝上端でも文字が完全に消えない）／決定的 | GF-AC-091／#10 |

### 5-G. 雷 canvas エンジンの決定的部分（解像度/発雷フラッシュの水平減衰）frontend 単体（Phase E・SpellCanvasFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/engines/thunder.ts`（純ロジック分）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17L-d` の落雷 canvas+rAF エンジン）を production の canvas ハーネスへ移植。**canvas 本体（ジグザグ稲妻/枝分かれ/枠線ビリビリ/着弾粒子＝`rng` で非決定的・rAF 駆動）は §17L-d／実アプリの GF-AC ブラウザ受入**に委ね、決定的に抽出できる 2 点のみ unit で担保する。`thunderGrid(w,h,scale)`＝実寸(CSS px)→低解像度グリッド(cols×rows)＝ドット絵の解像度（下限 140×20・約 scale px/セル・炎と同契約）。`flashBand(x,w)`＝発雷時にパネルをほんのり暖色（琥珀）に光らせる際の**水平方向の明るさ係数**（中央の柱ほど明るく端ほど暗い・0 未満にならない）＝可読性優先で淡く光らせるための形状担保（**発雷でも文字が読める**）。視覚（稲妻の走り/枝/ビリビリ玉の飛来/枠線ビリビリ/黄粒子/連鎖）は §17L-d の GF-AC で受入。reduce-motion はハーネスが `reduceStatic()`（着弾済み静止 1 枚）を呼び rAF を回さない（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-157）で担保。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-157 | unit(front) | 実寸→低解像度グリッド（ドット絵の解像度） | 実寸 w×h／scale | `thunderGrid(w, h, scale)` | cols/rows は整数／下限 140×20 でクランプ／十分大きい w では `cols≈round(w/scale)`（幅広ほどセル数↑・単調非減少）／決定的 | GF-AC-091／#10 |
| G-TC-157 | unit(front) | 発雷フラッシュの水平減衰（中央明→端暗） | パネル幅 w／x 座標 | `flashBand(x, w)` | 中央 `x=w/2` で最大 1／中央から離れるほど単調非増加／0 未満にならない（範囲外 x でもクランプ）／決定的 | GF-AC-091／#10 |

### 5-H. 氷 canvas エンジンの決定的部分（解像度/霜の可読性フェード）frontend 単体（Phase E・SpellCanvasFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/engines/ice.ts`（純ロジック分）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17L-e` の氷結 canvas+rAF エンジン）を production の canvas ハーネスへ移植。**canvas 本体（Voronoi 凍結セル・氷柱の生成/保持/破砕・ピカッ連鎖・雪/破片＝`rng` で非決定的・rAF 駆動）は §17L-e／実アプリの GF-AC ブラウザ受入**に委ね、決定的に抽出できる 2 点のみ unit で担保する。`iceGrid(w,h,scale)`＝実寸(CSS px)→低解像度グリッド(cols×rows)＝ドット絵の解像度（下限 140×20・約 scale px/セル・炎/雷と同契約）。`frostAlpha(bright,settle)`＝凍ったパネルの霜フィルの不透明度係数（明るいセルほど濃く／**全面凍結後は settle を下げて霜を薄くし文字を読みやすくする**＝可読性の担保）。視覚（氷塊の飛来/砕け/雪の結晶/氷柱の成長・キラッ・破砕/凍結の広がり）は §17L-e の GF-AC で受入。※production 版は canvas をパネルより一回り大きく（`ICE_MARGIN_PX`）＋負オフセットで張り出し、氷柱が枠外へはみ出す（起点はコンテナ矩形基準の枠相対 px＋マージン offset で変換・`useSpellEngine`）。reduce-motion はハーネスが `reduceStatic()`（凍結済み静止 1 枚）を呼び rAF を回さない（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-158）で担保。

| G-TC-158 | unit(front) | 実寸→低解像度グリッド（ドット絵の解像度） | 実寸 w×h／scale | `iceGrid(w, h, scale)` | cols/rows は整数／下限 140×20 でクランプ／十分大きい w では `cols≈round(w/scale)`（幅広ほどセル数↑・単調非減少）／決定的 | GF-AC-091／#10 |
| G-TC-158 | unit(front) | 霜フィルの可読性フェード（明るいほど濃く・settle で薄く） | セル明度 bright(0..1)／settle(0.6..1) | `frostAlpha(bright, settle)` | bright が増えるほど単調非減少／settle が下がるほど単調非減少（全面凍結後は薄くなる）／0 未満にならない／決定的 | GF-AC-091／#10 |

### 5-I. 虹 canvas エンジンの決定的部分（満遍ない飛散先／集結チャージ量）frontend 単体（Phase E・SpellCanvasFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/engines/rainbow.ts`（純ロジック分）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17L-f2` の放浪型虹 canvas+rAF エンジン）を production の canvas ハーネスへ移植。**canvas 本体（虹ビームの発射/着弾・虹粒子の飛散・ゆらゆら集結・エネルギー球チャージ・中央への再発射＝`rng` で非決定的・rAF 駆動）は §17L-f2／実アプリの GF-AC ブラウザ受入**に委ね、決定的に抽出できる 2 点のみ unit で担保する。`rainbowScatterTargets(w,h,pad,n,rng)`＝着弾で粒子が飛ぶ先＝パネル内（パッド内）の一様ランダム n 座標（同心円にならず**満遍なく**散る・span 負は下限0でクランプ）。`rainbowChargeGrow(n)`＝集結点で溜まるエネルギー球の基準サイズ＝**集まった粒子数 n に比例**（n=0 は 0＝球を描かない・単調増加）。虹はフル解像度（ImageData グリッドではなく ctx 直描画）。※production 版は canvas をパネルより一回り大きく（`RAINBOW_MARGIN_PX`）＋負オフセットで張り出し、粒子/ビームが枠外へ少しはみ出す（起点はコンテナ矩形基準の枠相対 px＋マージン offset で変換・`useSpellEngine`）。reduce-motion はハーネスが `reduceStatic()`（中央の虹の輝き静止 1 枚）を呼び rAF を回さない（純ロジックは対象外）。rng 注入で決定的に検証。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-159）で担保。

| G-TC-159 | unit(front) | 満遍ない飛散先（同心円にならずパネル内へ一様） | 実寸 w×h／pad／個数 n／seed 付き rng | `rainbowScatterTargets(w, h, pad, n, rng)` | n 個返す／すべて [pad, w-pad]×[pad, h-pad] 内／span 負（2*pad>w 等）は pad に張り付き範囲外を返さない／同 seed は同列・異 seed は異なる（決定的） | GF-AC-091／#10 |
| G-TC-159 | unit(front) | 集結チャージ量（数に比例するエネルギー球） | 集まった粒子数 n | `rainbowChargeGrow(n)` | n≤0 は 0（球を描かない）／n が増えるほど単調増加／決定的 | GF-AC-091／#10 |

### 5-J. オーラ canvas エンジンの決定的部分（セルグリッド解像度／下辺可読性フェード）frontend 単体（Phase E・SpellCanvasFx・GF-AC-091）

> 対象＝`impl/frontend/src/features/spells/engines/aura.ts`（純ロジック分）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17L-g` のドット絵オーラ canvas+rAF エンジン）を production の canvas ハーネスへ移植。**canvas 本体（縁から立ち上るドット絵オーラのセルオートマトン・波動/応援記号（♪↑ハート星＋）の中央への飛来・紫↔金↔青の色巡回＝`rng` で非決定的・rAF 駆動）は §17L-g／実アプリの GF-AC ブラウザ受入**に委ね、決定的に抽出できる 2 点のみ unit で担保する。`auraGrid(w,h,cell)`＝実寸(CSS px)→セルグリッド(gw×gh・約 cell px/セル・下限 1×1)＝canvas 全体（パネル＋非対称マージン）を覆う解像度。`auraBotFade(gy,botRow)`＝下辺のオーラ不透明度係数（最下行付近 `gy>=botRow` は控えめ 0.32／それ以外 1＝**下辺の文字が読める**可読性の担保）。※production 版は canvas を上に高く（`AURA_MARGIN_TOP_PX`）＋左右（`AURA_MARGIN_SIDE_PX`）に張り出す非対称マージン＋負オフセットで、オーラが枠上へ立ち上る（起点はコンテナ矩形基準の枠相対 px＋パネル offset で変換・`useSpellEngine`）。reduce-motion はハーネスが `reduceStatic()`（強化済みオーラ静止 1 枚・脈動なし）を呼び rAF を回さない（純ロジックは対象外）。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-160）で担保。

| G-TC-160 | unit(front) | 実寸→セルグリッド（解像度） | 実寸 w×h／cell | `auraGrid(w, h, cell)` | gw/gh は整数／下限 1×1／`gw≈ceil(w/cell)`（幅広ほどセル数↑・単調非減少）／決定的 | GF-AC-091／#10 |
| G-TC-160 | unit(front) | 下辺の可読性フェード（最下行は控えめ） | 行 gy／最下行 botRow | `auraBotFade(gy, botRow)` | `gy>=botRow` は 0.32／それ以外 1／0 より大きく 1 以下（文字が完全に消えない）／決定的 | GF-AC-091／#10 |

### 5-K. 魔法 canvas ハーネスの reduce-motion 分岐（reduceStatic か rAF 起動か）frontend 単体（Phase E・useSpellEngine・GF-AC-091／093）

> 対象＝`impl/frontend/src/features/spells/useSpellEngine.ts` の純ロジック分。canvas 魔法エンジン（G-TC-155..160）はいずれも「reduce-motion はハーネスが `reduceStatic()` を呼び rAF を回さない」設計で、各エンジンの unit は決定的純関数のみ（reduce 分岐は対象外）。そこで**その分岐判定の正**をハーネス側で担保する（記憶 `animation-reduce-motion-standard`＝演出追加時は抑制 ON/OFF をテスト必須／デザイン標準 §4.9）。`planSpellLifecycle(reduce, hasIntersectionObserver)`＝実効抑制 reduce（＝`reduceMotion()`＝OS reduce OR ユーザー設定・`lib/motion` の正）が真なら `"static"`（rAF/IO を起動せず `reduceStatic()` 静止 1 枚）／偽なら IO があれば `"observe"`（可視で発射・画面外で停止）・無ければ（SSR/jsdom）`"immediate"`（即発射）を返す。実際の canvas 描画/rAF/IO 配線・後付け OS reduce の matchMedia 安全弁は GF-AC ブラウザ受入に委ねる。決定的（乱数なし）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-161）で担保。

| G-TC-161 | unit(front) | reduce-motion は静止 1 枚（rAF/IO を起動しない） | 実効抑制 reduce=true | `planSpellLifecycle(true, hasIO)` | hasIO の真偽によらず `"static"`（`reduceStatic()` 経路・rAF/IO 不使用）／決定的 | GF-AC-091・093／#10 |
| G-TC-161 | unit(front) | 非抑制は可視監視 or 即発射 | 実効抑制 reduce=false | `planSpellLifecycle(false, hasIO)` | IO あり（hasIO=true）は `"observe"`（可視で発射・画面外停止）／IO なし（false）は `"immediate"`（即発射）／決定的 | GF-AC-091・093／#10 |

### 5-L. 魔法解放の共通「習得」演出の決定的部分（魔法陣の頂点列／seed 選択／reduce 分岐）frontend 単体（移植・SpellLearnFx・GF-AC-110）

> 対象＝`impl/frontend/src/features/spells/learnFx.ts`（純ロジック分）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17L-i` の共通「習得」演出＝床の魔法陣→円周の実線→光の円柱に包まれた❓（ぐらぐら揺れ）→溜め→解放でアイコン開封→余韻＝canvas+rAF）を production の canvas ハーネス（`impl/frontend/src/components/ui/SpellLearnFx.tsx`）へ移植。**canvas 本体（魔法陣の描画／光の円柱／溜め／解放／余韻＝rAF 駆動・視覚）は §17L-i／実アプリの GF-AC ブラウザ受入**に委ね、決定的に抽出できる 3 点のみ unit で担保する。`mulberry32(seed)`＝seed から再現可能な決定的乱数。`genPath(R,rng)`＝魔法陣＝円内で反射しながら引く線の頂点列（`LEARN_BOUNCES+1` 点・すべて半径 R 上）。`pickLearnSeed(rand)`＝選定済み魔法陣 seed（`LEARN_SEEDS`＝ユーザー選定 10 個・§17L-i と一致）から 1 つ選ぶ。`planLearn(reduce)`＝実効抑制（`reduceMotion()`＝OS reduce OR ユーザー設定・`lib/motion` の正）なら `"static"`（演出を出さず即「解放済み」＝情報は残す）／非抑制は `"animate"`。実際の canvas 描画/rAF・アイコン開封（❓→本来アイコンの受け渡し）・reduce 時の即解放配線は GF-AC ブラウザ受入に委ねる（記憶 `animation-reduce-motion-standard`／デザイン標準 §4.9）。決定的（rng 注入）。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-162）で担保。

| G-TC-162 | unit(front) | 魔法陣の頂点列（BOUNCES+1 点・すべて半径 R 上・seed 再現） | 半径 R／seed 付き rng | `genPath(R, mulberry32(seed))` | `LEARN_BOUNCES+1` 点／各頂点は半径 R 上（円で反射）／同 seed は同経路・異 seed は異なる（決定的） | GF-AC-110／#11 |
| G-TC-162 | unit(front) | 決定的乱数（seed 再現） | seed | `mulberry32(seed)` | 同 seed は同数列／各値は `[0,1)` | GF-AC-110／#11 |
| G-TC-162 | unit(front) | 選定済み seed 選択／reduce 分岐 | rand([0,1))／実効抑制 reduce | `pickLearnSeed(rand)`・`planLearn(reduce)` | `pickLearnSeed` は `LEARN_SEEDS` のいずれか（範囲端 0/≈1 も安全）／`planLearn(true)="static"`・`planLearn(false)="animate"`／決定的 | GF-AC-110／#11 |

### 5-N. ショップ購入「支払い」演出の決定的部分（カウントダウン値列／reduce 分岐）frontend 単体（移植・#12・GF-AC-120）

> 対象＝`impl/frontend/src/features/shop/shopFx.ts`（純ロジック分）。受入済みモック（`doc/画面設計/mocks/style-guide.html §17M` の購入演出＝右上（財布）から ◆ コインが価格へ降りて吸い込まれ、価格が `price→0` と減って支払い完了→コインはサムネ左上バッジへ移り、価格行は「✓ 所有済み」・フットは「▶ きせかえで装備」へ／金地・金枠・コーナーリボン・光沢スイープ・紙吹雪＋「〈名〉を手に入れた」）を production（`impl/frontend/src/features/shop/components/ItemGetFx.tsx`＝`ShopPayFx`/`ItemCelebrateFx`・`ShopView.tsx`・`shop.css`）へ移植。**コイン落下/カウンタ弾み/所有遷移/祝福・お礼＝DOM/CSS 駆動・視覚は §17M／実アプリの GF-AC ブラウザ受入**に委ね、決定的に抽出できる 2 点のみ unit で担保する。`payValues(price,steps)`＝支払いカウントダウンの各ステップの表示コイン数列（`PAY_STEPS` 個・単調非増加・末尾 0＝支払い完了）。`planBuyFx(reduce)`＝実効抑制（`reduceMotion()`＝OS reduce OR `accounts.reduce_motion`・`lib/motion` の正）なら `"static"`（演出を出さず即・所有UI＝情報は残す）／非抑制は `"animate"`（記憶 `animation-reduce-motion-standard`／デザイン標準 §4.9）。決定的。vitest（node 環境）で red-green。src 単体は TC 走査対象外のため追跡は本 md（G-TC-165）で担保。

| G-TC-165 | unit(front) | 支払いカウントダウンの表示値列（price→0・単調非増加・末尾0） | 価格 price／刻み steps | `payValues(price, steps)` | `PAY_STEPS` 個／末尾 0／`[0,price]` 内で単調非増加／同入力は同出力（決定的）／price=0 は全 0 | GF-AC-120／#12 |
| G-TC-165 | unit(front) | reduce 分岐（演出 static/animate） | 実効抑制 reduce | `planBuyFx(reduce)` | `planBuyFx(true)="static"`・`planBuyFx(false)="animate"` | GF-AC-122／#12 |

### 5-M. 残高のヒーロー／ヘッダー同期 e2e（購入＝コイン・解放＝SP）（GF-AC-111/121・回帰ガード）

> **なぜ**＝残高チップは2箇所（画面のヒーロー ＋ 共通ヘッダー右上）にあり、ヘッダーはサーバー `layout.tsx` の `GET /me` 由来。アクション後に `router.refresh()` を忘れると**ヘッダーだけ更新されない**（実際に魔法解放 SP で発生・修正済み）。ゲーム感フェーズ §1.1「機能は Claude がテストで担保」に基づく回帰ガード。純ロジックは各 unit（`CountUp`/`learnFx` 等）で担保済みのため、ここは**アクション後の両表示の一致**という統合挙動を e2e で押さえる。対象＝`impl/frontend/e2e/sc-30-32-balance-sync.spec.ts`。テスト用ユーザー `user2@acme.example` を DB で baseline（SP100/コイン1000・未所有・台帳クリア）へリセットしてから実行し、後始末で再リセット（会社DB直操作＝`user_spells`/`user_items`/`activities` の `spell_unlock`・`shop_purchase`／`users` 残高）。docker QA スタック前提。

| G-TC-163 | e2e(front) | 魔法解放で SP がヒーローとヘッダー両方で減る | user2（SP100）で炎（前提なし・1SP）を解放 | `/spells` の `.sp-hero__num`／`.app-header .pixel-stat.skill` | 開封後、**両方が 100→99**（ヒーローとヘッダーが一致して減る） | GF-AC-110/111／#11 |
| G-TC-164 | e2e(front) | ショップ購入でコインがヒーロー(wallet)とヘッダー両方で減る | user2（コイン1000）で未所有アイテムを購入 | `/shop` の `.wallet__num`／`.app-header .pixel-stat.coin` | 購入後、**両方が 1000−価格**（wallet とヘッダーが一致して減る） | GF-AC-120/121／#12 |
| G-TC-166 | e2e(front) | reduce-motion で購入＝演出なし・即・所有UI（#12 reduce 配線） | `reducedMotion:"reduce"` で user2 が未所有アイテムを購入 | `/shop` の `.item-get`（演出オーバーレイ）／`.wallet__num`／`.buy__price.is-owned-status` | 演出オーバーレイ `.item-get` は**出ない（count 0）**／コインは**即 1000−価格**／価格行が「✓ 所有済み」へ即遷移 | GF-AC-122／#12 |

### 5-O. ランキング表彰台の非累積／自分の行の可読性（#13・SC-41・回帰ガード）

> **なぜ**＝`/ranking` で **期間タブ切替のたびに表彰台 `.podium` が消えず累積**し（旧タブの列が浮いて画面が縦に間延び→ヘッダーが押し出され「何のランキングか分からない」）、さらに**自分の行の登場ハイライト（`rank-me-row`）が明色不透明（`--color-primary-soft=#EFF6FF`）で終わり、暗いガラスパネル上で名前（明色）が潰れて読めない**不具合があった。原因＝(1) `podium` と `rank-list` が兄弟で同じ `key={period}` を使い**兄弟間キー重複**で reconciliation が壊れて旧 `.podium` が残存（→ `key` を `podium-`/`list-` で一意化）／(2) `rank-me-row` の終了色を base `.is-me`（`rgba(34,211,238,.14)`）へ揃える。純ロジック無し＝構造/CSS の回帰を e2e で押さえる。対象＝`impl/frontend/e2e/sc-41-ranking.spec.ts`。

| G-TC-167 | e2e(front) | 期間タブ切替で表彰台が累積しない | `/ranking` で 今週→通算→今月→先週→今週 とタブ切替 | `/ranking` の `.podium`／`.rank-list` | どの切替後も `.podium` は**常に 1 個**（`.rank-list` も 1 個）＝旧タブの表彰台が残らない | GF-AC-130／#13 |
| G-TC-168 | e2e(front) | 自分の行ハイライトが暗パネルで白潰れしない | `/ranking`（通算）で自分がランクイン | `/ranking` の `.rank-panel.full .rank-list li.is-me` 背景色 | 登場ハイライト終了後の背景が **`#EFF6FF`（near-white）でない**＝名前が読める（is-me 無い期間はスキップ） | GF-AC-131／#13 |
| G-TC-169 | e2e(front) | reduce-motion で全演出が無効（#13） | `page.emulateMedia({reducedMotion:"reduce"})` で `/ranking` を表示 | `.podium__col`／`.podium__medal`／`.myrank`／`.myrank .avatar`／`.rank-list li.is-me .avatar` の computed `animationName` | 表彰台せり上がり・メダルきらめき・myrank グロー・自分アバターのジャンプが**すべて `none`**（`@media prefers-reduced-motion`）。CountUp は即最終値（unit で担保）＝実効抑制は OS reduce OR `[data-anim-reduced]` | GF-AC-133／#13 |

### 5-P. 通知ベルの新着 pop の reduce（#15・SC-02/共通ヘッダー・GF-AC-152）

> 対象＝共通ヘッダーのベル（`AppHeader` の `.bell`）。**新着（未読が増えた）瞬間**に `data-arrived` で**ポンと跳ねる**（`bell-arrive`＋バッジ `bell-badge-pop`・#15 の一撃演出）／未読>0 の間は常時わずかに揺れる（`bell-wiggle`・#7）。reduce（実効＝OS reduce OR `[data-anim-reduced]`）で**跳ね/揺れが無効**。新着 pop の発火自体（realtime `notification.created` で未読増→`data-arrived`）は L-TC-102/103＋`LiveAppHeader`／`RealtimeProvider` で担保・GF-AC-150/151 はユーザー目視。ここは **reduce で演出が止まる**ことを e2e で押さえる（`data-arrived` を立てても `animationName:none`）。対象＝`impl/frontend/e2e/sc-02-notifications.spec.ts`。

| G-TC-170 | e2e(front) | reduce-motion でベルの新着 pop/常時 wiggle が無効（#15） | `page.emulateMedia({reducedMotion:"reduce"})` でログイン→`.bell` に `data-arrived="true"` を付与 | `.app-header .bell`／`.bell__icon` の computed `animationName` | `data-arrived` でも pop（`.bell`）と wiggle（`.bell__icon`）が**`none`**（`@media prefers-reduced-motion`）。未読数・遷移は正常 | GF-AC-152／#15 |

### 5-Q. クエスト選定の祝福（#16・SC-22・GF-AC-160/161/162）

> 対象＝アイデア詳細（`/ideas/{id}`）。選定権限（owner/quest_admin）が「☆ このアイデアを選定」で**初回選定が成立し投稿者 XP を付与した瞬間**に、中央へ祝福オーバーレイ（`.select-celebrate`＝👑＋「SELECTED!」＋アイデア名＋「投稿者へ ✦+200 XP」）を約2.8秒表示（クリックで即閉じ）。**選定成立時のみ**（解除・再選定〔冪等で再付与なし〕では出さない＝発火条件 `awarded = !prev && res.xp_awarded`）。純装飾のため **reduce では出さず**成功スナックバーで通知（JS ゲート `!reduceMotion()`）。※選定は **XP のみ付与**（`_XP_SELECTION=200`）＝コインはクエスト確定時に平均点ベースで別途（`_finalize_idea_coin`）。対象＝`impl/frontend/e2e/sc-25-eval.spec.ts`。

| G-TC-171 | e2e(front) | 選定成立で祝福が出る／解除では出ない（#16） | owner で recruiting クエスト＋published アイデアを作成→`/ideas/{id}` で選定→クリックで閉じ→解除 | `.select-celebrate`（SELECTED!/アイデア名）／「選定を解除しました。」 | 初回選定で `.select-celebrate` が出る（SELECTED!＋アイデア名）・クリックで `count 0`／解除では祝福 `count 0`（スナックバーのみ） | GF-AC-160/161／#16 |
| G-TC-172 | e2e(front) | reduce-motion で祝福を出さない（#16） | `page.emulateMedia({reducedMotion:"reduce"})` で同様に選定 | `.select-celebrate`／成功スナックバー／選定済みボタン | 祝福オーバーレイ `.select-celebrate` は**`count 0`**／「アイデアを選定しました。投稿者に XP を付与しました。」＋「選定済み」は正常 | GF-AC-162／#16 |

### 5-R. チャットの手触りの reduce（#17・SC-24・GF-AC-172）

> 対象＝アイデアチャット（`/ideas/{id}/chat`）。新着メッセージの登場（`.msg-row`＝`msg-enter` 下からフェード・`key=id` で新着のみ）＋リアクション追加のポップ（`.reaction`＝`reaction-pop`）。GF-AC-170/171 の見た目はユーザー目視。ここは **reduce で登場/ポップが無効**（即表示）を e2e で押さえる（`@media prefers-reduced-motion` で `animation:none`／実効は OS reduce OR `[data-anim-reduced]`）。※入力欄は既定で最小化（`composerMin=true`・スリムバー `.composer__mini`）＝テストは展開してから投稿（`openComposer`）。対象＝`impl/frontend/e2e/sc-24-chat.spec.ts`。

| G-TC-173 | e2e(front) | reduce-motion で登場/ポップが無効（#17） | `page.emulateMedia({reducedMotion:"reduce"})` でチャットに投稿→👍 リアクション | `.msg-row`／`.reaction` の computed `animationName` | 新着行（`.msg-row`）とリアクション（`.reaction`）の `animationName` が**`none`**／投稿・リアクション自体は正常 | GF-AC-172／#17 |

### 5-S. 取得中スピナーの reduce（#18・共通 Spinner／デザイン標準 §13・GF-AC-181）

> 対象＝ゲーム層＋主要コンテンツ画面の「読み込み中…」表示を共通 `Spinner`（`impl/frontend/src/components/ui/Progress.tsx`＝`.iq-spinner`／◆コイン `.iq-spinner__coin` が `iq-coinspin` で回転＋ラベル・デザイン標準 §13）へ統一（対象＝shop/spells/avatar/achievements/ranking/idea詳細/chat/eval＝いずれも `<Spinner label="読み込み中…" />` を取得中に表示）。GF-AC-180（コインスピナー表示）の見た目はユーザー目視。ここは **reduce でコイン回転が停止**（ラベルは表示・取得完了で通常表示）を e2e で押さえる。抑制機構は共通（1コンポーネント＋グローバル CSS）ゆえ代表画面（`/ranking`）で担保＝OS reduce は `@media prefers-reduced-motion` で `.iq-spinner__coin { animation: none }`（`styles/design-system.css`）／ユーザー設定は `[data-anim-reduced="true"] *` のグローバルキルスイッチ。※スピナーは取得中のみ表示ゆえ、テストは `**/api/v1/rankings**` を遅延させて取得中を可視化してから観測する。対象＝`impl/frontend/e2e/sc-18-loading.spec.ts`。

| G-TC-174 | e2e(front) | reduce-motion で取得中スピナーのコインが回らない（#18） | `page.emulateMedia({reducedMotion:"reduce"})` で `/api/v1/rankings` を遅延させ `/ranking` の取得中スピナーを表示 | `.iq-spinner__coin` の computed `animationName` | reduce ではコインの `animationName` が**`none`**（`@media prefers-reduced-motion`／`[data-anim-reduced]`）＝回転停止／ラベル「読み込み中…」は表示 | GF-AC-181／#18 |

### 5-T. レベルオーラの脈動 reduce（#21・SC-01 ヒーロー・GF-AC-212）

> 対象＝ダッシュボードのヒーローアバターに灯る色オーラ（`impl/frontend/src/features/dashboard/dashboard.css` の `.dash-page .hero__avatar[data-tier]::after`＝`box-shadow` の淡い光を `aura-pulse` でゆっくり脈打たせる純CSS装飾。ティア色は `--aura`）。表示・色・称号チップはユーザー目視（GF-AC-211）。ここは **reduce で脈動が止まる**（色・称号は表示）を e2e で押さえる＝OS reduce は `@media prefers-reduced-motion` で `::after { animation: none }`／ユーザー設定は `[data-anim-reduced]` グローバルキルスイッチ。`data-tier` は `levelRank(level).tier` で全レベル付与ゆえ `::after` は常設。非 reduce では `aura-pulse`（≠none）＝装飾が生きていることも同時に押さえる（regression 二方向ガード）。対象＝`impl/frontend/e2e/sc-01-dashboard.spec.ts`。

| G-TC-175 | e2e(front) | reduce-motion でレベルオーラの脈動が止まる（#21） | `page.emulateMedia` で no-preference→reduce を切替えて `/`（ダッシュボード）のヒーローアバターを観測 | `.dash-page .hero__avatar[data-tier]::after` の computed `animationName` | 非 reduce では `aura-pulse`（脈動が生きている）／reduce では **`none`**（`@media prefers-reduced-motion`／`[data-anim-reduced]`）＝脈動停止・オーラ（`box-shadow`）自体と称号は表示 | GF-AC-212／#21 |

### 5-U. 評価の星ホバー拡大／確定ポップの reduce（#22・SC-25 評価・GF-AC-222）

> 対象＝評価画面の観点の星（`impl/frontend/src/features/evaluations/evaluations.css` の `.star`＝hover で `transform:scale` 拡大＋`.stars[data-pop="true"] .star.is-on` の `star-pop` 弾み）。拡大/点灯/ポップの見た目はユーザー目視（GF-AC-220/221）。ここは **reduce で拡大/ポップが無効＝即座に点灯**（採点・キーボードは正常）を e2e で押さえる。二重の抑制＝(1) CSS `@media prefers-reduced-motion` で `.star { transition:none; transform:none }`／`.stars[data-pop="true"] .star.is-on { animation:none }`、(2) JS `EvaluationView.tsx` が `reduceMotion()` 真のとき `data-pop` を張らない（ポップ自体を起こさない）。テストは reduce 下で採点し、`.star` の `transitionDuration` が実質 0（拡大の抑制）／採点しても `.stars[data-pop="true"]` が出ない（ポップ抑制）／星は即 `is-on`（点灯は正常）を観測。非 reduce では `.star` の `transitionDuration>0`（拡大が生きている）も押さえる。対象＝`impl/frontend/e2e/sc-25-eval.spec.ts`。

| G-TC-176 | e2e(front) | reduce-motion で星の拡大/ポップが無効＝即点灯（#22） | `page.emulateMedia({reducedMotion:"reduce"})` で `/ideas/{id}/eval` の観点を採点 | `.star` の computed `transitionDuration`／採点後の `.stars[data-pop="true"]` 数／`.star.is-on` 数 | reduce では `.star` の `transitionDuration` が**`0s`**（拡大トランジション無効）／採点しても `.stars[data-pop="true"]` は**出ない（count 0）**＝ポップ抑制／選んだ点数まで星は即 `is-on`（点灯は正常）。非 reduce では `.star` の `transitionDuration>0` | GF-AC-222／#22 |

### 5-V. 賛否バーの伸縮 reduce（#23・SC-22 アイデア詳細・GF-AC-232）

> 対象＝アイデア詳細の賛否比率バー（`impl/frontend/src/features/ideas/ideas.css` の `.vote-bar__agree`/`.vote-bar__disagree`＝`transition:width .6s` で 0→比率へ伸縮）。表示・伸縮・解除の見た目はユーザー目視（GF-AC-230/231/233）。ここは **reduce で伸縮アニメが無効＝即座に比率表示**（0-0 は空バー・投票自体は正常）を e2e で押さえる＝OS reduce は `@media prefers-reduced-motion` で `.vote-bar__agree,.vote-bar__disagree { transition:none }`／ユーザー設定は `[data-anim-reduced]` グローバルキルスイッチ。バーは票の有無に依らず常設ゆえ、アイデア詳細を開くだけで観測できる。非 reduce では `transitionDuration>0`（伸縮が生きている）も押さえる。対象＝`impl/frontend/e2e/sc-22-idea-detail.spec.ts`。

| G-TC-177 | e2e(front) | reduce-motion で賛否バーの伸縮が無効（#23） | `page.emulateMedia` で no-preference→reduce を切替えて `/ideas/{id}`（アイデア詳細）の賛否バーを観測 | `.vote-bar__agree` の computed `transitionDuration` | 非 reduce では `transitionDuration>0`（幅の伸縮が生きている）／reduce では **`0s`**（`@media prefers-reduced-motion`／`[data-anim-reduced]`）＝即座に比率表示・バー自体は表示 | GF-AC-232／#23 |

## 参加部署アクセス門番（FR-38 再設計・`can_access_quest`・C.0）

> クエスト単位のゲーミフィケーション参照（ランキング・クエストアクティビティ）の門番を `can_access_quest` へ統一（2026-09-11・C.0 の網羅性に合わせ D/E/F/J と同一化）。**アクセスの都度、現所属で再判定**＝異動で全参加部署を外れたら名指しパーティー員でも 404（動的失効）。作成者は別格。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| G-TC-508 | api | 動的失効＝全参加部署離脱でランキング/アクティビティが 404 | G1 のみ所属の非作成者パーティー員→G1 のグループ所属を除去（参加部署 1 件） | `GET /rankings?scope=quest:{id}`／`GET /quests/{id}/activities`（当該員） | いずれも 404（`can_access_quest` 失効） | C.0／G |
