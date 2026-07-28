# ドメイン A. 認証・セッション（コントロールプレーン）＝詳細確定（2026-07-27・再レビュー反映 2026-07-29）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.4 認証・セッション）を参照。本ファイルはドメイン A の分割レビュー成果＝各エンドポイントの req/res・状態遷移・エラー・画面対応。

対象画面＝**SC-00 ログイン**（3状態＝ログイン／認証コード(MFA)／初回パスワード設定。※初回パスワード設定状態は login 応答ではなく**メールリンク経由で開く**＝F3・A.1/A.7）。全エンドポイントは**コントロールプレーン**（管理DB `accounts`／`otp_challenges`／`trusted_devices`＋Redis）で完結し、会社DB へはルーティングしない。データモデル §4.1〜4.4・§8-①②⑨、コーディング規約 §1（フロントに認証ロジックを持たせない）準拠。

## A.0 状態機械・Cookie/トークン一覧

```mermaid
stateDiagram-v2
    [*] --> Unauth
    Unauth: 未認証
    PreAuth: pre-auth
    Authed: 認証済み

    Unauth --> Authed: login ①
    Unauth --> PreAuth: login ②
    PreAuth --> Authed: mfa/verify ③
    PreAuth --> Unauth: 失効 ④
    Authed --> Unauth: logout ⑤
```

**遷移の凡例**（エッジのラベルは短縮し、条件は下記に集約）:

| # | 遷移 | 契機・条件 | 結果 |
| --- | --- | --- | --- |
| ① | 未認証 → 認証済み | `login`（PW OK **かつ信頼端末**＝`iq_trust` 有効） | MFA をスキップして本セッション発行（`iq_session`＋`iq_csrf`） |
| ② | 未認証 → pre-auth | `login`（PW OK・**要MFA**） | OTP をメール送信・`iq_preauth`（既定10分）発行。最小権限＝`mfa/verify`・`mfa/resend` のみ受理 |
| ③ | pre-auth → 認証済み | `mfa/verify`（OTP 一致） | pre-auth 消費→本セッション発行。**認証成功時は常に新規セッションID**（固定化対策） |
| ④ | pre-auth → 未認証 | **10分TTL切れ** または **verify 連続失敗上限** | pre-auth 破棄＝`login` からやり直し |
| ⑤ | 認証済み → 未認証 | `logout`（現端末のみ）／`logout-all`（全端末＋`trusted_devices` 失効） | セッション破棄・Cookie 失効 |

- **`mfa/resend`（OTP再発行）は状態を変えない自己遷移**＝pre-auth に留まったまま OTP のみ再発行するため図では省略（レート制限は `resend_available_in` 経過後・§A.1）。

| 名前 | 種別 | 属性 | 目的・TTL |
| --- | --- | --- | --- |
| `iq_session` | Cookie | httpOnly / Secure / SameSite=Lax | 本セッションID。実体は Redis（`account_id`/`company_id`/`system_role` 等）。TTL＝アイドル延長（既定＝実装時確定・SC-00 §10） |
| `iq_preauth` | Cookie | httpOnly / Secure / SameSite=Lax | 未MFA中間状態の pre-auth トークンID。実体は Redis（`account_id`/`company_id`/`otp_challenge_id`・**既定10分**）。mfa/verify 成功で消費・削除 |
| `iq_csrf` | Cookie | **非httpOnly** / Secure / SameSite=Lax | ダブルサブミット用トークン。状態変更系で `X-CSRF-Token` ヘッダと一致必須（§1.4）。**セッション発行時・pre-auth 発行時に発行し、その期間は同一値**（画面遷移ごとの再発行はしない） |
| `iq_trust` | Cookie | httpOnly / Secure / SameSite=Lax | 信頼端末トークン（`trusted_devices`・**30日**）。login 時に照合、有効なら MFA スキップ |

- **pre-auth トークンはセッションと別実体（最小権限）**＝pre-auth では `GET /auth/session` や業務 API を一切通さない（`mfa_verify`／`mfa_resend` のみ受理）。
- **CSRF ／ Origin 検証は状態変更系の全 A エンドポイントに適用**。ただし `POST /auth/login` は未ログイン起点のため CSRF トークン検証は免除し **Origin/Sec-Fetch 検証のみ**（`iq_csrf` は login 成功時／セッション発行時に再発行）。**要MFA分岐で pre-auth を発行する時も `iq_csrf` を同時発行**する＝pre-auth 中の `mfa/verify`／`mfa/resend`（CSRF＋Origin 必須）がダブルサブミットを満たせるようにするため。
- **セッション固定対策**：**認証成功時は常に新しいセッションID を発行**（login 成功・mfa/verify 成功のいずれも。pre-auth は消費して破棄）。既存の未認証状態の値を昇格して使い回さない。
- **トークン生成**：`iq_session`/`iq_preauth`/`iq_csrf`・OTP・password_setup トークンは**暗号学的に安全な乱数（CSPRNG）**で生成し、意味のある情報を埋め込まない（セキュリティ一覧 3・13）。
- **Cookie スコープ最小化**：全 Cookie は `Path=/`・**Domain はホスト限定**（親ドメインへ広げない）。

