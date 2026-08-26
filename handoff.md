# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-26**（セッション終了時・時刻は概算）。
- ブランチ: `main`。**作業ツリー＝本 handoff コミット前時点で「通知 H security_* の実装差分」が未コミット**（コード＋テスト＋設計/現況ドキュメント）。**まだ commit していない**（ユーザーの指示待ち）。
- セッション開始時の最新コミット: **`e55ddc1`** `docs(handoff): セッション終了…`（前セッション末）。origin/main と一致（ahead=0）で開始・整合確認済み。
- 本セッションの成果＝**通知ドメイン H の後半＝`security_*`（cross-plane 発火）を実装**（前セッションで H 前半＝テナント発火系フル＋SC-02 接続は完了済み）。コミット/push は未実施。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（dev モード起動）、バック＝FastAPI 4層（router/application/repository/infra）、DB＝PostgreSQL/Redis/MinIO/MailHog/Docker。開発は**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)＝アカウント→クエスト(C)→アイデア(D)→評価(F)→その他。**現況の正＝[`impl/README.md`](impl/README.md)**（画面別/EP別の済・未・追随更新）。

## 3. 今回やったこと（通知 H security_* ＝ cross-plane 発火）— スコープはユーザー選択（2026-08-26）

### スコープ確認（着手前の 3 問・ユーザー回答）
1. チャネル＝**設計通りメールも含む**（in-app＋メール）。
2. new_device 検知＝**設計通り両 MFA パス**（MFA-ON＝verify／MFA-OFF＝login）。
3. MFA-OFF の new_device 検知方式＝**iq_trust を端末認識に拡張（設計準拠）**＝有効 iq_trust 無し＝新端末。

### 3-A. メール基盤の拡張（`mail_outbox`）
- **migration `0012_mail_outbox_params`**（control）＝`mail_outbox.params jsonb` 追加（非秘匿の描画パラメータ。秘匿は従来通り `secret` に隔離）。
- `orm.py`（params 列）・`repository.enqueue(..., params=)`・`templates.render(..., params=)`＋新カテゴリ **`CATEGORY_NEW_DEVICE`**（ip/device/at を本文に）・**`CATEGORY_PASSWORD_CHANGED`**（固定文）・worker `application.py` が `entry.params` を render へ引き渡し。

### 3-B. 通知サービスの cross-plane 入口（H）
- `app/tenant/notifications/service.py` に **`notify_account(company_id, account_id, type, params)`**＝コントロールプレーン発火用。テナントDBで account→user を解決して post-commit `dispatch`（H.0・best-effort・at-most-once）。

### 3-C. セキュリティ発火ヘルパ（control-plane・DRY 集約）
- **新規 `app/control_plane/auth/security_events.py`**＝`fire_new_device` / `fire_password_changed`。3 チャネルを 1 箇所に集約（in-app＝`notify_account`／メール＝`mail_outbox`／監査＝`audit.record`）。auth・me の双方から共用。副作用の殻（例外は握り潰す・本処理成功を優先）。

### 3-D. 発火の結線
- **`security_new_device`**（A.9-⑧(a)）＝
  - `auth/application.py` `login`（MFA-OFF）＝有効 iq_trust 無しの成功時に new_device 発火＋**認識用 iq_trust を発行**（`result.trust_token`）＋`trusted_devices` 登録。既知端末（trust 一致）は静かに `last_used_at` 更新のみ。**メールも（MFA-OFF 前倒し）**。
  - `auth/application.py` `verify_mfa`（MFA-ON）＝OTP 成功＝毎回未登録端末＝new_device 発火（**in-app のみ**・メールは OTP と経路重複で送らない）。
  - router で `user_agent`（両EP）・`client_ip`（verify）を引き回し。**login router で `result.trust_token` があれば `iq_trust` クッキー発行**（従来は verify のみ）。
- **`security_password_changed`**（A.9-⑧(b)・in-app＋メール常時）＝
  - `auth/application.py` `complete_password_setup`（A 経路＝初回設定/自己再設定/管理者再設定の3経路共通）。
  - `me/application.py` `change_password`（K 経路＝自己PW変更）。

