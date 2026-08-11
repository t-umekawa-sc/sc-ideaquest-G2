# テストパターン K. プロフィール（自己編集・account_sync writer）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/K_プロフィール・背景画像.md`](../API設計/K_プロフィール・背景画像.md)（K.0 責務境界・K.2 プロフィール編集）・[`../データモデル.md`](../データモデル.md) §4.2（accounts＝identity 源泉）・§4.6（account_sync_outbox）・§5.3（users ミラー）。
> 本ファイルの対象＝**`PATCH /me`（表示名・ロケールの自己編集）**＝identity は管理DB `accounts` が源泉なので **accounts 更新＋同一Tx で account_sync_outbox INSERT**（会社DB `users` ミラーはワーカが結果整合で反映・§1.13）。
> **非対象（別スライス）**＝メール変更（K.3 `POST /me/email`＝再認証）／PW 変更（K.3）／画像（K.4 MinIO）／`GET /me` の残高・署名URL 同梱（K.1 全体）。`login_id` は変更不可（§4.2）。

## 前提（共通フィクスチャ）

- §1「前提」は [`A_認証.md`](A_認証.md)・[`B_会社・アカウント.md`](B_会社・アカウント.md) と共通（seed 会社 ACME-01・factory）。
- 自己編集の主体＝`factory.make_seed_company_account()`（ACME-01・会社DB users ミラーあり）でログインしたセッション。
- outbox のワーカ適用は `process_outbox_once()` を直接呼ぶ（常駐不要・B と共通）。

## 1. PATCH /me（表示名・ロケールの編集・K.2）

> 対象＝`GET /api/v1/me`（自分のプロフィール取得・identity サブセット）＋`PATCH /api/v1/me`（allowlist＝`display_name`/`locale` のみ）。範囲＝(a) 取得＝ログイン中の identity（`login_id`/`email`/`display_name`/`locale`/`system_role`）、(b) 更新＝accounts 更新＋同一Tx outbox enqueue→worker で users ミラー、(c) Mass Assignment 防止（allowlist 外は 422）・`locale` enum 検証、(d) 認可＝セッション必須（401）＋変更系 CSRF（403）。**GET /me は identity のみ＝残高・画像（署名URL）は K.1 全体＝別スライス**。非対象＝email/PW/画像（K.3/K.4）。前提＝ログイン済みセッション（seed アカウント）。出典＝K.1/K.2／§4.6／§5.3。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| K-TC-001 | api | ACME-01 実アカウントでログイン | `PATCH /me`（`display_name`＋`locale`） | `200`＋更新値を返す。**`accounts` 更新**＋**同一Tx で `account_sync_outbox` pending 1行**（`op=upsert`・payload に `display_name`/`locale`）→ `process_outbox_once` で **会社DB `users` にミラー** | K.2／§4.6／§5.3 |
| K-TC-002 | api | 同上 | allowlist 外（`system_role`/`login_id` 等）を送る／`locale` に不正値（`fr`） | いずれも `422`（想定外プロパティ拒否＝Mass Assignment 防止・§2.2／`locale` は `ja\|en` enum） | K.2／§2.2 |
| K-TC-003 | api | セッション無し／ログイン済み CSRF 無し | `PATCH /me` | 未認証＝`401 unauthenticated`（先）／セッション有り CSRF 無し＝`403 csrf_failed`（変更系・A.0） | A.0／B.0.1 P1/P3 |
| K-TC-004 | api | ログイン済み | `GET /me` | `200`＋`{login_id, email, display_name, locale, system_role}`（identity）。**機密は返さない**（PW ハッシュ等） | K.1／§B.6 |
| K-TC-005 | api | セッション無し | `GET /me` | `401 unauthenticated`（B.0.1 P1） | B.0.1 P1 |

## 2. frontend e2e（プロフィール編集・K.1/K.2）

> 対象＝`frontend/e2e/k-profile.spec.ts`（Playwright・階層 e2e）。範囲＝プロフィール画面（`/profile`）＝`GET /me` で現在値表示→表示名/ロケール編集→`PATCH /me`→再取得で永続。login_id/email/system_role は読み取り専用。email/PW・画像は別画面（K.3/K.4）。前提＝フルスタック。本人編集は共有 seed（ACME-01 ユーザー＝ヘッダーメニュー名依存の sc-00 テストがある）を汚さないよう OPS 管理者で検証。UI 設計の正＝共通ヘッダーのユーザーメニュー（K.0）。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| K-TC-006 | e2e | OPS でログイン | `/profile` で表示名を変更→保存→リロード | 「保存しました」表示・リロード後も新しい表示名（`GET /me` が更新値を返す＝永続） | K.1／K.2 |
