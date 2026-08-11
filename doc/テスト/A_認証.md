# テストパターン A. 認証（状態A＝PWログイン／状態B・D＝初回・再設定PW／状態C＝MFA）

> 規約＝[`テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/A_認証・セッション.md`](../API設計/A_認証・セッション.md)（A.0/A.1/A.6/A.7/A.9）・[`../API設計/README.md`](../API設計/README.md) §1.4/§1.7・[`../画面設計/screens/SC-00_ログイン.md`](../画面設計/screens/SC-00_ログイン.md)。具体値＝[`../ADR/ADR-0001_認証・セッション基本パラメータ.md`](../ADR/ADR-0001_認証・セッション基本パラメータ.md)（状態A）・[`../ADR/ADR-0002_初回・再設定パスワード基本パラメータ.md`](../ADR/ADR-0002_初回・再設定パスワード基本パラメータ.md)（状態B/D）・[`../ADR/ADR-0004_MFA・信頼端末基本パラメータ.md`](../ADR/ADR-0004_MFA・信頼端末基本パラメータ.md)（状態C）。
> 対象範囲＝**状態A（PWログイン）＋`GET /auth/session`＋`logout`**（§1・A-TC-001〜021）／**状態B・D（`password-setup` の request/verify/complete）**（§3・A-TC-030〜051）／**状態C（メールOTP MFA＝`mfa/verify`・`mfa/resend`・信頼端末・`logout-all`）**（§4・A-TC-060〜070）。
> 期待する `code`・スキーマは上記設計/OpenAPI が SoT（本表は参照。値は出典併記）。

## 前提（共通フィクスチャ）

- シード＝**会社1（`ACME-01`・`mfa_required=false`・`active`）**＋アカウント1（`user@acme.example`）。会社DB users にミラー1件。**MFA 用に会社2（`ACME-02`・`mfa_required=true`）**＋アカウント（`mfa@acme2.example`）も seed（会社DB `ideaquest_company_acme2` にミラー）。
- 別途、テスト内で作る派生状態＝`password_set=false` のアカウント／`suspended` の会社／`mfa_required=true` の会社（`factory.make_company(mfa_required=True)`）。
- エンドポイントは `/api/v1/auth/*`（ADR §2.1）。

---

