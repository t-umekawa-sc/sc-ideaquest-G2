# ドメイン A. 認証・セッション（コントロールプレーン）＝詳細確定（2026-07-27）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.4 認証・セッション）を参照。本ファイルはドメイン A の分割レビュー成果＝各エンドポイントの req/res・状態遷移・エラー・画面対応。

対象画面＝**SC-00 ログイン**（3状態＝ログイン／認証コード(MFA)／初回パスワード設定）。全エンドポイントは**コントロールプレーン**（管理DB `accounts`／`otp_challenges`／`trusted_devices`＋Redis）で完結し、会社DB へはルーティングしない。データモデル §4.1〜4.4・§8-①②⑨、コーディング規約 §1（フロントに認証ロジックを持たせない）準拠。

## A.0 状態機械・Cookie/トークン一覧

```
[未認証] --login(PW OK・信頼端末あり)------------------------> [認証済み(iq_session)]
[未認証] --login(PW OK・要MFA)---> [pre-auth(iq_preauth・OTP発行済)] --mfa/verify(OK)--> [認証済み]
[pre-auth] --mfa/resend--> [pre-auth(OTP再発行)]
[pre-auth] --（10分TTL切れ / verify連続失敗上限）--> [未認証(要 login やり直し)]
[認証済み] --logout--> [未認証] ／ logout-all--> 全端末[未認証]＋trusted_devices失効
```

| 名前 | 種別 | 属性 | 目的・TTL |
| --- | --- | --- | --- |
| `iq_session` | Cookie | httpOnly / Secure / SameSite=Lax | 本セッションID。実体は Redis（`account_id`/`company_id`/`system_role` 等）。TTL＝アイドル延長（既定＝実装時確定・SC-00 §10） |
| `iq_preauth` | Cookie | httpOnly / Secure / SameSite=Lax | 未MFA中間状態の pre-auth トークンID。実体は Redis（`account_id`/`company_id`/`otp_challenge_id`・**既定10分**）。mfa/verify 成功で消費・削除 |
| `iq_csrf` | Cookie | **非httpOnly** / Secure / SameSite=Lax | ダブルサブミット用トークン。状態変更系で `X-CSRF-Token` ヘッダと一致必須（§1.4） |
| `iq_trust` | Cookie | httpOnly / Secure / SameSite=Lax | 信頼端末トークン（`trusted_devices`・**30日**）。login 時に照合、有効なら MFA スキップ |

- **pre-auth トークンはセッションと別実体（最小権限）**＝pre-auth では `GET /auth/session` や業務 API を一切通さない（`mfa_verify`／`mfa_resend` のみ受理）。
- **CSRF ／ Origin 検証は状態変更系の全 A エンドポイントに適用**。ただし `POST /auth/login` は未ログイン起点のため CSRF トークン検証は免除し **Origin/Sec-Fetch 検証のみ**（`iq_csrf` は login 成功時／セッション発行時に再発行）。

## A.1 `POST /auth/login`

- 認証: 不要（未認証起点）。CSRF: 免除（Origin/Sec-Fetch のみ）。レート制限あり（IP＋login_id）。
- req: `{ "company_code": "ACME-01", "login_id": "yamada", "password": "…" }`
- res（分岐）:
  - **信頼端末で MFA スキップ or `mfa_required=false`**＝本セッション発行 → `Set-Cookie: iq_session, iq_csrf` ＋ `200 { "status": "authenticated", "session": { …§A.6 } }`
  - **要 MFA**＝OTP をメール送信＋pre-auth 発行 → `Set-Cookie: iq_preauth` ＋ `200 { "status": "mfa_required", "mfa": { "delivery": "email", "masked_to": "y****@acme.co.jp", "expires_in": 600, "resend_available_in": 30 } }`
  - **要 初回パスワード設定**（`password_set=false`）＝PW 照合前に `200 { "status": "password_setup_required" }`（SC-00 は初回PW設定状態へ。実リンクはメール経由＝A.7）
- 監査/秘匿: 会社コード不正・login_id 不在・PW 不一致は**一律** `401 { "code": "unauthenticated" }`（列挙耐性・SC-00 方針）。会社 `suspended` は `403 { "code": "company_suspended" }`（運営は別途 admin ログイン想定）。
- SC-00 対応: 成功→ダッシュボード遷移／`mfa_required`→認証コード入力状態／`password_setup_required`→初回PW設定状態。

