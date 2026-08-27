# ドメイン K. プロフィール・背景画像（コントロール＋テナント）＝詳細確定（2026-08-08）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.10 添付〔MinIO・署名URL〕・**§1.13 アカウント同期 outbox**）を参照。認証・セッション失効・PW ポリシー・セキュリティ委譲は [`A_認証・セッション.md`](./A_認証・セッション.md)（**§A.9-⑦/⑧・§A.9-③**）、残高台帳の canonical は [`G_ゲーミフィケーション.md`](./G_ゲーミフィケーション.md)、通知発火は [`H_通知.md`](./H_通知.md)。本ファイルはドメイン K の分割レビュー成果。

対象画面＝**共通ヘッダーのユーザーメニュー**（プロフィール／背景画像の変更・リセット／パスワード変更／ログアウト）。背景画像設定は SC-01 §4.11（ユーザーメニューから設定・全認証画面に反映）。データモデル §4.2 accounts（identity 源泉）・§5.3 users（ミラー＋残高＋画像）・§4.6 account_sync_outbox・§8-⑬（ロケール）。コーディング規約 §1・**§2.2（Mass Assignment／再認証／画像アップロード制限）**・§3.1（薄い CRUD）準拠。

**この分割レビューでユーザー選択により確定（2026-08-08）**:
- **`display_name` の源泉＝管理DB `accounts`**（1b・`accounts.display_name` 列を追加・会社DB `users.display_name` はミラー）。identity（`login_id`/`email`/`locale`/`display_name`）を accounts に**源泉一元化**（DRY・会社DB側との上書き競合を排除）。
- **`GET /me` を正準のプロフィール＋残高エンドポイント**とする（ダッシュボード〔I〕は 1 往復のため hero を同梱＝両立・同じ `users` 読取）。

## K.0 責務境界・アクター・プレーン

- **責務**＝本人の**自己プロフィール**（表示名・ロケール・アバター/背景画像・メール・パスワード）の取得と編集。**プレーンをまたぐ**:
  - **identity（`display_name`/`email`/`locale`/`password`）＝管理DB `accounts` が源泉**。編集は `accounts` 更新＋**同一Tx で `account_sync_outbox` INSERT**（§1.13）＝会社DB `users` ミラーはワーカが結果整合で反映。**会社DB `users` のミラー列は直接更新しない**。
  - **プロフィール画像（`avatar_image_path`/`background_image_path`）＝会社DB `users` 所有**（テナント・MinIO・直接更新）。
  - **残高（`level`/`xp`/`coin_balance`/`skill_point_balance`）＝会社DB `users`（読み取り専用・canonical は G の `activities`）**。
- **アクター＝認証済みユーザー全員・自分のみ**（`/me`＝セッションの `account_id`/`company_id`・§1.5）。他人のプロフィール参照/編集は不可。未認証＝**401**。
- **導線**＝共通ヘッダーのユーザーメニュー。※3D アバターの**装備着せ替え**（VRM スロット）は**ドメイン G**（`PUT /me/equipment`）＝本ドメインの**プロフィール画像**（`avatar_image_path`）とは別物。
- **Mass Assignment 対策（§2.2）**＝各編集 EP は**受入フィールドを allowlist**。**残高・`system_role`・`status`・`password_set`・`login_id` は編集不可**＝これら allowlist 外のプロパティを含むリクエストは **`422 validation_error` で拒否**（想定外プロパティ拒否＝`extra=forbid`・黙って無視しない・コーディング規約 §2.2）。
- 認可失敗＝**403**／未認証＝**401**／再認証（現在PW不一致）＝**`403 reauth_failed`**（セッションは有効なので 401 と区別・K.3・[ADR-0008](../ADR/ADR-0008_メール変更のダブルオプトイン.md) と同コード）。