## 1. テストパターン一覧

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-001 | api | シード会社(mfa=false)＋正アカウント | 正しい `company_code/login_id/password` で `POST /auth/login` | `200`＋body `{status:"authenticated", session:{…}}`、`Set-Cookie: iq_session, iq_csrf` の2本 | A.1（分岐1）／A.6 |
| A-TC-002 | api | 同上 | 正 ID＋**誤 password** | `401 {code:"unauthenticated"}`、Set-Cookie 無し | A.1（列挙耐性） |
| A-TC-003 | api | 同上 | **存在しない login_id** | `401 {code:"unauthenticated"}`（A-TC-002 と**同一レスポンス**＝区別不能） | A.1（列挙耐性） |
| A-TC-004 | api | 同上 | **存在しない company_code** | `401 {code:"unauthenticated"}`（同上・同一） | A.1（列挙耐性） |
| A-TC-005 | api | `password_set=false` のアカウント | 正 ID＋任意 password | `401 {code:"unauthenticated"}`、**`password_setup_required` を返さない**（F3 ハードニング） | A.1（分岐3）／SC-00 §5 |
| A-TC-006 | api | 会社が `suspended` | **正しい資格情報**で login | `503 {code:"company_suspended"}`（＝**資格照合が成功した後に**返す・会社コード有無を漏らさない） | A.1／README §1.5/§1.7 |
| A-TC-007 | api | 会社が `suspended` | **誤った資格情報**で login | `401 {code:"unauthenticated"}`（**503 を返さない**＝資格照合が先に落ちる。停止中会社の実在を非認証者に漏らさない・列挙耐性） | A.1（照合成功後に503） |
| A-TC-008 | api | — | `company_code`/`login_id`/`password` のいずれか欠落で login | `422 {code:"validation_error", errors:[…]}` | README §1.7 |
| A-TC-009 | api | — | login を **`X-CSRF-Token` 無し**で実行 | 成功する（login は CSRF 免除＝Origin/Sec-Fetch のみ） | A.0/A.1 |
| A-TC-010 | api | — | login を**不正 Origin** で実行 | 拒否（`403`）＝Origin/Sec-Fetch 検証 | A.0 |
| A-TC-011 | api | ログイン成功済み（有効 `iq_session`） | `GET /auth/session` | `200`＋A.6 スキーマ（`account_id/company_id/system_role/locale/user`） | A.1／A.6 |
| A-TC-012 | api | セッション無し | `GET /auth/session` | `401 {code:"unauthenticated"}` | A.1 |
| A-TC-013 | api | ログイン成功済み | `POST /auth/logout`（`X-CSRF-Token`＋`iq_csrf` 一致） | `204`、`iq_session` 失効。直後の `GET /auth/session` が `401` | A.1 |
| A-TC-014 | api | ログイン成功済み（有効セッション） | `POST /auth/logout` を **CSRF トークン無し**で | `403 {code:"csrf_failed"}`、セッションは維持 | A.0／README §1.7 |
| A-TC-015 | api | **セッション無し**（Cookie 無し） | `POST /auth/logout` | `401 {code:"unauthenticated"}`（本セッション必須・**認証を CSRF より先に評価**＝A-TC-014 の 403 と対） | A.1（本セッション必須） |
| A-TC-016 | api | — | login 成功時の Set-Cookie 属性を検査 | `iq_session`＝httpOnly・SameSite=Lax（本番 Secure）、`iq_csrf`＝**非httpOnly** | A.0（Cookie 表）／ADR §2.3 |
| A-TC-017 | api | login→（再）login | 2回目 login 成功後のセッションID | 毎回**新しいセッションID**（固定化対策・前値の使い回し無し） | A.0（固定化対策） |
| A-TC-018 | int | — | Redis セッションの保存/取得/TTL | `sess:{token}` に A.6 相当が入り、アイドルTTL が延長される | ADR §2.2 |
| A-TC-019 | int | — | 存在しないアカウントの login | **ダミーハッシュ照合**が走り、実在時との応答時間差が有意に出ない | ADR §2.5 |
| A-TC-020 | e2e | フルスタック起動 | SC-00 で正資格情報を入力しログイン | SC-01 に遷移し、保護ページが表示される（Cookie セッション確立） | SC-00 §5／A.1 |
| A-TC-021 | e2e | ログイン済み | 共通ヘッダーのユーザーメニュー→「ログアウト」 | `/login` に戻り、ログイン画面が表示される（セッション破棄） | デザイン標準 §4／A.1（logout） |

## 2. 補足・非対象

- **ログインボーナス XP**（A.1・G）は付与契機が「新しい JST 日の最初の認証済みリクエスト」で**ドメイン G の台帳**が絡むため、A スライスでは**セッションに `last_login_bonus_date` を保持するところまで**を確認対象とし、XP 付与自体の TC は G のテストパターンで扱う（本表では非対象）。
- レート制限（ADR-0001 §2.6・**ログイン**の 429）の TC は閾値確定後に追加（A-TC-050 で予約＝未使用）。
- 初回/再設定PW（状態B/D）の TC は §3（A-TC-030〜051）。MFA（状態C）は後続スライスで A-TC-052 以降に追加予定。

---

## 3. テストパターン（状態B・D＝初回・再設定パスワード）