### Cookie 属性値の意味（なぜこの設定か）

| 属性値 | 意味 | 本設計での狙い |
| --- | --- | --- |
| `httpOnly` | **JavaScript から `document.cookie` で読めない**（送信時にブラウザが自動付与するのみ） | **XSS でセッションID/トークンを窃取されない**ため。`iq_session`/`iq_preauth`/`iq_trust` は JS が触る必要がないので付与 |
| **非httpOnly**（`iq_csrf` のみ） | **JS から読める**（あえて httpOnly を外す） | フロントが Cookie 値を読んで `X-CSRF-Token` ヘッダに載せる**ダブルサブミット**方式のため（§1.4）。CSRF トークンは漏れても即被害にならない性質＝読めてよい |
| `Secure` | **HTTPS 接続でのみ送信**（平文 HTTP には乗らない） | 通信路での盗聴（中間者）を防ぐ。全 Cookie に付与 |
| `SameSite=Lax` | **クロスサイトのサブリクエスト（`<img>`/`fetch`/フォーム POST 等）では Cookie を送らない**。トップレベル GET 遷移（リンククリック）でのみ送る | **CSRF の一次防御**。`Strict` ではなく `Lax` にするのは、外部リンクから遷移した初回でもログイン状態を保つ UX のため（不足分は CSRF トークン＋Origin 検証で補強＝多層防御） |
| `Path=/` | このオリジンの**全パスに送信**（特定パスに限定しない） | アプリ全体で同一セッションを使うため。パスで絞る意味がある構成ではないので最小の広さ＝サイト全体に統一 |
| `Domain=`（未指定＝ホスト限定） | **発行元ホストだけに送信**（`Domain` を明示せず、親ドメインやサブドメインへ広げない） | 他サブドメインへ Cookie を漏らさない**スコープ最小化**。テナントはサブドメイン分離しない前提（§1.5・会社特定は会社コード）とも整合 |

- **補足**：`SameSite=Lax` と CSRF トークン（`iq_csrf`）と Origin/Sec-Fetch 検証は**それぞれ単独では穴があり得るため併用**（多層防御）。`iq_csrf` を非httpOnly にする代わりに、値が漏れても成立しないよう Origin/Sec-Fetch も必須にしている（§1.4）。

## A.1 エンドポイント一覧（`/auth`・コントロールプレーン）

| メソッド/パス | 概要 | リクエスト（ボディ/前提） | レスポンス（主なデータ・Set-Cookie） |
| --- | --- | --- | --- |
| `POST /auth/login` | 会社コード＋ID＋PW でログイン認証（未認証起点） | ボディ: `company_code`,`login_id`,`password`／前提: 認証不要・**CSRF免除（Origin/Sec-Fetch のみ）**・レート制限（IP＋login_id） | 2分岐（下記「レスポンス分岐」）＝`authenticated`／`mfa_required`。成功時 `Set-Cookie: iq_session,iq_csrf`（要MFA時は `iq_preauth`＋`iq_csrf`） |
| `POST /auth/mfa/verify` | pre-auth 中の OTP を検証し本セッション発行 | ボディ: `code`,`trust_device`／前提: **pre-auth（`iq_preauth`）必須**・CSRF＋Origin | `200 { status:"authenticated", session:{…§A.6} }`＋`Set-Cookie: iq_session,iq_csrf`（`trust_device=true` は `iq_trust` も）・`iq_preauth` 削除 |
| `POST /auth/mfa/resend` | OTP を再送（旧OTP失効） | 前提: pre-auth 必須・CSRF＋Origin・**レート制限**（`resend_available_in` 経過前は 429＋`Retry-After`） | `200 { expires_in:600, resend_available_in:30 }` |
| `POST /auth/logout` | 現在の端末をログアウト | 前提: 本セッション必須・CSRF＋Origin | `204`（現 `iq_session` を Redis 破棄・Cookie 失効） |
| `POST /auth/logout-all` | 全端末をログアウト＋信頼端末失効 | 前提: 本セッション必須・CSRF＋Origin | `204`（当該 `account_id` の**全セッション破棄＋`trusted_devices` を `revoked`**＝全端末で次回 MFA 必須） |
| `GET /auth/session` | 現在のセッション情報を取得（フロント初期化＝ロール別UI・言語） | 前提: 本セッション必須（pre-auth では 401）・CSRF不要（GET） | `200 { …§A.6 }`／未認証＝`401 { code:"unauthenticated" }` |

