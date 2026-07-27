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
- **セッション固定対策**：**認証成功時は常に新しいセッションID を発行**（login 成功・mfa/verify 成功のいずれも。pre-auth は消費して破棄）。既存の未認証状態の値を昇格して使い回さない。
- **トークン生成**：`iq_session`/`iq_preauth`/`iq_csrf`・OTP・password_setup トークンは**暗号学的に安全な乱数（CSPRNG）**で生成し、意味のある情報を埋め込まない（セキュリティ一覧 3・13）。
- **Cookie スコープ最小化**：全 Cookie は `Path=/`・**Domain はホスト限定**（親ドメインへ広げない）。

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
- **同じ「全セッション破棄＋信頼端末失効」を、ユーザー操作なしでもサーバーが強制発火**する契機＝**ロール（`system_role`）変更・アカウント無効化(disable)・PW 変更/再設定**（詳細＝§A.9 セッション失効ルール。トリガはドメイン B／A.7）。
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
  "system_role": "general",            // general | system_admin（QG管理者は system_role では表さず会社DB quest_group_members.role=admin で判定＝B案）
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
- `complete` req: `{ "token": "…", "new_password": "…" }` → PW 設定・`password_set=true`・**当該アカウントの全アクティブセッション破棄＋信頼端末を失効**（§A.9）・トークン消費。**accounts 更新と同一Tx で `account_sync_outbox` に upsert**（§1.13）→ `200 { "status": "ok" }`（ログイン画面へ）。PW ポリシー（§A.9）違反＝`422 { "code": "validation_error", "errors": […] }`。
- SC-00 対応: 初回パスワード設定状態のフォーム（PW／確認・表示切替）。

## A.8 未確定（実装時に確定でも可）

- **セッションの具体値**：無操作タイムアウト・**絶対有効期限**・pre-auth TTL（既定10分）・信頼端末 TTL（既定30日）の各値（SC-00 §10 の閾値。方針＝§A.9）。
- **ブルートフォース閾値**：ログイン失敗の一時ロック発動回数／解除時間、OTP 連続失敗上限、resend クールダウン秒、漸増遅延の有無。
- **PW ポリシー具体値**：最低文字数・文字種要件、漏えい済み/よく使われる PW 拒否リストの採否（方針＝§A.9-④）。
- **監査ログ**：保存期間・出力先（方針＝§A.9-⑥）。
- メール送信基盤（dev=MailHog／prod=SMTP）の接続設定＝実装フェーズ。

## A.9 セキュリティ対策マッピング／補強（`doc/WEBアプリ開発時のセキュリティ対策一覧.md` 突合・2026-07-27）

同一覧の **1.認証／3.セッション管理／7.CSRF／14.エラー処理／15.ログ・監査** をドメイン A に対応づけ、既定で満たす確定事項と補強を整理。CSRF/Cookie 属性/列挙耐性/MFA/初回PW設定/pre-auth 分離は本ファイル本文・README §1.4/1.7 で既定済み。以下は**追加で確定する補強**。

- **① PW ハッシュ**：`accounts.password_hash` は **Argon2id**（ソルト付き・コーディング規約 §3.4 `core/security.py`）。平文保存禁止・MD5/SHA-1 をパスワード用途に使わない（一覧 1・13）。
- **② セッション固定対策**：認証成功時に常に新規セッションID を発行（§A.0）。セッションID は CSPRNG・URL に含めない・意味情報を埋め込まない（一覧 3）。
- **③ セッション失効ルール（確定）**：以下でサーバーが**該当アカウントの全アクティブセッション破棄＋信頼端末失効**を強制する。
  - `logout`（現端末のみ）／`logout-all`（全端末・ユーザー操作）＝§A.4。
  - **`system_role` 変更・アカウント無効化(disable)・PW 変更/再設定**＝ユーザー操作なしで発火（トリガはドメイン B の admin 操作／A.7）。セッションは `system_role` を保持するため、ロール変更後の旧権限セッションを残さない（一覧 3-④、1・3-⑯）。
  - 併せて**無操作タイムアウト＋絶対有効期限を併用**（idle だけに頼らない・一覧 3-⑥）。
- **④ ブルートフォース／PW 品質**：ログインは**レート制限（IP＋login_id）に加え、失敗連続でアカウント一時ロック（＋任意で漸増遅延）**（一覧 1-⑧⑨）。PW 設定/変更時に**最低文字数＋漏えい済み・よく使われる PW の拒否**を検証（一覧 1-⑤⑥・具体値は §A.8）。
- **⑤ 秘匿・列挙耐性の徹底**：ログイン/OTP 失敗は一律メッセージ（本文）。**`company_suspended` は資格情報照合が成功した後に判定**して返し、未認証者に会社コードの有無を漏らさない（一覧 14・1-⑨）。認証・認可エラーの詳細を出しすぎない。
- **⑥ 認証イベントの監査ログ**：**ログイン成功/失敗・MFA 発行/検証結果・アカウント一時ロック・logout/logout-all・PW 設定/変更・ロール変更**を、操作者/日時/対象/結果/IP・UA とともに記録（一覧 15）。**PW・セッションID・OTP・各種トークンはログに出力しない**（一覧 3・15）。共通監査列（データモデル §2.1）とは別に、セキュリティ監査イベントの記録方針を実装時に具体化（保存先/期間＝§A.8）。
- **⑦ 他ドメインへ委譲（A では未実装・該当ドメインのレビューで確定）**：
  - **認証済みユーザーの自己 PW 変更＝現在の PW 再確認**（一覧 1-㉒）／**email・MFA 設定変更時の再認証**（一覧 1-㉓）＝**ドメイン K（プロフィール）** で設計（現状 A のメールリンク経路のみ）。
  - ロール変更・disable の**権限変更履歴の記録**（一覧 2-⑬）＝**ドメイン B**。