> 仕様の正＝[`../API設計/A_認証・セッション.md`](../API設計/A_認証・セッション.md) A.7／A.9-③⑤。具体値＝[`../ADR/ADR-0002_初回・再設定パスワード基本パラメータ.md`](../ADR/ADR-0002_初回・再設定パスワード基本パラメータ.md)。画面＝[`../画面設計/screens/SC-00_ログイン.md`](../画面設計/screens/SC-00_ログイン.md) §3〜§8（状態B/D）。
> 3エンドポイント＝`POST /api/v1/auth/password-setup/{request,verify,complete}`。**初回設定・自己サービス再設定・管理者再設定は同一のメールリンク基盤**（`otp_challenges` purpose=`password_setup`・72h・単回）。
> 前提フィクスチャ＝§1「前提」と共通。派生状態（`password_set=false`／`disabled` アカウント／`suspended` 会社／期限切れ・使用済トークン）は factory / 直接 DB 操作で作る。メール送信は**フェイク送信**で捕捉（ADR-0002 §2.5）。

### 3.1 `request`（状態D＝再設定リクエスト・列挙耐性で常に 202）

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-030 | api | active 会社＋active アカウント | 正 `company_code/login_id` で `POST /password-setup/request` | `202 {status:"accepted"}`、**メール送信あり**（本文リンクに `token` を含む＝フェイク捕捉） | A.7／ADR-0002 §2.1/2.3 |
| A-TC-031 | api | 同上 | **存在しない login_id** | `202 {status:"accepted"}`（A-TC-030 と**同一応答**）、**メール送信なし** | A.7（列挙耐性・A.9-⑤） |
| A-TC-032 | api | 同上 | **存在しない company_code** | `202`（同一）、送信なし | A.7（列挙耐性） |
| A-TC-033 | api | `password_set=false`（初回未設定）の active アカウント | 正 ID で request | `202`、**送信あり**（＝初回設定リンクも同じ基盤・状態Bへ） | A.7／SC-00 §3 |
| A-TC-034 | api | `disabled` アカウント | 正 ID で request | `202`（同一）、**送信なし**（active のみ送信） | A.7（active のみ実送信） |
| A-TC-035 | api | `suspended` 会社 | 正 ID で request | `202`（同一）、**送信なし** | A.7（会社 active のみ実送信） |
| A-TC-036 | api | — | request を **`X-CSRF-Token` 無し**で | `202`（成功＝**CSRF 免除・Origin/Sec-Fetch のみ**） | A.7／A.0 |
| A-TC-037 | api | — | request を**不正 Origin** で | `403 {code:"forbidden"}`（Origin/Sec-Fetch 検証） | A.0 |
| A-TC-038 | api | 同一 (IP＋company_code＋login_id) | **6回連続** request（上限 5回/10分） | **すべて `202`**（超過を漏らさない）、6回目以降は**送信なし**（超過分は無送信で握る） | ADR-0002 §2.3（列挙耐性優先＝429 を返さない） |
| A-TC-039 | api | — | `company_code`/`login_id` のいずれか欠落で request | `422 {code:"validation_error", errors:[…]}` | README §1.7 |
| A-TC-040 | int | active アカウントに未使用 `password_setup` チャレンジが既存 | 再度 request | 旧トークンは**失効**（後続 verify で `410`）、新トークンのみ有効（最新のみ） | ADR-0002 §2.1 |

### 3.2 `verify`（状態Bの表示可否＝リンクの有効性確認）

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-041 | api | 有効な `password_setup` トークン | `POST /password-setup/verify {token}` | `200 {valid:true, login_id:"…"}` | A.7 |
| A-TC-042 | api | 未知/不正トークン | verify | `410 {code:"token_expired"}` | A.7 |
| A-TC-043 | int | `expires_at` 超過（72h 経過）トークン | verify | `410 {code:"token_expired"}` | A.7／ADR-0002 §2.1 |
| A-TC-044 | api | 使用済み（`used_at` あり）トークン | verify | `410 {code:"token_expired"}` | A.7（単回） |