- **`POST /auth/login` のレスポンス分岐**（2分岐）:
  - **信頼端末で MFA スキップ／`mfa_required=false`**＝本セッション発行 → `Set-Cookie: iq_session, iq_csrf` ＋ `200 { "status":"authenticated", "session": { …§A.6 } }`。
  - **要 MFA**＝OTP をメール送信＋pre-auth 発行 → `Set-Cookie: iq_preauth, iq_csrf` ＋ `200 { "status":"mfa_required", "mfa": { "delivery":"email", "masked_to":"y****@acme.co.jp", "expires_in":600, "resend_available_in":30 } }`。
  - **初回パスワード未設定（`password_set=false`）は login では分岐しない（列挙耐性・F3 ハードニング）**＝PW 照合は必ず実行され、PW を持たない当該アカウントは他の失敗と区別せず**一律 `401 { "code":"unauthenticated" }`**。初回パスワード設定は **login 応答では誘導せず、メールリンク（A.7）に一本化**する（`password_set` 状態を未認証者に漏らさない）。
- **エラー・秘匿**:
  - `login`＝会社コード不正・login_id 不在・PW 不一致・**初回パスワード未設定（`password_set=false`）**はいずれも**一律** `401 { "code":"unauthenticated" }`（列挙耐性・SC-00 方針・F3）。会社 `suspended`＝**資格情報照合が成功した後に**`503 { "code":"company_suspended" }`（README §1.7 の code 表と統一・会社コードの有無を漏らさない・運営は別途 admin ログイン想定）。
  - `mfa/verify`＝OTP 不一致 `401 { "code":"otp_invalid", "attempts_left":n }`（連続失敗上限で pre-auth 失効＝`login` やり直し）／pre-auth 不在・期限切れ `401 { "code":"preauth_expired" }`／OTP 期限切れ `401 { "code":"otp_expired" }`（resend 案内）。
  - `mfa/resend`＝クールダウン中 `429 { "code":"rate_limited" }`＋`Retry-After`。
- **強制ログアウト（サーバー発火）**: 「全セッション破棄＋信頼端末失効」は logout-all 以外に、**ロール（`system_role`）変更・アカウント無効化(disable)・PW 変更/再設定**でもユーザー操作なしでサーバーが強制発火（トリガはドメイン B／A.7・詳細＝§A.9-③）。
- **SC-00／共通ヘッダー対応**: `login` 成功→ダッシュボード遷移／`mfa_required`→認証コード入力状態。`mfa/verify` 成功→ダッシュボード・失敗は残回数表示（上限でログイン画面へ戻す）。**初回PW設定状態は login からは遷移せず、メールリンク（A.7）で開く専用ルートで表示**（F3 ハードニング＝login 応答では `password_setup_required` を返さない）。ログアウト導線＝共通ヘッダーのユーザーメニュー。

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

## A.7 初回パスワード設定／再設定（`/auth/password-setup`）

用途＝**初回PW設定／管理者によるPW再設定**。入口は**メールリンク**（`otp_challenges` purpose=`password_setup`・単回トークン・**72h**・データモデル §4.4）。認証不要（トークンが本人性）・CSRF＝Origin のみ（未ログイン起点）。

| メソッド/パス | 概要 | リクエスト（ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `POST /auth/password-setup/verify` | リンクトークンの有効性を確認（設定画面の表示用） | ボディ: `token` | `200 { valid:true, login_id:"yamada" }`／無効・期限切れ・使用済＝`410 { code:"token_expired" }`（管理者再送を案内） |
| `POST /auth/password-setup/complete` | 新パスワードを設定して完了 | ボディ: `token`,`new_password` | `200 { status:"ok" }`（ログイン画面へ）。PWポリシー（§A.9）違反＝`422 { code:"validation_error", errors:[…] }` |

- `complete` 成功時＝PW 設定・`password_set=true`・**当該アカウントの全アクティブセッション破棄＋信頼端末を失効**（§A.9-③）・トークン消費。**accounts 更新と同一Tx で `account_sync_outbox` に upsert**（§1.13）。
- **SC-00 対応**: 初回パスワード設定状態のフォーム（PW／確認・表示切替）。

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
  - `logout`（現端末のみ）／`logout-all`（全端末・ユーザー操作）＝§A.1。
  - **`system_role` 変更・アカウント無効化(disable)・PW 変更/再設定**＝ユーザー操作なしで発火（トリガはドメイン B の admin 操作／A.7）。セッションは `system_role` を保持するため、ロール変更後の旧権限セッションを残さない（一覧 3-④、1・3-⑯）。
  - 併せて**無操作タイムアウト＋絶対有効期限を併用**（idle だけに頼らない・一覧 3-⑥）。
