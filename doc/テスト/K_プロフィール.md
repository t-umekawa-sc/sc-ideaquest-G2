# テストパターン K. プロフィール（自己編集・account_sync writer）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/K_プロフィール・背景画像.md`](../API設計/K_プロフィール・背景画像.md)（K.0 責務境界・K.2 プロフィール編集）・[`../データモデル.md`](../データモデル.md) §4.2（accounts＝identity 源泉）・§4.6（account_sync_outbox）・§5.3（users ミラー）。
> 本ファイルの対象＝**`PATCH /me`（表示名・ロケールの自己編集）**＝identity は管理DB `accounts` が源泉なので **accounts 更新＋同一Tx で account_sync_outbox INSERT**（会社DB `users` ミラーはワーカが結果整合で反映・§1.13）。
> **非対象（別スライス）**＝メール変更（K.3 `POST /me/email`＝再認証）／PW 変更（K.3）／画像（K.4 MinIO）／`GET /me` の残高・署名URL 同梱（K.1 全体）。`login_id` は変更不可（§4.2）。

## 前提（共通フィクスチャ）

- §1「前提」は [`A_認証.md`](A_認証.md)・[`B_会社・アカウント.md`](B_会社・アカウント.md) と共通（seed 会社 ACME-01・factory）。
- 自己編集の主体＝`factory.make_seed_company_account()`（ACME-01・会社DB users ミラーあり）でログインしたセッション。
- outbox のワーカ適用は `process_outbox_once()` を直接呼ぶ（常駐不要・B と共通）。

## 1. PATCH /me（表示名・ロケールの編集・K.2）