## K.1 プロフィール取得

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /me` | 自分のプロフィール＋残高（正準） | — | `{account:{login_id, email, locale}, profile:{display_name, avatar_image_url?, background_image_url?, avatar_base}, balance:{level, xp, xp_to_next, level_span, coin_balance, skill_point_balance}, system_role}` |

- **会社DB `users`（ミラー＋残高＋画像）から読む**（管理DB 往復なし・§1.13）。`display_name`/`email`/`locale`/`login_id` はミラー、残高は `users`、画像は**署名URL（§1.10）**に解決して返す（パスを直接返さない）。`avatar_base`（3D アバターの男女2ベース・§5.3）も `users` からそのまま返す（enum 文字列・署名URL 化不要）。
- **ヒーロー残高**は `GET /me` が正準。ダッシュボード（I）の `GET /dashboard` は 1 往復のため同じ `users` 読取から hero を**同梱し続ける**（両立・重複ではなく別用途＝I.1／G.0 と整合）。
- `xp_to_next`/`level_span` は G の純粋 level 関数で算出（データモデル §7・I.1 と同形）。

## K.2 プロフィール編集（表示名・ロケール）

| メソッド/パス | 概要 | リクエスト（ボディ・allowlist） | レスポンス |
| --- | --- | --- | --- |
| `PATCH /me` | 表示名・ロケールを編集 | `{display_name?, locale?}`（**この2つのみ**受理） | 200＋更新後の `/me`（K.1 形） |

- **`display_name`・`locale` はいずれも `accounts` 源泉**＝**管理DB `accounts` を更新＋同一Tx で `account_sync_outbox` INSERT**（§1.13）。会社DB `users` ミラーはワーカが反映（応答は更新値を即返す＝楽観的表示・実ミラーは結果整合）。**PATCH /me は単一のコントロールプレーン Tx**（両フィールドとも accounts のため跨ぎ書き込みが起きない）。
- **email・password は本 EP では変更しない**（重い/再認証が要る＝K.3 の専用 EP）。`login_id` は変更不可（固定・§4.2）。
- `locale` は `ja`/`en`（enum）を検証。`display_name` は文字数上限等をサーバー検証（具体値 K.6 TBD）。

## K.3 セキュリティ操作（パスワード変更・メール変更＝A.9-⑦ 委譲分）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /me/password` | 自己パスワード変更 | `{current_password, new_password}` | 204（**完了後は全セッション無効＝要再ログイン**） |
| `POST /me/email` | 自己メールアドレス変更を**要求**（確認リンクを新メールへ送付） | `{new_email, current_password}`（再認証） | 202（**確定待ち＝この時点では未反映**・[ADR-0008](../ADR/ADR-0008_メール変更のダブルオプトイン.md)） |
| `POST /me/email/confirm` | 新メールの確認リンクで変更を**確定** | `{token}`（**未認証**＝トークンが認可） | 200（`{status:"confirmed"}`・確定でミラー enqueue） |

- **パスワード変更（1-㉒）**：**現在の PW を再確認**（未認証＝`401 unauthenticated`／セッションは有効だが現在PW不一致＝`403 reauth_failed`）→ **PW ポリシー検証**（最低文字数・漏えい/よく使われる PW 拒否＝§A.9-④）→ `accounts.password_hash`（Argon2id）更新。**完了で §A.9-③＝当該アカウントの全アクティブセッション破棄＋信頼端末失効**（本人操作でも「なぜログアウトされたか」は通知で補足）。**`security_password_changed` 通知＋メール**を **K が H の `notify()` を post-commit で呼んで発火**（A.9-⑧(b)・H.0/H.1 の B-5 契約・付与契機はセッション解決とは無関係な本操作）。監査記録（A.9-⑥）。
- **メール変更（1-㉓）＝ダブルオプトイン（[ADR-0008](../ADR/ADR-0008_メール変更のダブルオプトイン.md) 確定・2026-08-12）**：
  - **要求（`POST /me/email`）**＝**再認証**（現在 PW）→ 新メールの**会社内一意**を検証（`UNIQUE(company_id, email)`・重複 409 field=email）→ `accounts.pending_email` に格納（`email` は**変えない**）＋ `otp_challenges`（`purpose=email_change`・単回・TTL `email_change_ttl_seconds`＝24h）発行 → **新メールへ確認リンク**（`mail_category=email_change_confirm`）＋**旧メールへ変更通知**（`email_change_notice`・乗っ取り検知）を `mail_outbox` へ enqueue → **202**（この時点で `account_sync_outbox` へは積まない）。
  - **確定（`POST /me/email/confirm`・未認証＝トークンが認可）**＝トークン照合（無効/期限切れ/使用済み一律 410）→ **会社内一意を再検証**（TOCTOU・衝突 409）→ `email=pending_email`・`pending_email=NULL`・**`email_verified_at=now`**（ダブルオプトインで到達確認済み＝「確認済み」概念を管理者経路と統一・[ADR-0009](../ADR/ADR-0009_管理者によるメールアドレス確認.md)）・チャレンジ単回消費 → **同一 Tx で `account_sync_outbox` へ `upsert{email}` enqueue**（会社 DB `users` ミラーは確定時）→ 監査記録。
  - **セッション破棄は必須化しない**（§A.9-③ は PW 変更/再設定・ロール変更・disable が対象。メール変更は要求時の再認証で担保・[ADR-0008](../ADR/ADR-0008_メール変更のダブルオプトイン.md) §2.5）。