- **④ ブルートフォース／PW 品質**：ログインは**レート制限（IP＋login_id）に加え、失敗連続でアカウント一時ロック（＋任意で漸増遅延）**（一覧 1-⑧⑨）。PW 設定/変更時に**最低文字数＋漏えい済み・よく使われる PW の拒否**を検証（一覧 1-⑤⑥・具体値は §A.8）。
- **⑤ 秘匿・列挙耐性の徹底**：ログイン/OTP 失敗は一律メッセージ（本文）。**初回パスワード未設定（`password_set=false`）も `login` では区別せず一律 `401 unauthenticated`**＝「その login_id が実在し未設定」という状態を未認証者に漏らさない（初回PW設定はメールリンク A.7 に一本化・F3 ハードニング）。**`company_suspended` は資格情報照合が成功した後に判定**して返し（`503`）、未認証者に会社コードの有無を漏らさない（一覧 14・1-⑨）。認証・認可エラーの詳細を出しすぎない。
- **⑥ 認証イベントの監査ログ**：**ログイン成功/失敗・MFA 発行/検証結果・アカウント一時ロック・logout/logout-all・PW 設定/変更・ロール変更**を、操作者/日時/対象/結果/IP・UA とともに記録（一覧 15）。**PW・セッションID・OTP・各種トークンはログに出力しない**（一覧 3・15）。共通監査列（データモデル §2.1）とは別に、セキュリティ監査イベントの記録方針を実装時に具体化（保存先/期間＝§A.8）。
- **⑦ 他ドメインへ委譲（A では未実装・該当ドメインのレビューで確定）**：
  - **認証済みユーザーの自己 PW 変更＝現在の PW 再確認**（一覧 1-㉒）／**email・MFA 設定変更時の再認証**（一覧 1-㉓）＝**ドメイン K（プロフィール）** で設計（現状 A のメールリンク経路のみ）。
  - ロール変更・disable の**権限変更履歴の記録**（一覧 2-⑬）＝**ドメイン B**。

## A.10 設計判断（ADR）：Cookie＋Redis セッション vs JWT（2026-07-27）

**決定＝ブラウザ向けの認証は「httpOnly Cookie＋サーバー側（Redis）の不透明セッション」を採用し、JWT（アクセス/リフレッシュトークン）は MVP では不採用**（将来の外部/ネイティブクライアント向けに `Authorization: Bearer` 受理の余地のみ残す＝§1.4）。

### 背景・要件
本アプリは**単一 FastAPI バックエンド＋共有 Redis＋リバプロ同一オリジン**のブラウザ向け Web で、**セッションの即時失効を確定要件**とする（logout-all／ロール変更／アカウント無効化(disable)／PW 変更・再設定で全セッションを即無効化＝§A.9-③・B.2）。

### 比較（要点）
| 観点 | Cookie＋Redis 不透明セッション（採用） | JWT＋アクセス/リフレッシュ（不採用） |
| --- | --- | --- |
| 即時失効 | ◎ Redis 削除で即無効 | ✕ アクセストークンは exp まで有効。失効には denylist/introspection が必要＝ステートレスの利点が消える |
| XSS 耐性（トークン窃取） | ◎ httpOnly で JS から読めない | △〜✕ localStorage 保存は XSS で窃取可。httpOnly Cookie 保存にすると結局 CSRF 対策が要り「Cookie セッションの再発明」 |
| CSRF | 要（ダブルサブミット＋Origin＋SameSite で対処済み・§1.4） | Cookie 保存なら同様に要／ヘッダ方式は上の XSS 問題を抱える |
| 実装事故の余地 | 小（乱数 ID＋サーバー照合のみ） | 大（alg=none・HS/RS 混同・鍵管理・時刻ずれ・リフレッシュ盗難/ローテーション） |
| 秘匿情報の露出 | セッション ID は無意味な乱数 | JWT は claim 内包（Base64＝誰でもデコード可）。機密を載せない運用が必要 |

### 根拠
- JWT の主目的（**ステートレス水平スケール／サービス間・サードパーティ連携**）は本構成にほぼ効かない（共有 Redis・単一バックエンド・同一オリジン）。
- JWT のステートレス性は**即時失効の確定要件と正面から矛盾**する。両立させると「JWT＋サーバー側失効リスト」となり、Redis セッションと同じ状態管理をより複雑に再構築するだけ。
- 「最も安全なブラウザ向け JWT 構成」を突き詰めると **httpOnly Cookie＋CSRF＋サーバー側失効** ＝本設計に収束する。

### 再検討の条件（将来）
- 共有ストア無しで複数の独立サービスへトークンを持ち回る必要が出た場合、モバイル/外部 API/SSO（OIDC・現状 Could）が主体になった場合は、`Authorization: Bearer`（署名検証＋短命アクセストークン＋リフレッシュ回転＋失効リスト）を**追加**で検討（Cookie セッションは Web 向けに併存可）。