### 3.3 `complete`（新PW設定・状態B→ログイン画面A）

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-045 | api | 有効トークン | 適合PW（8文字以上＋英字＋数字）で `POST /password-setup/complete {token,new_password}` | `200 {status:"ok"}`、`password_set=true`、**その後その PW で `POST /auth/login` が成功**（＝新PWが有効） | A.7／ADR-0002 §2.2/2.4 |
| A-TC-046 | api | 有効トークン | **ポリシー違反 PW**（短すぎ／数字なし／英字なし）で complete | `422 {code:"validation_error", errors:[…]}`、PW は変更されない | ADR-0002 §2.2 |
| A-TC-047 | api | 無効/期限切れ/使用済トークン | 適合PWで complete | `410 {code:"token_expired"}`、PW は変更されない | A.7 |
| A-TC-048 | api | complete 成功済みのトークン | 同一トークンで**再度** complete | `410 {code:"token_expired"}`（単回消費・トークンは消える） | ADR-0002 §2.1/2.4 |
| A-TC-049 | api | 当該アカウントで**別途ログイン中**（有効 `iq_session`）→ 有効トークンで complete 成功 | complete 後、そのセッションで `GET /auth/session` | `401 {code:"unauthenticated"}`（**PW完了で全アクティブセッション破棄**） | A.9-③／ADR-0002 §2.4 |

### 3.4 PW ポリシー（domain 純粋関数・DB 非依存）

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-051 | unit | — | PWポリシー判定関数に各種入力（7文字／数字なし／英字なし／適合）を与える | 適合＝エラー空、各違反＝対応する `errors[]`（最低8文字・英字必須・数字必須） | ADR-0002 §2.2 |

### 3.5 補足・非対象（状態B/D）

- **`account_sync_outbox`（会社DB `users` への `password_set` ミラー・データモデル §4.6）は実装済み**＝complete が accounts 更新と同一Tx で outbox に積み、常駐ワーカが会社DB へ反映する（TC は [`B_会社・アカウント.md`](B_会社・アカウント.md) B-TC-001〜005）。本 §3 の A-TC-045〜049 は管理DB `accounts` の更新＋全セッション破棄までを確認対象とする（ミラー反映は B の TC が担保）。
- **信頼端末（`trusted_devices`）失効**は状態C（§4・A-TC-070）で確認する。
- **セキュリティ通知**（`security_password_changed`・A.9-⑧）はドメイン H 実装時に TC 追加。

---

## 4. テストパターン（状態C＝メールOTP MFA・ADR-0004）

pre-auth/OTP は Redis、信頼端末は DB（`trusted_devices`）。OTP は `mail` フェイクの本文（`認証コード: NNNNNN`）から取り出す。しきい値は env（OTP 6桁・TTL 600s・失敗上限5・resend クールダウン30s・pre-auth 600s・信頼端末30日）。

### 4.1 `login` の `mfa_required` 分岐・`mfa/verify`・`mfa/resend`

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-060 | api | MFA必須会社＋正資格 | `POST /login` | `200 { status:"mfa_required", mfa:{delivery,masked_to,expires_in:600,resend_available_in:30} }`＋`Set-Cookie: iq_preauth,iq_csrf`（`iq_session` 無し）・OTP メール送信 | A.1／ADR-0004 §2.4 |
| A-TC-061 | api | pre-auth 有 | 誤 OTP で `mfa/verify` | `401 { code:"otp_invalid", attempts_left:4 }`（上限5） | A.1 |
| A-TC-062 | api | pre-auth 有 | 誤 OTP を上限まで（5回）→ 6回目 | 5回目 `attempts_left:0`→pre-auth 失効、6回目 `401 preauth_expired` | A.0-④ |
| A-TC-063 | api | pre-auth 有（seed MFA アカウント） | 正 OTP で `mfa/verify` | `200 authenticated`＋`iq_session` 発行・pre-auth 消費・`GET /session` 通る | A.0-③ |
| A-TC-064 | api | 同上 | `mfa/verify`（`trust_device=true`）→ 同端末で再 `login` | verify で `iq_trust` 発行＋`trusted_devices` 登録、再 login は `authenticated`（MFA スキップ） | A.0-① |
| A-TC-065 | api | pre-auth 無 | `mfa/verify` | `401 preauth_expired`（CSRF より先に評価） | A.0／A-TC-015 方針 |
| A-TC-066 | api | pre-auth 有・CSRF ヘッダ無 | `mfa/verify` | `403 csrf_failed`（pre-auth 401 の後） | A.0 |
| A-TC-067 | api | pre-auth 有（発行直後） | `mfa/resend` | `429 rate_limited`＋`Retry-After`（クールダウン中） | A.1／ADR-0004 §2.4 |
| A-TC-068 | api | pre-auth 有・クールダウン経過（Redis で `resend_available_at` を過去へ） | `mfa/resend` | `200 { expires_in:600, resend_available_in:30 }`・新OTP送信・旧OTPは `otp_invalid` | A.1／ADR-0004 §2.2 |
| A-TC-069 | api | pre-auth 有・OTP 期限切れ（Redis で `otp_expires_at` を過去へ） | 正 OTP で `mfa/verify` | `401 otp_expired` | A.1 |

