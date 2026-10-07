# テストパターン U. お知らせ（運営告知・FR-49）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/U_お知らせ.md`](../API設計/U_お知らせ.md)（U.0〜U.4）・[`../設計ドラフト/ダッシュボード再設計・お知らせ_設計.md`](../設計ドラフト/ダッシュボード再設計・お知らせ_設計.md) §4・[データモデル](../データモデル.md) §5.65/5.66。
> 中核＝全社お知らせ（管理者投稿・全ユーザー閲覧）。本文リッチテキストは保存時サニタイズ（`app/core/richtext`）。既読/掲載期間/ピン／ダッシュボード選別（§4.3a）を検証。
> 前提＝seed 会社 ACME-01。api は throwaway 実アカウントでログイン。管理操作は管理者、閲覧は一般で確認。

## 1. 閲覧（全ユーザー・U.1）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| U-TC-101 | api | 一覧＝published・掲載期間内のみ／pinned→published_at 降順／unread_count 同梱 | published(ピン1・非ピン2)・draft1・期間外(ends_at 過去)1 を作成 | 一般で `GET /announcements` | draft・期間外は出ない／pinned が先頭→以降 published_at 降順／各行 `is_read`／`unread_count` が未読数と一致 | U.1／§4.3 |
| U-TC-102 | api | 未読のみ絞り（`unread=true`） | published 2件のうち1件を既読化 | `GET /announcements?unread=true` | 未読の1件のみ返る（既読は出ない） | U.1 |
| U-TC-103 | api | 詳細＝全文 body_html／表示対象外は404 | published1・draft1 | `GET /announcements/{id}`（published／draft／不存在） | published=200＋`body_html`（サニタイズ済）／draft=404／不存在=404 | U.1 |
| U-TC-104 | api | 既読化（冪等）＋未読数減 | 未読 published 1件 | `POST /announcements/{id}/read` ×2 → `GET /announcements` | 1回目/2回目とも200（upsert 冪等）／以後 `is_read=true`・`unread_count` が1減 | U.1 |

## 2. 管理（管理者のみ・U.2）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| U-TC-105 | api | 作成/編集/削除は管理者のみ・一般は403 | 管理者/一般 | 一般 `POST/PATCH/DELETE /admin/announcements` ／管理者 `POST` | 一般=403（全操作）／管理者=201/200/204 | U.2／§1.6 |
| U-TC-106 | api | body_html サニタイズ（XSS 無害化）＋body_text 派生＋published_at 設定 | 管理者 | `POST /admin/announcements`（`body_html` に `<script>`/`onerror`/`javascript:` を含む・status=published） | 保存後の `body_html` から script/on*/javascript: が除去（許可タグのみ）／`body_text` は平文／`published_at` が設定される | U.2／U.4／N.7 |
| U-TC-107 | api | ピン留めトグル＋論理削除 | published 複数 | `PATCH /admin/announcements/{id}`（pinned 切替）／`DELETE` | pinned=true が一覧先頭／削除後は `GET /announcements`・`GET /announcements/{id}` から消える（論理削除・read 404） | U.2 |
| U-TC-110 | api | 本文画像の再ホスト（自社 MinIO・署名URL／管理者のみ） | 管理者＋PNG バイト／一般 | 管理者 `POST /admin/announcements/images`（multipart `file`）／一般も同 | 管理者=201・`{url}`＝自社ホスト署名URL（外部参照を持ち込まない）／一般=403 | U-8／U.4／§1.10 |
| U-TC-111 | api | 画像検証（非画像/シグネチャ不一致は 422） | 管理者＋非画像バイト | `POST /admin/announcements/images`（`file`＝text） | 422 `validation_error`（`errors[].field="file"`） | U-8／§1.10／N.7 |

## 3. ダッシュボード選別（§4.3a・U.3）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| U-TC-108 | int | ダッシュボードパネル選別＝ピン最優先→未読で埋める→既読かつ非ピンは出さない（最大3） | ピン2・未読非ピン2・既読非ピン1 | `dashboard/application.get_dashboard`（`announcements`） | ピン2件が先頭→未読非ピンで3件目まで埋める／既読かつ非ピンは出ない／`announcements_unread_count` 同梱／全件が「ピン無し＆既読」のときは空 | I.3／§4.3a |
| U-TC-109 | unit | お知らせ3件選別の純ロジック（ピン優先→未読→既読非ピン除外） | `pickDashboardAnnouncements(items, limit=3)`（純関数） | ピン/未読/既読の混在配列を与える | ピン（published_at 降順）→未読（同降順）の順で最大 limit／既読かつ非ピンは除外／ピン超過は公開日時で上位 limit | §4.3a |

## 4. フロント（画像再ホスト・U-8）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| U-TC-112 | unit | 貼付画像の再ホスト API クライアント（multipart 送信） | 画像 File | `uploadAnnouncementImageApi(file)` | `POST /admin/announcements/images` に FormData を送り（Content-Type は自動）`url` を返す | U-8 |