### 3-E. テスト（md 先行＋red-green）
- `doc/テスト/H_通知.md` に **§4 セキュリティ通知の発火**（**H-TC-151〜162**・6件・根拠列付き）を追記。
- `impl/backend/tests/notifications/test_security.py`（新規・6件）＝in-app＋メールを実データ照合（テナントDB 直読＋`mail.sent` subject）。
- **red-green 証跡**＝`security_events` の両ヘルパ先頭に `return` を一時差込→6件 red（`6 failed`）→撤去で green。`doc/テスト/red確認台帳.md` に H security の節を追記。
- **既存テストの追随修正**（login が new_device を副作用で作るようになったため）＝
  - `tests/notifications/test_api.py` `_login_new` が login 発火の `security_new_device` を除去（他種別の挙動検証に集中。H-TC-122 の `.one()` も回避）。`Notification` import 追加。
  - `tests/admin/test_audit_logs.py` b_tc_101/102 で login 後に `_clear_audit()`（read/認可失敗が監査しないことの検証に集中。login の `auth.login.new_device` 監査は仕様通り）。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. backend（pytest）
- **`pytest tests/`（全体）＝428 passed（0 failed）**（422→+6＝security 6）。cwd=`impl` 厳守・`docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。
- 会社/管理DB migration＝**control は 0012 が head**（`mail_outbox.params`）。適用は `scripts.bootstrap`（冪等）＝本セッションで control DB に 0012 適用済み確認。**backend イメージは本セッションで `up -d --build backend worker mail-worker` 済み**（実アプリに反映）。
### 4-2. frontend（tsc・e2e）
- **tsc＝既知1件のみ**（`Snackbar.tsx:122`）。**今回フロント変更なし**＝SC-02 は既に「security」種別を `["security_new_device","security_password_changed"]` にマップ済み＝backend が実データを出すだけでフィルタが機能する。
- **接続済み画面**（`impl/README.md` が正）＝前セッションから不変。SC-02 は security_* も実データ化。
- **e2e＝今回は未再実行**（フロント変更なし・backend 内部発火のみ）。前セッション green のまま。
### 4-3. テスト運用
- **TC-ID トレーサビリティ ✅（code 360）**＝`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（**repo ルートで実行**・impl 配下ではない）。

## 5. 詰まっている点（試した/注意）
- **login が通知/監査/メールを副作用で作るようになった**＝MFA-OFF の成功ログインは毎回 `security_new_device`（in-app＋メール）＋`auth.login.new_device` 監査＋`trusted_devices`／`iq_trust` を生む。**login/verify/complete を叩く既存テストが通知・監査・メール件数を厳密検証していると壊れる**（本セッションで notifications/test_api＋audit_logs を追随修正した）。今後 auth を跨ぐテストを足すときは同種の切り分けが要る。
- **system_admin/OPS 等「テナント user が無いアカウント」でも new_device の監査/メール/iq_trust は発火する**（in-app 通知だけ `notify_account` が no-op）。現状は無害だが、admin 系テストが `_audit()==[]` を見るなら login 後に掃除が必要。
- **teardown**＝`tests/conftest.py` が factory アカウントの `Notification`（recipient_id）・`TrustedDevice`・`mail_outbox`・`SystemAuditLog` を掃除済み。新テストは factory 実アカウント宛なので追加掃除不要。
- **cwd 罠**＝backend pytest/コマンドの `-v "$PWD/backend:/app"` は cwd=`impl` 前提。TC 検査は repo ルート。
- **既存フラキー**＝`tests/mail_outbox`/A-TC-038/040/063/068 系は全体実行の順序依存で稀に落ちるが単独 green・本セッション変更と無関係。
- **共有 control DB 汚染（継続注意）**＝dev 永続 `ideaquest_control` に手動 `t-umekawa`（非 OPS system_admin）。現状 428 passed で無害。汚染再遭遇時は §8 の psql で復元。

## 6. 決定事項と根拠
- **new_device 検知＝有効 iq_trust の有無**（設計 A.9-⑧(a)「未登録端末＝有効 iq_trust を持たない端末」に忠実）。MFA-ON は OTP を経た成功＝毎回未登録端末（trust 一致は login で MFA スキップ＝verify に来ない）。**MFA-OFF は iq_trust を「MFA スキップ」ではなく「端末認識」に流用**（初回は発行し以降は静か＝ノイズ回避）。logout-all/PW 変更で trust 失効→次回は再び新端末通知（説明性）。
- **メール**＝`security_password_changed` は常時（メール＋アプリ内）。`security_new_device` は **MFA-OFF 会社のみ前倒し**（MFA-ON は OTP と経路重複で価値小＝送らない）。
- **cross-plane 発火＝post-commit dispatch**（H.0）＝認証本処理コミット後に `notify_account`／`fire_*`。best-effort・at-most-once（本処理成功を優先・§3.5-(3)）。in-app 発火の宛先解決（account→user）は H 側（`notify_account`）、メール＋監査は control-plane 側（`security_events`）＝レイヤ分離。
- **メール描画値の置き場＝`mail_outbox.params jsonb`**（0012）＝秘匿（`secret`＝送信後 NULL 化）と非秘匿（`params`＝ip/device/at）を分離。password_changed は固定文＝params 不要。
- **監査**＝`auth.login.new_device`／`auth.password_changed` を必ず記録（A.9-⑧＝監査⑥とは別に本人通知）。
- （継続）テスト運用＝md 先行＋TC-ID トレーサビリティ＋red確認台帳。ブラウザ受入は後日バッチ（§7.5）。