> 対象＝`GET /api/v1/me`（自分のプロフィール取得・identity サブセット）＋`PATCH /api/v1/me`（allowlist＝`display_name`/`locale` のみ）。範囲＝(a) 取得＝ログイン中の identity（`login_id`/`email`/`display_name`/`locale`/`system_role`）、(b) 更新＝accounts 更新＋同一Tx outbox enqueue→worker で users ミラー、(c) Mass Assignment 防止（allowlist 外は 422）・`locale` enum 検証、(d) 認可＝セッション必須（401）＋変更系 CSRF（403）。**GET /me は identity のみ＝残高・画像（署名URL）は K.1 全体＝別スライス**。**K.3 セキュリティ操作（PW 変更＝K-TC-007／メール変更ダブルオプトイン＝K-TC-008 要求・K-TC-010 確定）を本節に含む**（ADR-0008）。非対象＝画像（K.4 MinIO）。前提＝ログイン済みセッション（seed アカウント）。出典＝K.1/K.2/K.3／ADR-0008／§4.6／§5.3。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| K-TC-001 | api | accounts 源泉更新と同一Tx outbox によるミラー結果整合の担保 | ACME-01 実アカウントでログイン | `PATCH /me`（`display_name`＋`locale`） | `200`＋更新値を返す。**`accounts` 更新**＋**同一Tx で `account_sync_outbox` pending 1行**（`op=upsert`・payload に `display_name`/`locale`）→ `process_outbox_once` で **会社DB `users` にミラー** | K.2／§4.6／§5.3 |
| K-TC-002 | api | allowlist 逸脱と enum 違反の拒否＝Mass Assignment 防止 | 同上 | allowlist 外（`system_role`/`login_id` 等）を送る／`locale` に不正値（`fr`） | いずれも `422`（想定外プロパティ拒否＝Mass Assignment 防止・§2.2／`locale` は `ja\|en` enum） | K.2／§2.2 |
| K-TC-020 | api | アニメ演出のユーザー別設定 `reduce_motion` の編集＋配信（デザイン標準 §4.9） | ACME-01 実アカウントでログイン（既定 false） | `GET /me`／`PATCH /me`（`{reduce_motion:true}`→`false`） | `GET /me` の `account.reduce_motion` は既定 `false`。`PATCH` で `true`＝`200`＋応答 `account.reduce_motion=true`・**`accounts.reduce_motion` 更新**（account-only＝`users` へはミラーしない＝consumer が未知キー無視）。`false` に戻せる | K.2／§4.9 |
| K-TC-021 | unit(front) | アニメ抑制の実効判定（OS 最優先の下限）＝純ロジック | — | `isMotionReduced(osReduce, userReduce)`（`impl/frontend/src/lib/motion.ts`） | 実効 = `osReduce OR userReduce`。OS reduce なら常に抑制（ユーザー設定で ON に戻せない）／OS 通常でもユーザー OFF なら抑制／両方 false のみ演出あり | §4.9 |
| K-TC-003 | api | 未認証優先判定と変更系 CSRF ゲートの二段防御 | セッション無し／ログイン済み CSRF 無し | `PATCH /me` | 未認証＝`401 unauthenticated`（先）／セッション有り CSRF 無し＝`403 csrf_failed`（変更系・A.0） | A.0／B.0.1 P1/P3 |
| K-TC-004 | api | identity 取得での機密（PWハッシュ等）非露出の担保 | ログイン済み | `GET /me` | `200`＋`{login_id, email, display_name, locale, system_role}`（identity）。**機密は返さない**（PW ハッシュ等） | K.1／§B.6 |
| K-TC-005 | api | プロフィール取得の未認証遮断 | セッション無し | `GET /me` | `401 unauthenticated`（B.0.1 P1） | B.0.1 P1 |
| K-TC-007 | api | 自己PW変更＝現在PW再認証と全セッション破棄の担保 | ログイン済み | `POST /me/password`（現在PW不一致／新PWポリシー違反／正） | 不一致＝`403 reauth_failed`（セッションは有効＝401 と区別）／違反＝`422`／正＝`204`＋**全セッション破棄**（当該セッションで `GET /me` が 401）＋新PWでログイン可 | K.3／A.9-③ |
| K-TC-008 | api | メール変更要求は到達確認まで identity を変えない担保 | ログイン済み | `POST /me/email`＝**変更要求**（現在PW不一致／会社内重複／正） | 不一致＝`403 reauth_failed`／重複＝`409 conflict`（field=email）／正＝**`202`**＋**`accounts.email` は不変**・**`pending_email` に新メール**・`otp_challenges`（`purpose=email_change`）1件・**`mail_outbox` 2通**（`email_change_confirm`＝新宛＋`email_change_notice`＝旧宛）・**`account_sync_outbox` に email 行は積まれない**（確定時まで） | K.3／ADR-0008／§4.2 |
| K-TC-010 | api | 確認リンク到達で初めて確定＋確定時一意再検証（TOCTOU）の担保 | K-TC-008 で変更要求済み（`email_change` トークン発行） | `POST /me/email/confirm`（正常／無効・期限切れ・使用済みトークン／確定時の会社内衝突） | 正常＝**`200`**＋`accounts.email` が `pending_email` へ確定・`pending_email=NULL`・チャレンジ単回消費（`used_at` 打刻・データモデル §4.4）・**`account_sync_outbox` に `upsert{email}` enqueue**（→worker で users ミラー）／無効・期限切れ・使用済み＝`410 token_expired`／確定時に別アカウントが同 email を確定済み＝`409 conflict`（field=email）。**未認証EP**（トークンが認可）・セッション破棄なし | K.3／ADR-0008／§4.2／§4.4 |
| K-TC-011 | api | アバターベース体の選択が会社DB `users` に直接反映される担保（outbox 非経由） | ACME-01 実アカウントでログイン（既定 `male`） | `PUT /me/avatar-base`（`{base:"female"}`） | `200`＋更新後 `/me`（`profile.avatar_base="female"`）。**会社DB `users.avatar_base` が更新**・**`account_sync_outbox` は積まれない**（identity でない・K.4.1） | K.4.1／§5.3 |
| K-TC-012 | api | ベース値 enum 検証と allowlist 逸脱の拒否＝Mass Assignment 防止 | ログイン済み | `PUT /me/avatar-base`（未対応値 `{base:"animal_dog"}`／allowlist 外プロパティ同梱） | いずれも `422`（`base` は `male\|female` enum／想定外プロパティ拒否・§2.2）。**`users.avatar_base` は不変** | K.4.1／§2.2 |
| K-TC-013 | api | ベース変更の未認証優先判定と変更系 CSRF ゲートの二段防御 | セッション無し／ログイン済み CSRF 無し | `PUT /me/avatar-base` | 未認証＝`401 unauthenticated`（先）／セッション有り CSRF 無し＝`403 csrf_failed`（変更系・A.0） | A.0／K.4.1 |
| K-TC-014 | api | `GET /me` がベース体を同梱する担保（既定 `male`） | ログイン済み（未設定＝既定 `male`） | `GET /me` | `200`＋`profile.avatar_base` を含む（未設定は `male`） | K.1／K.4.1／§5.3 |

