# ADR-0004 MFA（メールOTP）・信頼端末 基本パラメータ

- ステータス: **確定（2026-08-09 ユーザー承認）** / 値は運用で調整可（env・下記 [採用] 参照）
- 対象スライス: ドメイン A の状態C（MFA）＝`login` の `mfa_required` 分岐・`POST /auth/mfa/{verify,resend}`・信頼端末（`iq_trust`）・`POST /auth/logout-all`。**backend のみ**（frontend 状態C は後続）。
- 関連: [`../API設計/A_認証・セッション.md`](../API設計/A_認証・セッション.md)（A.0/A.1・正）・[`ADR-0001_認証・セッション基本パラメータ.md`](ADR-0001_認証・セッション基本パラメータ.md)（§2.6 ロック委譲）・[`ADR-0003_設定と秘匿情報の置き場所.md`](ADR-0003_設定と秘匿情報の置き場所.md)（設定は env）・[`../データモデル.md`](../データモデル.md) §4.4（`otp_challenges`）・[`../WEBアプリ開発時のセキュリティ対策一覧.md`](../WEBアプリ開発時のセキュリティ対策一覧.md)

> 目的＝状態C（メールOTP MFA）を実装するために、`A_認証・セッション.md` A.8 で「実装時に確定」とされていた MFA/信頼端末の具体値（OTP桁数/TTL/失敗上限/再送クールダウン・pre-auth TTL・信頼端末 TTL）と保持先を決める。
> 設計方針（pre-auth を本セッションと別実体＝最小権限・認証成功時に新セッションID・列挙耐性）は A.0/A.1 が正で、本 ADR はそれを**変更せず具体値と保持先を埋める**（[`ADR-0001`](ADR-0001_認証・セッション基本パラメータ.md)/[`ADR-0002`](ADR-0002_初回・再設定パスワード基本パラメータ.md) と同じ役割）。

---

## 1. コンテキスト

`A_認証・セッション.md` A.0/A.1 は状態機械（②未認証→pre-auth／③pre-auth→認証済み／④TTL切れ・失敗上限で pre-auth 破棄）・Cookie（`iq_preauth`/`iq_trust`）・列挙耐性・固定化対策を確定済み。一方 **OTP 桁数/TTL/連続失敗上限・resend クールダウン・pre-auth TTL・信頼端末 TTL**、および **login OTP と pre-auth をどこに保持するか**は A.8 で保留。状態C を動かすにはこれらが要る。

## 2. 決定

### 2.1 [採用] MFA のしきい値は環境変数（env）で管理・DB 不採用

[`ADR-0003`](ADR-0003_設定と秘匿情報の置き場所.md) §2.1 の原則（デプロイ環境軸→env／テナント軸→DB）に従う。OTP 桁数・各 TTL・失敗上限・クールダウンは**プラットフォーム共通のセキュリティ方針値**であり、会社ごとに変える設計要件は無い（テナント別に変わるのは `companies.mfa_required` フラグのみ＝DB）。既存の認証しきい値（ログインのレート制限＝[`ADR-0001`](ADR-0001_認証・セッション基本パラメータ.md) §2.6・PW再設定のレート制限＝[`ADR-0002`](ADR-0002_初回・再設定パスワード基本パラメータ.md) §2.3・セッション TTL）が**すべて `config.py`（env）にある**のと一貫させる。「プログラム修正なしで変更したい」は env（本番はシークレットマネージャ供給・[`ADR-0003`](ADR-0003_設定と秘匿情報の置き場所.md) §2.4）で満たせる。いずれも**非秘匿**（[`ADR-0003`](ADR-0003_設定と秘匿情報の置き場所.md) §2.3 の B 群）。

**[採用]（2026-08-09 ユーザー確認・運用で調整可）** 具体値:

