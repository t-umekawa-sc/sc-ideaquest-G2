# U. お知らせ（運営告知・FR-49）

> 正本＝[ダッシュボード再設計・お知らせ 設計](../設計ドラフト/ダッシュボード再設計・お知らせ_設計.md) §4。横断規約＝[README](README.md)（§1.x＝認可/カーソル/DataTable クエリ契約/画像）。データ＝[データモデル](../データモデル.md) §5.65/5.66。
> 中核＝全社お知らせ（管理者が投稿・全ユーザー閲覧）。本文はリッチテキスト（保存時 `app/core/richtext.sanitize_html` で無害化・平文 `body_text` 併置）。通知（H）連携はしない。

## U.0 方針

- **閲覧＝全ユーザー**（`role=general` 可・公開会社でも閲覧可＝Step3 外周403許可リストに read を含める）。**投稿/編集/削除＝管理者のみ**（`company_account_admin`/`system_admin`・サーバー権威／UI非表示に依存しない・§1.6）。
- **表示対象**＝`status=published` かつ 掲載期間内（`starts_at<=now`〔or NULL〕 AND `now<ends_at`〔or NULL〕）AND `deleted_at IS NULL`。並び＝`pinned` 優先→`published_at` 降順。
- **body_html はサーバーで必ずサニタイズ**（受信値を信用しない・XSS 無害化）。`body_text` は `to_plain_text(body_html)` の派生（クライアントから受け取らない＝マスアサインメント防止）。
- 既読は `announcement_reads`（UNIQUE(announcement_id,user_id)・冪等）。

## U.1 閲覧（全ユーザー）

| # | メソッド/パス | 概要 | 認可 | 入出力 |
| --- | --- | --- | --- | --- |
| U-1 | `GET /announcements` | お知らせ一覧（published・掲載期間内・pinned→published_at 降順・カーソル） | 全ユーザー | query＝`cursor`/`limit`/`unread`（true で未読のみ）。応答＝`{data:[{id,title,body_text抜粋,pinned,published_at,is_read}], page_info:{next_cursor,has_next}, unread_count}` |
| U-2 | `GET /announcements/{id}` | 詳細（全文・`body_html`） | 全ユーザー | 応答＝`{id,title,body_html,pinned,published_at,starts_at,ends_at,created_by{display_name},is_read}`。表示対象外（draft/期間外/削除）は 404 |
| U-3 | `POST /announcements/{id}/read` | 既読化（冪等） | 全ユーザー | 応答＝`{is_read:true}`。既読済みでも 200（upsert・冪等） |

## U.2 管理（管理者のみ）

| # | メソッド/パス | 概要 | 認可 | 入出力 |
| --- | --- | --- | --- | --- |
| U-4 | `GET /admin/announcements` | 管理一覧（全件＝draft/archived も・pinned→published_at/created_at 降順） | 管理者 | 応答＝`{data:[{id,title,status,pinned,published_at,starts_at,ends_at,read_count}], can_manage}` |
| U-5 | `POST /admin/announcements` | 作成 | 管理者 | body＝`{title,body_html,status,pinned,starts_at?,ends_at?}`（`body_html` はサーバーで sanitize・`body_text` 派生・`status=published` 時に `published_at=now`） |
| U-6 | `PATCH /admin/announcements/{id}` | 編集（ピン留めトグル含む・部分更新） | 管理者 | body＝任意の `{title?,body_html?,status?,pinned?,starts_at?,ends_at?}`。`draft→published` で `published_at` 設定（未設定時）。無変更は API 抑制（§4.147 標準） |
| U-7 | `DELETE /admin/announcements/{id}` | 削除（論理） | 管理者 | 204。`deleted_at`/`deleted_by_id` 設定（一覧/詳細から消える） |
| U-8 | `POST /admin/announcements/images` | 本文貼付画像の再ホスト（自社 MinIO・署名URL） | 管理者 | multipart `file`。応答＝`{url}`＝自社ホスト署名URL。検証＝`validate_image_upload`（MIME allowlist＋サイズ＋シグネチャ・§1.10）。エディタが返却 URL で `img src` を置換（外部参照・`data:` を持ち込まない）。静的パス＝`/admin/announcements/{id}` より前に定義 |

> 画像再ホストの理由＝`sanitize_html` の許可スキームは http/https のみ（`data:` 画像は保存時に除去）。貼付/ドロップ画像は本EPで自社ホストへ再ホストし、`<img src="署名URL">` として本文に残す（`img` は許可タグ・N.7/U.4 と同一基準）。認可は投稿権限と同じ**管理者のみ**（情報インプット N.2 の再ホストは全ユーザーだが、お知らせは管理者のみが起稿するため）。

## U.3 ダッシュボード合成（I.3）

- `GET /dashboard` に `announcements`（§4.3a 選別＝ピン最優先→未読で埋める→既読かつ非ピンは出さない・最大3）＋`announcements_unread_count` を同梱（I の読取合成の殻で U の read を呼ぶ・新EPは増やさない）。

## U.4 セキュリティ

- body_html＝保存時 nh3 サニタイズ（許可リスト・N.7 と同一基準＝`app/core/richtext`）。表示は sanitize 済 `body_html` を `dangerouslySetInnerHTML`（nh3 済みで安全）。
- 管理EP＝管理者ロールをサーバーで強制（403）。read EP は公開会社の `role=general` も許可（外周許可リスト）。
- `body_text`/`published_at`/`created_by_id`/監査列＝サーバー生成（クライアントから受け取らない・§2.2 マスアサインメント防止）。
