# テストパターン I. ダッシュボード集約（読取合成の殻）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/I_ダッシュボード集約.md`](../API設計/I_ダッシュボード集約.md)（I.0〜I.5）・[`../画面設計/screens/SC-01_ダッシュボード.md`](../画面設計/screens/SC-01_ダッシュボード.md)。合成元＝C（参加中/下書きクエスト）・D（下書き/未投票/フォロー中アイデア＝横断 read）・F（下書き評価＝横断 read）・G（週間ランキング・残高）・H（最近の通知）。
> 対象＝新ドメイン I（`app/tenant/dashboard/`＝application/router/schemas）＝`GET /api/v1/dashboard`。**新業務ロジックなし＝各ドメインの read を1レスポンスに合成**。横断 read は D/F の repository に追加（別 EP は新設しない・I.3）。部分失敗は best-effort（パネル単位 null／全体は落とさない・I.4）。
> 実装で確定した既定（I.5 TBD の値）＝通知 5・未投票/参加中/フォロー各 6・下書き全件（少数想定）。並び＝下書き/フォロー＝更新降順・未投票/参加中＝締切近い順。
> 前提＝seed 会社 ACME-01。api は throwaway 実アカウントでログイン。全て自分スコープ（cross-tenant 不可・§1.5）。

## 1. 集約取得（各パネル・I.1/I.2）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| I-TC-101 | api | 空ダッシュボード（新規ユーザー） | 何も作っていない | `GET /dashboard` | 200・`hero` あり・`drafts=[]`・`unvoted_ideas=[]`・`quests=[]`・`followed_ideas=[]`・`notifications.data=[]` | I.1 |
| I-TC-102 | api | ヒーロー（残高＋level 算出） | 残高あり（xp/coin/sp） | `GET /dashboard` | `hero.level`/`xp_to_next`/`level_span`＝G の純粋算出・`coin_balance`/`skill_point_balance` 一致・`avatar_image_url` は署名URL（生パス非露出） | I.1／§1.10 |
| I-TC-103 | api | 下書き（quest/idea/eval 混在・本人のみ・進捗） | 本人の下書きクエスト1・下書きアイデア1・下書き評価1（scored 3/5） | `GET /dashboard` | `drafts` に3件・`kind` 別（quest/idea/evaluation）・評価は `progress={scored:3,total:5}` | I.1／SC-01 §4.4 |
| I-TC-104 | api | 未投票アイデア（参加クエストの公開・自票なし） | 参加クエストに published 2（うち1は自分が投票済み） | `GET /dashboard` | `unvoted_ideas` に未投票の1件のみ（投票済みは出ない）・`vote_summary` 同梱 | I.1／SC-01 §4.5 |
| I-TC-105 | api | 参加中クエスト（C カード） | 参加中クエスト1 | `GET /dashboard` | `quests` に当該カード（`my_state`/`member_count`/`idea_count` 等・C 形） | I.1／SC-01 §4.6 |
| I-TC-106 | api | フォロー中アイデア（follows×ideas） | published アイデアをフォロー | `GET /dashboard` | `followed_ideas` に当該（`following:true`・`quest.quest_status` 同梱） | I.1／SC-01 §4.7 |
| I-TC-107 | api | 週間ランキング（top3＋me） | 週内に XP/コイン獲得 | `GET /dashboard` | `weekly_ranking.top3[]`＋`weekly_ranking.me`（rank/score）＝G.5 の read | I.1／G.5 |
| I-TC-108 | api | 最近の通知（limit＋未読数） | 未読通知あり | `GET /dashboard` | `notifications.data`（≤5・新着降順・取得時レンダリング body）＋`unread_count` | I.1／H.2 |
| I-TC-109 | api | roles（管理導線出し分け） | 一般ユーザー | `GET /dashboard` | `roles={is_qg_admin:false,is_company_account_admin:false,is_system_admin:false}`（サーバー権威） | I.1／§8-⑯ |

## 2. login_bonus（ワンショット・I.1/A.1/G.6）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| I-TC-110 | api | 当日初回ログインで1度だけ返る | ログイン（当日初回・日次ログイン XP 付与） | `GET /dashboard` ×2 | 1回目＝`login_bonus={xp:...}`・2回目＝`login_bonus` 無し（null・ワンショット消費） | I.1／G.6 |

## 3. 認可・スコープ（§2.2）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| I-TC-121 | api | 未認証は 401 | セッションなし | `GET /dashboard` | 401 | I.0 |
| I-TC-122 | api | 他人スコープを受けない（IDOR 面を増やさない） | 別ユーザーの下書き/フォローが存在 | 自分で `GET /dashboard` | 自分の drafts/followed のみ（他人分は含まない） | I.0／§2.2 |

## 4. 部分失敗・横断 read（I.3/I.4）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| I-TC-131 | int | 部分失敗 best-effort（全体は落とさない） | 1パネルの合成が例外 | `get_dashboard()` | 当該パネルは `null`・他パネルは正常・全体 200 | I.4 |
| I-TC-141 | int | D 横断 read＝本人下書きアイデア（全クエスト横断） | 別クエストに下書き2・公開1 | `list_draft_ideas_by_author` | 下書き2のみ（公開は除く・author=自分） | I.3 |
| I-TC-142 | int | D 横断 read＝未投票（参加クエスト・自票なし・締切内） | 参加/非参加・投票済/未投票混在 | `list_unvoted_published_ideas` | 参加クエストの published で自票なしのみ | I.3 |
| I-TC-143 | int | F 横断 read＝本人下書き評価（進捗 scored/5） | 下書き評価（scored 2）＋確定評価 | `list_draft_evaluations_by_evaluator` | 下書きのみ・progress scored=2/total=5 | I.3 |