## 2. frontend e2e（プロフィール編集・K.1/K.2）

> 対象＝`frontend/e2e/k-profile.spec.ts`（Playwright・階層 e2e）。範囲＝プロフィール画面（`/profile`）＝`GET /me` で現在値表示→表示名/ロケール編集→`PATCH /me`→再取得で永続（K-TC-006）＋**セキュリティ（K.3 PW/メール変更）は同画面下部**＝PW 変更の error-path（K-TC-009）＋メール変更の error-path/要求 202 文言（K-TC-009(email)・ダブルオプトイン ADR-0008）を検証（**確定 happy は共有資格情報を壊すため踏まず** backend K-TC-007/008/010 が担保）。画像は K.4（別スライス）。前提＝フルスタック。本人編集は共有 seed（ACME-01 ユーザー＝ヘッダーメニュー名依存の sc-00 テストがある）を汚さないよう OPS 管理者で検証。UI 設計の正＝共通ヘッダーのユーザーメニュー（K.0）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| K-TC-006 | e2e | プロフィール編集の永続性（保存→再取得反映）の担保 | OPS でログイン | `/profile` で表示名を変更→保存→リロード | 「保存しました」表示・リロード後も新しい表示名（`GET /me` が更新値を返す＝永続） | K.1／K.2 |
| K-TC-009 | e2e | PW変更フォームの error-path 表示と共有資格情報の非破壊 | OPS でログイン・`/profile` | パスワード変更フォーム（確認不一致／現在PW不一致） | 確認不一致＝「一致しません」（クライアント）／現在PW不一致＝「現在のパスワードが正しくありません」（403 reauth_failed）。**成功パスは共有資格情報を壊すため踏まない**（happy は backend K-TC-007） | K.3 |
| K-TC-009(email) | e2e | メール変更要求のダブルオプトイン文言＝未反映であることの明示 | 同上 | メール変更フォーム（現在PW不一致／正しいPWで要求） | 不一致＝「現在のパスワードが正しくありません」（403）／正＝**「確認メールを … に送信しました」**（202＝ダブルオプトイン・この時点では未反映）。**要求は pending_email を立てるだけで email/PW を変えない**ため共有資格情報は壊れない。**確定（confirm）happy は踏まない**（backend K-TC-010 が担保） | K.3／ADR-0008 |
| K-TC-015 | e2e | SC-31 アバターのベース体切替が `PUT /me/avatar-base` で永続する担保（3D/2D フォールバック不問） | ACME-01 でログイン・`/avatar`（対象＝`e2e/sc-31-avatar.spec.ts`） | ビューアのベース切替（男↔女）→リロード | 切替後 `GET /me` の `profile.avatar_base` が更新値・リロード後も当該ボタンが `aria-pressed=true`（永続）。ビューアは **WebGL 時 3D Canvas／非対応は 2D マスコット**（progressive enhancement・§9.3）の**いずれかが描画**（不問）。**元値へ戻して cleanup**（共有 seed 非破壊） | K.4.1／SC-31 §9.2/§9.3 |