- 列挙耐性＝本人操作（認証済み）なので実存漏洩の問題はない（A.9-⑧ と同じ整理）。

## K.4 プロフィール画像・背景画像（MinIO・§1.10）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `PUT /me/avatar-image` | プロフィールアバター画像を設定 | **multipart**: `file` | 200（`{avatar_image_url}`＝署名URL） |
| `DELETE /me/avatar-image` | アバター画像を削除（既定に戻す） | — | 204 |
| `PUT /me/background-image` | コンテンツ背景画像を設定（全認証画面に反映） | **multipart**: `file` | 200（`{background_image_url}`＝署名URL） |
| `DELETE /me/background-image` | 背景画像をリセット（既定背景へ） | — | 204 |

- **会社DB `users`（テナント）直接更新**＝`avatar_image_path`/`background_image_path`（MinIO オブジェクトキー）。**identity ではないため outbox は経由しない**。
- **サーバー検証（§2.2⑧・§1.10）**＝画像 MIME の allowlist・サイズ上限・**物理名はハッシュ**（元名を露出しない）。上限/許可形式/推奨解像度の具体値は K.6 TBD。
- **読取は短TTL 署名URL**（§1.10・**恒久公開URL は禁止**）＝`GET /me` や各画面はパスでなく署名URL を返す（アバターは一覧で多数表示されるため URL 発行/キャッシュ方針は実装で最適化・K.6）。
- **背景画像**＝個人設定として全認証画面に適用（SC-01 §4.11・フロントは認証済みレイアウトで共通適用）。会社が背景変更を禁止/固定できる管理設定の要否は SC-01 §10／K.6 TBD。

### K.4.1 アバターベース体（3D・男女2体）

| メソッド/パス | 概要 | リクエスト（ボディ・allowlist） | レスポンス |
| --- | --- | --- | --- |
| `PUT /me/avatar-base` | 3D アバターのベース体（男女2体）を選択 | `{base}`（`male`/`female`・**この1つのみ**受理） | 200＋更新後の `/me`（K.1 形） |

- **会社DB `users.avatar_base`（テナント）直接更新**＝プロフィール画像（K.4）と同じく**identity ではないため outbox は経由しない**（管理DB `accounts` 非関与）。既定は `male`（データモデル §5.3・調整可）。
- **`base` は `avatar_base` enum（`male`/`female`）を検証**（想定外値・allowlist 外プロパティは `422`＝Mass Assignment 防止・§2.2）。将来 `animal_*` を追加（画面 [`SC-31`](../画面設計/screens/SC-31_アバター着せ替え.md) §9.6）。
- **ドメイン境界**＝ベース体の**選択**は本人の恒久プロフィール属性のため **K**（本 EP）。一方、**装備の着せ替え**（VRM スロット・所有検証）は在庫/所有に依るため **G**（`PUT /me/equipment`・K.0/K.6）。両者は別物（画面 SC-31 は両方を使う）。
- 変更系＝Origin/CSRF 必須（A.0）。UI は SC-31 ビューアの「ベース切替（男/女）」（[`SC-31`](../画面設計/screens/SC-31_アバター着せ替え.md) §4.1/§9.2）。