| env 変数 | 意味 | 既定 |
|---|---|---|
| `otp_length` | メールOTP の桁数（数字） | 6 |
| `otp_ttl_seconds` | OTP 有効期限 | 600（10分） |
| `otp_max_attempts` | OTP 連続失敗上限（超過で pre-auth 失効＝A.0-④） | **5** |
| `otp_resend_cooldown_seconds` | resend クールダウン（経過前は 429＋`Retry-After`） | 30 |
| `preauth_ttl_seconds` | pre-auth（`iq_preauth`）の寿命＝MFA 完了までの猶予 | 600（10分） |
| `trusted_device_ttl_seconds` | 信頼端末（`iq_trust`）の TTL | 2592000（30日） |

### 2.2 [採用] login OTP と pre-auth は Redis に一体で保持（`otp_challenges` テーブルは `password_setup` 専用に留める）

pre-auth の実体は Redis（A.0）。**login OTP も同じ pre-auth レコード内（Redis）に保持**し、`otp_challenges` テーブル（管理DB）は初回・再設定 PW（`password_setup`・72h・単回）専用のままにする。

- **理由（意図的選択・コーディング規約 §3.5）**＝(1) login OTP は 10分で自動失効する揮発値で、Redis の TTL が最も素直（掃除不要）／(2) スタック方針が「Redis＝セッション/OTP/pre-auth」／(3) OTP と pre-auth はライフサイクルが一致（同じ 10分窓）＝別実体にする利点がない／(4) DB マイグレーション不要でスライスが小さい。
- **保持内容**＝`preauth:{token}` → `{account_id, company_id, otp_hash, otp_expires_at, attempts, resend_available_at}`（TTL＝`preauth_ttl_seconds`）。`otp_hash`＝OTP の SHA-256（[`ADR-0002`](ADR-0002_初回・再設定パスワード基本パラメータ.md) §2.1 と同様・平文は保存/ログ出力しない）。6桁の低エントロピーは**失敗上限＋TTL＋resend クールダウン**で守る（総当り 10^6 を実質不能に）。
- **pre-auth は 10分の硬い上限**＝resend しても pre-auth の TTL は延長しない（OTP のみ再発行）。無制限延長を防ぐ（A.0-④）。
- データモデル §4.4 の「`otp_challenges` purpose=`login`」は**将来 DB 保持へ寄せる余地を残した記述**として保持し、本 MVP は上記 Redis 実装を採る（機能・契約は A.1 と一致）。将来 OTP の監査/多デバイス管理が要件化されたら DB へ移す（別 ADR）。

### 2.3 [採用] 信頼端末は DB（`trusted_devices`・migration 0003）

`iq_trust` は 30日・restart を跨いで有効で、`logout-all` で失効させる必要がある永続状態＝**DB が適切**（Redis の揮発値とは性質が異なる）。

- テーブル `trusted_devices`（管理DB）＝`id / account_id / token_hash(SHA-256) / expires_at / revoked / created_at / last_used_at`。トークン平文は保存しない。
- **login 時**＝`iq_trust` を照合し、当該アカウントの**未失効・未期限切れ**の行があれば MFA をスキップして本セッション発行（A.0-①）。
- **mfa/verify 時 `trust_device=true`**＝新規トークンを発行し `trusted_devices` に登録＋`iq_trust` Cookie を張る。
- **logout-all**＝当該アカウントの全セッション破棄＋`trusted_devices` を全 `revoked`（A.0-⑤＝全端末で次回 MFA 必須）。

### 2.4 [採用] 状態遷移・Cookie・列挙耐性（A.0/A.1 準拠・具体化）

- **login `mfa_required` 分岐**＝資格照合が成功（PROCEED）した会社が `mfa_required=true` かつ信頼端末でない場合のみ。OTP をメール送信し `iq_preauth`＋`iq_csrf` を発行（pre-auth 中の verify/resend がダブルサブミットを満たせるように）。応答＝`200 { status:"mfa_required", mfa:{ delivery:"email", masked_to, expires_in, resend_available_in } }`。
  - **`masked_to` は列挙耐性を損なわない**＝`mfa_required` 分岐に到達する時点で PW 照合済み＝実在は本人に既知。未認証者は資格情報が正しくない限りここへ到達しない（A.9-⑤）。
