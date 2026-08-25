# テストパターン H. 通知（取得・未読・既読・発火・重複排除）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/H_通知.md`](../API設計/H_通知.md)（H.0〜H.4）・[`../データモデル.md`](../データモデル.md) §5.24・§3（`notification_type`）・§8-⑬/§8-⑳（取得時レンダリング）。エラー code は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン H（通知）の縦スライス＝`app/tenant/notifications/`（orm/migration 0017/repository/catalog/service/application/router）。**生成は各発火ドメインが H の `notify()`（内部サービス）を呼ぶ**（in-session or post-commit dispatch・H.1）。本スライスは**テナント発火系フル**（mention/idea_comment/follow_comment/magic_reaction/idea_updated/follow_evaluation/follow_selection/achievement/quest_party_invited）。`security_*`（cross-plane）と Redis publish（L=WS）は follow-up。
> 前提フィクスチャ＝seed 会社 ACME-01。api テストは throwaway アカウント（factory）でログインし、`notify()` を tenant セッションで直接呼んで宛先に通知を作る（発火経路の縦スライスは achievement をレジャーフック経由で end-to-end 検証）。変更系は Origin/CSRF。すべて自分宛スコープ（IDOR 対策・H.4）。

## 1. 取得・未読数・既読/未読 API（H.2/H.3・SC-02＋ヘッダーベル）

> 対象＝`app/tenant/notifications/application.py`・`router.py`（`GET /notifications`・`GET /notifications/unread-count`・`POST /notifications/{id}/read`・`/unread`・`/read-all`）。本文は取得時レンダリング（catalog・§8-⑳）。一覧はカーソル（§1.8・新着降順）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-101 | api | 空一覧（新規ユーザー） | 通知なし | `GET /notifications` | 200・`data=[]`・`unread_count=0`・`page_info.has_next=false` | H.2 |
| H-TC-102 | api | 一覧＋未読数＋取得時レンダリング | `notify()` で mention 1件（actor_name 凍結） | `GET /notifications` | 1件・`type=mention`・`body` に actor 名が差し込まれる・`is_read=false`・`unread_count=1` | H.2／§8-⑳ |
| H-TC-103 | api | 未読数のみ（軽量） | 未読2件 | `GET /notifications/unread-count` | `{unread_count:2}` | H.2 |
| H-TC-104 | api | 個別既読化（冪等・未読数減） | 未読1件 | `POST /{id}/read` ×2 | 200・`is_read=true`・`unread_count=0`・2回目も 200（no-op） | H.3 |
| H-TC-105 | api | 未読へ戻す | 既読1件 | `POST /{id}/unread` | 200・`is_read=false`・`unread_count=1` | H.3 |
| H-TC-106 | api | すべて既読化（type 絞り込み可） | 未読3件（うち mention 2・achievement 1） | `POST /read-all`（`{type:"mention"}`） | `updated=2`・残 `unread_count=1`。type 無しなら全既読 | H.3 |
| H-TC-107 | api | 絞り込み（state=unread / type） | 既読1・未読1（mention）・未読1（achievement） | `GET /notifications?state=unread&type=mention` | 未読 mention のみ1件 | H.2 |
| H-TC-108 | api | カーソル（新着降順・ページング） | 通知3件 | `GET ?limit=2` → `?cursor=next` | 1ページ目2件（新しい順）・`has_next=true`・2ページ目に残り1件 | H.2／§1.8 |
| H-TC-109 | api | 種別不正は 422 | — | `GET ?type=bogus` | 422（`field=type`） | H.2 |

## 2. セキュリティ（IDOR・認可・§2.2）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-121 | api | 他人宛は一覧に出ない | 別ユーザー宛に通知1件 | 自分で `GET /notifications` | 自分宛のみ（他人宛は含まない） | H.4 |
| H-TC-122 | api | 他人宛の既読操作は 404（存在秘匿） | 別ユーザー宛の通知 id | `POST /{other_id}/read` | 404 not_found・当該行は不変 | H.4 IDOR |
| H-TC-123 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `POST /{id}/read`・`/read-all` | 403 csrf_failed／401 | A.0 |

## 3. 生成・重複排除（`notify()`・H.1）

> 対象＝`app/tenant/notifications/service.py`（`notify`＝宛先単位で最具体1件に畳む・`TYPE_PRIORITY`）。発火の縦スライスは achievement をレジャーフック経由で end-to-end 検証（他種別は `notify()` を直接呼んで畳み込みを検証）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-141 | int | 1イベント×1宛先＝最具体1件 | 同一宛先に mention＋follow_comment 候補 | `notify()` | 生成は1件・`type=mention`（より具体）・follow_comment は畳まれる | H.1 |
| H-TC-142 | int | 別宛先は各1件 | A に mention・B に follow_comment | `notify()` | A/B にそれぞれ1件・混ざらない | H.1 |
| H-TC-143 | api | 実績獲得の自動通知（レジャーフック end-to-end） | 評価3件付与（reason=evaluation×3・ledger→engine） | `GET /notifications` | `type=achievement` 1件・`body` に実績名＋ティア・`meta.coin` にティア連動コイン | H.0／§8-⑲ |