## 7. 次にやること（優先順・具体的に）
1. **リアルタイム L（WS `notifications:{user_id}`）**＝`app/tenant/notifications/service.py` の `_publish` を実装（行 INSERT 後に Redis publish＝新着＋未読数）＋WS トランスポート（購読/転送）を新設。ヘッダーベルの未読バッジ即時更新。`doc/API設計/L_リアルタイム配信.md`・§1.12。**これで通知ドメイン H が完了**（現状の残＝配信のみ）。
2. **ダッシュボード集約 I（SC-01）**＝`doc/API設計/I_ダッシュボード集約.md`＋`doc/画面設計/screens/SC-01`。週間ランキング/下書き/未投票/参加中等を集約 EP で。SC-01 は現状ヒーロー残高（`/me`）のみ接続。
3. **全文検索 J（SC-12/SC-22）**＝`doc/API設計/J_全文検索.md`。
- いずれも着手前に `impl/README.md` の現況と該当 API/画面/データモデル正本を開く。**未着手の I/J/L に着手する前にユーザーへスコープ確認**（発火元/cross-plane/配信範囲で判断が要る）。
- **通知 H は security_* を含めて発火系フル完了**（残＝L=配信のみ）。security_* のメール本文/監査アクション名は実装済み（§3-A/§6）。

## 7.5 ブラウザ受入待ち（バッチ）
- **運用（ユーザー確認 2026-08-25）**＝各画面のブラウザ受入は後日まとめて実施（e2e green でクローズ扱い・次へ進む）。受入待ちの一覧は現況の正 [`impl/README.md`](impl/README.md)「ブラウザ受入状況」節に集約。security_*（新端末ログイン通知・PW変更完了通知）も後日ここへ追記推奨（dev＝MFA-OFF `ACME-01` を別端末/クッキー削除で再ログイン→新端末通知、`/me/password` で PW 変更→変更完了通知＋MailHog `:8025`）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。セッション終了時点で db/redis/minio/mailhog Up・backend/worker/mail-worker は本セッションで再ビルド済み。**frontend は起動していない場合あり**（今回フロント変更なし）。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **反映**＝frontend `... up -d --build frontend`／backend `... up -d --build backend worker mail-worker`。frontend 再ビルド後は playwright 再インストール。
- **会社/管理DB migration 適用**＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`（冪等・全DB＋シード）。
- **frontend tsc**＝`cd impl/frontend && npx tsc --noEmit`（既知1件＝Snackbar.tsx:122）。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。範囲限定＝`tests/notifications` 等。
- **e2e**＝(1)deps/browser 再インストール (2)`docker cp <spec>` (3)`redis-cli FLUSHALL` (4)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。1ファイルずつ・login コールドコンパイルで初回落ちたらウォームで再実行。
- **openapi 型再生成**（backend 再ビルド後）＝`cd impl/frontend && npm run codegen`（今回は新 EP 無し＝不要だった）。
- **TC-ID 検査**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。コミット前ゲート。
- **DB 直接確認**＝`docker compose -f impl/compose.yaml exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d ideaquest_control -c "..."'`。会社DB は `-d ideaquest_company_acme`（ACME-01）等。OPS 汚染復元＝`update accounts set status='active' where login_id='admin@ops.example';`。
- **dev ログイン（PW 全て `Passw0rd!`）**＝一般 `ACME-01`/`user@acme.example`（MFA OFF・「テスト 太郎」）／`ACME-02`/`mfa@acme2.example`（MFA ON）／system_admin `OPS`/`admin@ops.example`。手動追加 `SYSCON`/`t-umekawa`（非 OPS system_admin＝§5 注意）。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`。現況の正＝`impl/README.md`。UI 標準＝`doc/画面設計/デザイン標準.md`。API＝`doc/API設計/{A..L}_*.md`＋`README.md`（H＝`H_通知.md`・A＝`A_認証・セッション.md` A.9-⑧）。データモデル＝`doc/データモデル.md`（notifications＝§5.24・mail_outbox＝§4.7）。テスト＝`doc/テスト/H_通知.md`＋`red確認台帳.md`。