- **mfa/verify**＝pre-auth 必須（無ければ `401 preauth_expired`）→ Origin → CSRF の順（認証を CSRF より先に評価＝A-TC-014/015 と同方針）。OTP 一致で pre-auth 消費＋**新セッションID**発行（固定化・A.0-③）。不一致は `401 otp_invalid { attempts_left }`、上限到達で pre-auth 破棄（以後 `preauth_expired`）。OTP 期限切れは `401 otp_expired`（resend 案内）。
- **mfa/resend**＝pre-auth 必須。クールダウン中は `429 rate_limited`＋`Retry-After`。旧OTP失効・新OTP発行（pre-auth TTL は据え置き）。応答＝`200 { expires_in, resend_available_in }`。
- **CSRF/Origin**＝login は CSRF 免除（Origin のみ・未認証起点）。verify/resend/logout-all は CSRF＋Origin 必須。

### 2.5 [委譲・範囲外] アカウント一時ロック

[`ADR-0001`](ADR-0001_認証・セッション基本パラメータ.md) §2.6 で「MFA/ハードニングスライスで確定」とした**アカウント一時ロック（連続失敗 N→T分・解除経路）**は、列挙耐性/DoS/解除経路との衝突整理が要るため**本スライスでも実装しない**（ユーザー決定 2026-08-09＝「MFA コア先行・ロックは後続」）。既存のレート制限（(IP＋login_id) 10回/5分＝[`ADR-0001`](ADR-0001_認証・セッション基本パラメータ.md) §2.6）と OTP 失敗上限（本 §2.1）で無防備にはならない。ロックは後続 ADR で確定する。

### 2.6 [範囲外・後続] frontend 状態C

SC-00 状態C（認証コード入力 UI）は本スライス対象外（backend を先に縦へ通す＝状態B/D と同じ順序）。frontend は後続スライスで `mfa/verify`・`mfa/resend` に配線する。

## 3. 検討した代替案（不採用）

- **MFA しきい値を DB（テナント設定/グローバル設定表）に置く**＝不採用。環境軸の共通方針値で、会社別に変える要件が無い（[`ADR-0003`](ADR-0003_設定と秘匿情報の置き場所.md) §2.1）。既存のしきい値が全部 env にあるのと不整合になる。
- **login OTP を `otp_challenges`（DB）に保持**＝不採用（本 §2.2 の理由）。将来要件化されたら移行（別 ADR）。
- **信頼端末を Redis に保持**＝不採用。30日永続・restart 越え・失効管理が要る＝DB が適切（§2.3）。
- **OTP 失敗上限を 3 / 10**＝不採用。3 は正規ユーザーの打ち間違いで pre-auth 失効しやすい／10 は 10分TTL 内の総当り試行を増やす。5 を採用（UX と耐性の均衡・運用で調整可）。

## 4. 影響 / 実装対象

- 実装＝`backend/app/core/config.py`（しきい値 env）・`backend/app/core/security.py`（pre-auth/OTP＝Redis・`generate_otp`）・`backend/app/control_plane/auth/`（`application`/`repository`/`domain`/`schemas`/`router` に MFA 分岐と verify/resend/logout-all）・`domain`（`mask_email`）・control migration **0003**＝`trusted_devices`（ORM に `TrustedDevice`）。`.env.example`/`compose.yaml` にしきい値。`scripts/bootstrap.py` に **MFA 必須のシード会社（`ACME-02`・`mfa_required=true`）**＋アカウント＋会社DB。
- テスト＝[`../テスト/A_認証.md`](../テスト/A_認証.md) §4（MFA）＝`mfa_required` 分岐・verify 成功/失敗上限/otp 期限/pre-auth 不在・resend クールダウン・信頼端末スキップ・logout-all。
- 2.1 しきい値・2.5 ロック委譲は **2026-08-09 にユーザー承認で確定**。frontend 状態C（2.6）は後続。