### 4.2 `logout-all`（信頼端末失効）

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-070 | api | verify（`trust_device=true`）で信頼端末登録済み | `POST /logout-all` → 再 `login` | `204`（全セッション破棄＋`trusted_devices` 全 revoked）→ 再 login は再び `mfa_required` | A.0-⑤ |

### 4.3 補足・非対象（状態C）

- **frontend 状態C（認証コード入力 UI）は非対象**＝backend を先に縦へ通す（ADR-0004 §2.6）。後続スライスで `mfa/verify`・`mfa/resend` に配線＋e2e。
- **アカウント一時ロック**は §5（A-TC-071〜）で確定・実装（ADR-0005）。既存レート制限＋OTP 失敗上限の上に載る第二層。
- OTP を DB（`otp_challenges` purpose=`login`）に保持する案は非採用（Redis 一体保持・ADR-0004 §2.2）。将来 DB 化時に TC 追加。

---

## 5. テストパターン（アカウント一時ロック＝ログインハードニング・ADR-0005）

> 仕様の正＝[`../ADR/ADR-0005_アカウント一時ロック.md`](../ADR/ADR-0005_アカウント一時ロック.md)（§2.1 値・§2.2 (IP+login_id) 単位・§2.3 一律401・§2.4 通知・§2.5 解除・§2.6 OTP 非連動）。方針（列挙耐性＝一律 401）は [`../API設計/A_認証・セッション.md`](../API設計/A_認証・セッション.md) A.1 が正。
> しきい値は env（`login_lock_max_attempts`=5・`login_lock_ttl_seconds`=900・`login_lock_notify_cooldown_seconds`=3600）。ロック/計数/通知クールダウンは Redis（`login_fail_streak:{ip}:{login_id}`／`login_lock:{ip}:{login_id}`／`lock_notified:{account_id}`）。IP はテスト側で差し替える（`TestClient(app, client=(ip, port))`）。既存の (IP+login_id) レート制限（10回/5分＝429・ADR-0001 §2.6）とは別キー・別層。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-071 | api | ACME-01 実アカウント・IP=A | 誤PWで **5回**連続失敗 → 以後 IP=A から**正PWでも** login | 1〜5回目は `401 unauthenticated`、6回目以降は**ロックにより一律 401**（正PWでも通らない） | ADR-0005 §2.2/§2.3 |
| A-TC-072 | api | A-TC-071 でロック済み（IP=A） | **別 IP=B** から同一 login_id＋正PWで login | `200 authenticated`（ロックは **(IP+login_id) 単位**＝別 IP は非影響・可用性 DoS 回避） | ADR-0005 §2.2 |
| A-TC-073 | api | ロック中（IP=A） | ロック中の login 応答を検査 | `401 {code:"unauthenticated"}`・**`Retry-After` ヘッダ無し・残時間を返さない**（誤資格と同一＝列挙耐性） | ADR-0005 §2.3 |
| A-TC-074 | int | IP=A・login_id | 4回失敗 → **1回成功** → 再度失敗 | 成功で `login_fail_streak:{A}:{id}`／`login_lock:{A}:{id}` が消える（成功でカウンタ解除・以後は 1 から数え直し） | ADR-0005 §2.2 |
| A-TC-075 | int | IP=A・5回失敗でロック発火 | ロック発火後にさらに失敗試行 | `login_lock:{A}:{id}` の **TTL が増えない**（追加試行で延長しない＝発火から固定期間で必ず解ける） | ADR-0005 §2.2/§2.5(a) |
| A-TC-076 | api | ACME-01 実アカウントを IP=A でロック | 有効 `password_setup` トークンで complete（新PW）→ IP=A で新PW login | complete で**ロック即解除** → `200 authenticated`（PW 再設定で解除・§2.5(b)） | ADR-0005 §2.5 |
| A-TC-077 | api | ACME-01 実アカウント（mail フェイク） | IP=A で 5回失敗（発火） → 続けて **別 IP=B** で 5回失敗（再発火） | ロック通知メールは**ちょうど1通**（本人宛）。IP=B の再発火はクールダウンで**追加送信なし** | ADR-0005 §2.4 |
| A-TC-078 | api | **存在しない login_id**（mail フェイク） | IP=A で 5回失敗（発火） | ロックはされる（一律 401）が**通知メールは送られない**（実在 active のみ・列挙耐性） | ADR-0005 §2.4 |
| A-TC-079 | api | ACME-02（MFA）＝login は成功し pre-auth 発行 | `mfa/verify` の OTP を 5回誤り → 改めて login | login ロックは**発火しない**（OTP 失敗は非連動）＝再 login は再び `mfa_required`（ロックの 401 にならない） | ADR-0005 §2.6 |
| A-TC-082 | int | IP=A・login_id | **4回失敗** → 失敗計数の**固定窓 TTL 経過**（Redis で `login_fail_streak` を消して再現）→ **1回失敗** | 窓経過後の失敗は `login_fail_streak:{A}:{id}` を **1 から数え直す**（4→5 の累積扱いにならない＝**固定窓・延長しない**）→ ロックは**発火しない** | ADR-0005 §2.2/§2.5(a) |

