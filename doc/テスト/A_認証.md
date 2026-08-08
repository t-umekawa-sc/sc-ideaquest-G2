# テストパターン A. 認証（状態A＝パスワードログイン）

> 規約＝[`テスト規約.md`](./テスト規約.md)。仕様の正＝[`../API設計/A_認証・セッション.md`](../API設計/A_認証・セッション.md)（A.0/A.1/A.6）・[`../API設計/README.md`](../API設計/README.md) §1.4/§1.7・[`../画面設計/screens/SC-00_ログイン.md`](../画面設計/screens/SC-00_ログイン.md)。具体値＝[`../ADR/ADR-0001_認証・セッション基本パラメータ.md`](../ADR/ADR-0001_認証・セッション基本パラメータ.md)。
> 本スライスの範囲＝**状態A（PWログイン）＋`GET /auth/session`＋`logout`**。MFA（状態C）・初回/再設定PW（状態B/D）は範囲外＝後続で TC 追加。
> 期待する `code`・スキーマは上記設計/OpenAPI が SoT（本表は参照。値は出典併記）。

## 前提（共通フィクスチャ）

- シード＝**会社1（`mfa_required=false`・`active`）**＋**アカウント1（`login_id=user@acme.example`・PW既知・`password_set=true`・`system_role=general`）**。会社DB users にミラー1件。
- 別途、テスト内で作る派生状態＝`password_set=false` のアカウント／`suspended` の会社。
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
- レート制限（ADR §2.6）の TC は閾値確定後に追加（A-TC-050 以降で予約）。
- MFA・初回/再設定PW の TC は状態C/B/D スライスで A-TC-030 以降に追加予定。