## K.5 セキュリティ対策マッピング（§2.2 / A.9-⑦ 委譲・突合）

- **自己 PW 変更＝現在 PW 再確認（1-㉒）／email・MFA 変更＝再認証（1-㉓）**（K.3）。PW 変更完了＝**§A.9-③（全セッション破棄＋信頼端末失効）＋ `security_password_changed` 通知（K→H）**（A.9-⑧(b)）。**メール変更＝ダブルオプトイン**（新メールへ確認リンクで到達確認・確定まで pending・旧メールへ変更通知で乗っ取り検知・[ADR-0008](../ADR/ADR-0008_メール変更のダブルオプトイン.md)）。
- **Mass Assignment（§2.2）**＝編集 EP は受入フィールド allowlist。残高・`system_role`・`status`・`password_set`・`login_id` は不可。
- **IDOR（②）**＝`/me` はセッション本人（`account_id`）のみ。他アカウントの参照/編集経路を持たない。
- **画像（⑧）**＝allowlist/サイズ/ハッシュ名・**認可DL＝短TTL署名URL・恒久公開URL禁止**（§1.10）。
- **クロステナント/クロスプレーン**＝identity は `accounts` 源泉→outbox（会社DB `users` を直接書かない・§1.13）。`company_id` はセッション由来（§1.5）。
- **MFA**＝現状 MFA は会社設定（`companies.mfa_required`・SC-92）で**ユーザー個別トグルは無い**ため、K に per-user MFA 設定 EP は置かない。A.9-⑦ の「MFA 設定変更＝再認証」は**将来 per-user MFA を追加した場合**の要件として先取り記録（K.6）。

## K.6 他ドメイン境界・残 TBD

- **委譲/連携**＝残高台帳 canonical＝**G**（`activities`・K は `users` の残高を読むのみ）／identity 同期ワーカ＝**§1.13/§4.6**（accounts→users）／PW ポリシー・セッション失効機構＝**A**（§A.9-③/④）／`security_password_changed` 配信＝**H**（K が `notify()` を post-commit 呼び出し）／背景画像の全画面適用＝フロント（認証済みレイアウト）／VRM 装備着せ替え＝**G**（`/me/equipment`）。
- **確定済み（本レビュー）**＝`display_name` 源泉＝accounts（1b・`accounts.display_name` 追加・`users` はミラー）／`GET /me` 正準（I は集約で hero 同梱・両立）／`PATCH /me` は accounts+outbox 単一コントロールプレーン Tx／PW 変更＝現在PW再確認＋§A.9-③＋H 通知／画像は会社DB 直接＋署名URL。
- **確定済み（2026-08-12・[ADR-0008](../ADR/ADR-0008_メール変更のダブルオプトイン.md)）**＝**メール変更＝ダブルオプトイン**（新メールへ確認リンク・確定まで `accounts.pending_email` で pending・確定 EP は未認証＝トークンが認可）／**旧メールへ変更通知**（乗っ取り検知）／**確定時のセッション破棄はしない**（再認証で担保）／確認リンク TTL＝24h（`email_change_ttl_seconds`）／ミラー enqueue は**確定時**。
- **残 TBD（軽微・実装 or 運用で確定）**＝`display_name` 文字数上限・使用可能文字／画像の**サイズ上限・許可形式・推奨解像度**・アバター署名URL の発行/キャッシュ方針（一覧多数表示）／会社が背景変更を禁止/固定できる管理設定の要否（SC-01 §10）／**per-user MFA** の有無（現状は会社設定のみ）／`login_id` 変更可否（現状不可）／PW 変更後の再ログイン UX／メール変更 pending・期限切れトークンの物理掃除（現状は論理無効化のみ）。