### 5.1 補足・非対象（ロック）

- **管理者による強制解除・ロック可視化は非対象**＝管理面が整うまで後続（ADR-0005 §2.5・§5）。本スライスは (a) 15分自動解除＋(b) PW 再設定解除まで。
- **分散 IP 総当り**は (IP+login_id) 単位の原理的限界（ADR-0005 §2.2 トレードオフ）＝本 TC の対象外。
- 通知メールの**非同期化**は [`../ADR/ADR-0007_メール送信の非同期化.md`](../ADR/ADR-0007_メール送信の非同期化.md) で実装済（§7＝`mail_outbox` の TC）。本 §5 の A-TC-077/078 は**無改変で維持**＝`mail` フィクスチャの配信委譲（`conftest._DrainingMail`）が enqueue→ワーカ適用を吸収する。発火時点で同期送信しないことは §7 A-TC-093 が担保。

---

## 6. テストパターン（クライアント IP の確定＝信頼プロキシ・ADR-0006）

> 仕様の正＝[`../ADR/ADR-0006_クライアントIPの確定.md`](../ADR/ADR-0006_クライアントIPの確定.md)。(IP+login_id) 系（レート制限・ロック）が**実クライアント IP**で成り立つための IP 確定ロジック。純粋関数 `resolve_client_ip(peer_ip, forwarded_for, trusted_proxy_count)`（`core/net.py`）＝XFF を右から `trusted_proxy_count` ホップ分だけ自陣とみなし 1 つ外側を採る（左端固定取得はしない＝詐称耐性）。
> `trusted_proxy_count` は env（既定 0＝直アクセス/テストは `request.client.host`）。int テストは `TestClient` の `X-Forwarded-For` ヘッダと env 上書き（`monkeypatch`＋`get_settings.cache_clear()`）で確認。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-080 | unit | — | `resolve_client_ip` に各種入力（count=0／count=1 で XFF 追記／count=2／XFF 先頭に詐称値／XFF 空で count>0） | count=0→peer。count=Nは**右から N ホップ外側**の実クライアント IP。**先頭の詐称値は無視**。XFF 不足時は安全側で最外（chain[0]） | ADR-0006 §2.1/§3 |
| A-TC-081 | int | `TRUSTED_PROXY_COUNT=1`（`monkeypatch`）・ACME-01 実アカウント | 同一プロキシ経由で **XFF が異なる2クライアント**（A=203.0.113.1／B=203.0.113.2）。A で 5回失敗→A・B それぞれ正PWで login | A（XFF .1）はロックで 401、**B（XFF .2）は 200**＝ロックが**実クライアント IP 単位**に効く（プロキシ IP に潰れない） | ADR-0006 §2.1・ADR-0005 §2.2 |