## A.2 `POST /auth/mfa/verify`

- 認証: **pre-auth（`iq_preauth`）必須**。CSRF＋Origin 検証あり。
- req: `{ "code": "123456", "trust_device": true }`
- res: 成功＝pre-auth 消費→本セッション発行 → `Set-Cookie: iq_session, iq_csrf`（`trust_device=true` なら `iq_trust` も）＋削除 `iq_preauth` ＋ `200 { "status": "authenticated", "session": { …§A.6 } }`
- エラー: OTP 不一致＝`401 { "code": "otp_invalid", "attempts_left": n }`（連続失敗上限で pre-auth 失効＝`login` やり直し）。pre-auth 不在/期限切れ＝`401 { "code": "preauth_expired" }`。OTP 期限切れ＝`401 { "code": "otp_expired" }`（resend 案内）。
- SC-00 対応: 認証コード入力→成功でダッシュボード／失敗は残回数表示・上限でログイン画面へ戻す。

## A.3 `POST /auth/mfa/resend`

- 認証: pre-auth 必須。CSRF＋Origin。**レート制限**（`resend_available_in` 経過前は `429 { "code": "rate_limited" }`＋`Retry-After`）。
- res: 新 OTP 発行・旧 OTP 失効 → `200 { "expires_in": 600, "resend_available_in": 30 }`。

## A.4 `POST /auth/logout` ／ `POST /auth/logout-all`

- 認証: 本セッション必須。CSRF＋Origin。
- `logout`＝現 `iq_session` を Redis から破棄・Cookie 失効 → `204`。
- `logout-all`＝当該 `account_id` の**全セッション破棄＋`trusted_devices` を `revoked`**（全端末で次回 MFA 必須）→ `204`。
- SC-00/共通ヘッダー対応: ユーザーメニューのログアウト導線。

## A.5 `GET /auth/session`

- 認証: 本セッション必須（pre-auth では 401）。CSRF 不要（GET）。
- res: `200 { …§A.6 }`。未認証＝`401 { "code": "unauthenticated" }`。フロントの初期化（ロール別 UI 出し分け・言語）に使用。

## A.6 セッション情報スキーマ（`session`）

```json
{
  "account_id": "acc_…",
  "company_id": "co_…",
  "company_code": "ACME-01",
  "system_role": "general",            // general | quest_group_admin | system_admin
  "locale": "ja",                       // ja | en（accounts源泉ミラー・§8-⑬）
  "user": {                             // 会社DB users の表示情報（会社DB解決後にミラーから）
    "user_id": "usr_…",
    "display_name": "山田 太郎",
    "avatar_url": "…"
  }
}
```

## A.7 `POST /auth/password-setup/verify` ／ `POST /auth/password-setup/complete`

- 用途: **初回PW設定／管理者によるPW再設定**。入口は**メールリンク**（`otp_challenges` purpose=`password_setup`・単回トークン・**72h**・データモデル §4.4）。認証不要（トークンが本人性）。CSRF＝Origin のみ（未ログイン起点）。
- `verify` req: `{ "token": "…" }` → res `200 { "valid": true, "login_id": "yamada" }`（設定画面の表示用）。無効/期限切れ/使用済＝`410 { "code": "token_expired" }`（管理者再送を案内）。
- `complete` req: `{ "token": "…", "new_password": "…" }` → PW 設定・`password_set=true`・**当該アカウントの信頼端末を失効**・トークン消費。**accounts 更新と同一Tx で `account_sync_outbox` に upsert**（§1.13）→ `200 { "status": "ok" }`（ログイン画面へ）。PW ポリシー違反＝`422 { "code": "validation_error", "errors": […] }`。
- SC-00 対応: 初回パスワード設定状態のフォーム（PW／確認・表示切替）。

## A.8 未確定（実装時に確定でも可）

- セッション TTL／アイドル延長の具体値・OTP 連続失敗上限回数・resend クールダウン秒（SC-00 §10 の閾値）。
- PW ポリシー（長さ・文字種）の具体値。
- メール送信基盤（dev=MailHog／prod=SMTP）の接続設定＝実装フェーズ。