### 6.1 補足・非対象（クライアント IP）

- **dev の Next.js `rewrites()` が XFF を転送するか**は本 TC の対象外（ADR-0006 §5・未検証）。本番はエッジで XFF 確定を必須化（[`../本番デプロイ要件.md`](../本番デプロイ要件.md) §1）。
- **起動時ガード**（`APP_ENV=prod`＋`TRUSTED_PROXY_COUNT=0` で警告ログ・ADR-0006 §2.2）はログ出力のみ＝本 TC では非対象。

---

## 7. テストパターン（メール送信の非同期化＝メールアウトボックス・ADR-0007）

> 仕様の正＝[`../ADR/ADR-0007_メール送信の非同期化.md`](../ADR/ADR-0007_メール送信の非同期化.md)（§2.4 独立処理・§2.5 sending 緩和/at-least-once・§2.6 enqueue で応答・§2.7 秘匿値の隔離/破棄）。テーブル＝[`../データモデル.md`](../データモデル.md) §4.7 `mail_outbox`。
> **非同期化の要点**＝`login`/`password-setup/request` の**処理中に SMTP は走らない**（`mail_outbox` へ enqueue するだけで即応答）。実送信は**メールワーカ `process_mail_outbox_once()` を直接呼ぶ**（§4.6 account_sync と同じくテストは常駐不要）。`mail` フェイク（`FakeMailSender`）はワーカ適用時に捕捉する。秘匿値（OTP コード／設定リンクのトークン）は `secret` 列に隔離し、**送信成功／端末失敗で NULL 化**（完成本文は保存しない）。
> **既存の同期送信前提 TC（A-TC-030/033/034/035/038/060/068/077/078 等）**＝テストハーネス側で吸収する。`mail` フィクスチャを **`.sent` 参照時に `process_mail_outbox_once()` で配信する薄い委譲**（`conftest._DrainingMail`）にしたため、既存 TC は**無改変で同じ期待（送信あり/なし・件数）**のまま通る（配信は冪等）。個別の **enqueue タイミング**（request で同期送信しない・秘匿値隔離）は本節 A-TC-090/092/093 が担う。ドメイン記号は横断範囲が狭いため **A に相乗り**（ADR-0007 §4）。

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| A-TC-090 | int | active 会社＋active アカウント | 正 ID で `password-setup/request` 実行後、`mail_outbox` を検査 | `category=password_setup` の行が 1 件 `pending`（`secret`＝設定リンクのトークン）。**request 時点で `mail.sent` は空**（同期送信しない）。`otp_challenges` 作成と**同一 Tx**（チャレンジが無ければ enqueue も無い） | ADR-0007 §2.6／§4.7 |
| A-TC-091 | int | A-TC-090 の後（`pending` 1 件） | `process_mail_outbox_once()` を呼ぶ | `mail.sent` に 1 通（本文リンクに token）。行は `status=done`・`processed_at` 記録・**`secret` が NULL 化** | ADR-0007 §2.5／§2.7 |
| A-TC-092 | int | MFA 必須会社＋正資格（要 OTP） | `login` 実行後に `mail_outbox` 検査 → `process_mail_outbox_once()` | login 応答は `mfa_required`（送信を待たない）。`category=otp` 行が積まれ（`secret`＝OTP コード）、ワーカで送信・`done`・`secret` NULL | ADR-0007 §2.6／§4.7 |
| A-TC-093 | int | ロック発火（誤 PW を上限回連続）・`mail` フェイク | 発火後に `mail_outbox` 検査 → `process_mail_outbox_once()` | `category=lock_notification` 行が 1 件（`secret` は NULL＝秘匿なし）。**発火リクエスト時点で `mail.sent` は空**（同期送信しない＝タイミングオラクル解消）。クールダウン内の再発火は enqueue しない → ワーカで 1 通 | ADR-0007 §1(a)／§2.6 |
| A-TC-094 | int | `pending` 1 件・送信が必ず例外を投げる sender | `process_mail_outbox_once()`（上限未満／上限超の2ケース） | 上限未満＝`attempts++`・`status=pending` 維持（次巡で再送）。**上限超（`mail_outbox_max_attempts`）で `status=failed`＋`secret` NULL** | ADR-0007 §2.5／§2.7 |
| A-TC-095 | int | 別宛先の `pending` が複数・先頭行のみ送信失敗 | `process_mail_outbox_once()` | 失敗行は `attempts++`、**後続の別行は送信される**（各メール独立・HOL ブロッキング無し＝§4.6 の直列適用と対照的） | ADR-0007 §2.4 |
| A-TC-096 | int | 1 行を `status=sending`・`claimed_at` を `mail_outbox_sending_reclaim_seconds` より過去に設定 | `process_mail_outbox_once()` | 滞留 `sending` 行が `pending` へ戻され再送される。**reclaim 未満の `sending` 行は触らない**（送信中を横取りしない） | ADR-0007 §2.5 |
| A-TC-097 | int | `done` 行（`processed_at` が retention より過去）／`done`（retention 内）／`failed` を各 1 件 | メールワーカの掃除を実行 | retention 超の `done` 行のみ削除。**retention 内の `done`・`failed` 行は残す**（`failed` は要手動対応） | ADR-0007 §2.7 |
| A-TC-098 | api | 送信が必ず失敗する sender を注入・**ワーカは実行しない** | `password-setup/request`（active 実在） | **`202` のまま**（`500` にならない）。SMTP は request 経路で走らない＝列挙耐性が SMTP 障害で崩れない | ADR-0007 §1(b)／§2.6 |
| A-TC-099 | api | 送信が必ず失敗する sender を注入・**ワーカは実行しない** | 誤 PW 連続でロック発火する `login` | **`401` のまま**（SMTP 失敗が応答に出ない＝ロック通知は enqueue のみで経路外） | ADR-0007 §1(b) |
| A-TC-100 | int | まっさらな子プロセスで `mail_outbox.application` だけを import | `ControlBase.metadata` を検査 | FK ターゲット `accounts`/`companies` が登録済み（別プロセスの `mail_worker` で `done` 書込が `NoReferencedTableError` にならない・**import 隔離バグの回帰防止**） | ADR-0007 §2.3 |

### 7.1 補足・非対象（メール非同期化）

- **`failed` 行の監視/アラート・手動再送 UI** は管理面が整うまで後続（ADR-0007 §5）。手動再送は新規 enqueue でやり直す（`secret` は破棄済み）。
- **クラッシュ窓の重複送信**（SMTP 成功〜`done` 書込の間・at-least-once）は無害として許容＝**重複しないことのテストは置かない**（原理的に排除しない・ADR-0007 §2.5）。
- **他ドメインの送信系メール**（`security_password_changed` 等・データモデル §8-⑳）は本基盤に将来載せる＝該当ドメイン実装時に TC 追加。
