# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-07（セッション末・FR-48② SEC強化4点まで完了）
- ブランチ: `main`（main 直 push が慣習・本セッションも都度 push 済）
- 最新コミット: `b3930606 feat(signup): セルフサインアップ SEC強化4点（CAPTCHA/漏洩PW/使い捨てメール/管理者通知）FR-48②`
- working tree: **clean**（全コミット＆push 済み・この handoff コミットを除く）。
- alembic heads（ファイル基準）: control=`0020_signup_challenges`（**本セッションで追加**）／company=`0054_announcements`。
- 本セッションのコミット（古→新）: `768b2ea5`（info テスト冪等化）/`e43b3489`（公開モード業務ルート404存在秘匿＋SC-50導線）/`a9ec44e3`+`676294a3`（お知らせ公開閲覧可）/`f111d4d2`（FR-48②設計反映）/`b0ddb6fc`（FR-48② backend）/`b1da82d3`（FR-48② frontend）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近はアイデアコンテスト（FR-46）＋公開/非公開モード＋セルフサインアップ（FR-48）。

## 3. 今回やったこと（優先順＝不具合→公開モード詰め→FR-48②。ユーザー指示の 4>2>3>1 順）
### ④ 現況洗い出し（コードで裏取り・done が多いmemory通り）
- FR-48② は列 `self_signup_enabled` のみ存在・EP/画面/frontend 未実装だった（→本セッションで実装）。

### ② info ドメイン pytest 4失敗の冪等化（`768b2ea5`）
- 真因＝フィクスチャが seed ユーザ `user@acme` 流用で、同ユーザのデモ/受入 info（curated/threat/「ブロックチェーン」）が共有dev DBに残存し `_own(user_id)` を貫通。**製品バグではなくテスト隔離**。
- 修正＝`tests/info` を `test_n_tc_005` の hermetic パターンに統一（`_mine(stmt, env)`＝フィクスチャ作成IDに限定・conftest に `item_ids` 追加・api 105 は積集合）。`tests/info` 80 passed を2連続（冪等）。

### ③ 公開モードの詰め（`e43b3489`／`a9ec44e3`＋`676294a3`）
- **(a)** SC-50 `ContestListView` を public×general で backlink/作成ボタン非表示（`contests/page.tsx` が `getServerMe`→publicMode を prop）。
- **(b) 外周ガードを 403→404＝存在秘匿（決定P'・ユーザー選択=API+ページ両面404）**＝backend `access_gate` を `not_found`／frontend は業務ルート群13個の `layout.tsx` が `requireNotPublicMode()`（`lib/me.ts`）で `notFound()`。ideas/contests/notifications/profile/admin は許可で非ガード。
- **(c)** `IQ_DEFAULT_COMPANY_CODE` は `/public/bootstrap` と不可分のため①に同梱（実装済）。
- **お知らせ公開閲覧可**（会社DBスコープ＝他社漏れなし）＝`_CONTEST_ALLOW` に `/announcements`（read）追加・frontend ガード除外・公開ナビに📢。管理は `/admin/announcements`（管理者のみ）。
- 設計正本6文書＋メモリ `contest-access-control-design` を 404 に整合。目視＝public で /quests・/shop=404／/contests・/announcements=200／private=通常（回帰なし）。

### ① FR-48② セルフサインアップ（設計先行→承認→実装・全完了）
- **設計反映**（`f111d4d2`）＝データモデル §4.4a `signup_challenges`／API設計A §A.11.3詳細＋A.11.4 MVP境界／SC-05新規＋SC-00更新／A_認証.md TC／設計§8.2・決定ログ（SEC-A'/I'/MVP）。
- **backend**（`b0ddb6fc`）＝migration 0020（control・`signup_challenges`）＋DEMO会社 seed（public＋self_signup・bootstrap）＋`app/control_plane/public`（4層）。3EP＝`GET /public/bootstrap`・`POST /public/signup`（一律202・SEC B／会社解決+self_signup再検証 SEC F／PW即Argon2id SEC D／pending+OTP SEC A/C／Origin SEC G／レート制限）・`POST /public/signup/verify`（コード検証[定数時間/attempts/expiry/単回]→同一Txで accounts INSERT[role=general権威 SEC E]+会社DBミラー+used_at→自動ログインしない SEC I=200のみ）。`tests/auth/test_self_signup.py` 8 passed（red→green）。
- **frontend**（`b1da82d3`）＝codegen＋`features/auth/api.ts`（getBootstrap/signup/signupVerify）＋SC-05 `SignupForm`（3段：入力→OTP〔SC-00状態C同形〕→完了→/login プリフィル誘導）＋SC-00 `LoginForm`（会社コード出し分け・作成導線・プリフィル）。
- **E2E 目視検証済**（worker 起動時）＝/signup→202→OTP(mail_outbox.secret)→確定→accounts=general|active|email_verified→/login に会社コード/ID プリフィル・PW空（自動ログインせず）→手動ログインで /contests 着地。検証アカウントは掃除済み。

## 4. 現在の状態（動作/テスト）
- **backend pytest**＝`tests/auth`+`mail_outbox`+`account_sync` 110 passed／`tests/info` 80／`me`+`admin`+`contests`+`dashboard` 193／`contests` 39（いずれも本セッションで実行・green）。
- **frontend build**＝`cd impl/frontend && npm run build` ✅。**codegen 済**（/public/* 型取込）。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅（code 1003件）。
- コンテナ＝`cd impl && docker compose up -d`（backend/frontend は本セッションの変更を `--build` 反映済）。**worker/mail-worker は既定 up では起動しない**（`--profile workers` が要・下記 §5）。ACME-01 は private に復元済み。

## 5. 詰まっている点（試して失敗/注意）
- **signup 検証/会社DBミラーは account_sync worker 依存**＝signup verify は accounts 作成＋`account_sync_outbox` に会社DBミラーを積むだけ。**worker 未起動だとミラー未適用でログイン不可**（admin API 作成アカウントも同様）。E2E でログインまで見るなら `docker compose --profile workers up -d worker`。確認後 `docker compose stop worker`。
- **mail worker 未起動でも OTP は取れる**＝`mail_outbox.secret` に平文コードが残る（テスト/検証はここから読む）。
- **baked backend の pytest は未コミット編集を反映しない**＝`docker compose up -d --build backend` か `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest …`（-v マウント）。
- **公開モード手動確認は共有 seed の access_mode を直接書き換えない**（並列テストを壊す）＝pytest は `access_gate._resolve` monkeypatch。手動で ACME を public にしたら**必ず private へ戻す**。
- **DEMO 会社でログイン検証すると会社DBに user/activities/user_achievements/notifications 等が残る**＝掃除は子テーブル（notifications/user_achievements/activities）→users の順（FK）。本セッションは掃除済み。

## 6. 決定事項と根拠（不採用案も）
- **決定P'（2026-10-07）＝外周ガード 403→404（存在秘匿）**＝403は「存在するが不可」を露呈。API＋frontend 両面で業務ルートを404にし「存在しない」を一貫。不採用＝403のまま（存在露呈）。
- **お知らせは公開会社でも閲覧可**＝会社DBスコープ（他社漏れなし）。read は許可リスト／管理は `/admin/announcements`（管理者のみ）。
- **SEC-A'＝pending は専用テーブル `signup_challenges`**＝`otp_challenges` は account_id NOT NULL＋payload列無しで決定A に流用不可。stateless 署名トークンは SEC C（試行ロック/単回）にサーバー状態が要り弱いため不採用。
- **SEC-I'＝確定後は自動ログインしない**＝未認証EPからのセッション発行を避け固定化リスク最小化。ログイン画面へプリフィル誘導。
- **SEC-MVP＝外部依存は follow-up**＝CAPTCHA・漏洩PW拒否HIBP・使い捨てメール判定は外部サービス依存のため後続（設計には残置）。

## 7. 次にやること（優先順・ファイル/関数レベル）
1. **【完了 2026-10-07】FR-48② SEC強化4点**＝CAPTCHA〔Turnstile・`core/captcha.py`〕／漏洩PW〔HIBP・`core/pwned.py`〕／使い捨てメール〔`core/disposable_email.py`＋`disposable_domains.txt`〕／管理者通知ダイジェスト〔`signup_registered`・verify post-commit〕。すべて env-gated（`b3930606`・設計 `doc/設計ドラフト/FR-48_セルフサインアップSEC強化.md`）。**本番で要作業＝CAPTCHA の Cloudflare アカウント＋Site/Secret key を env に設定、`HIBP_ENABLED=true`・`SIGNUP_ADMIN_NOTIFY_ENABLED=true` を本番で ON**。他は不要。
2. **公開デプロイ既定会社コードの供給検証**＝env `IQ_DEFAULT_COMPANY_CODE=DEMO` を公開デプロイで設定した際に SC-00 の会社コード欄が隠れ「アカウント作成」導線が出ることを実機確認（dev 共有スタックには設定しない＝ACME ログインUXを壊すため）。
3. **アイデアコンテストの他 未実装**＝`doc/設計ドラフト/アイデアコンテスト機能_設計.md` の正式反映残／Phase2（妥当性解析 §6.4 等）。着手前にコードで現況裏取り（memory「未実装記述は done が多い」）。
4. **SC-01 設計書 §3〜9 を5ゾーンに整合**（持ち越し・`doc/画面設計/screens/SC-01_ダッシュボード.md` 本文は再設計前のまま）。
5. **お知らせ follow-up ③ 本文画像の再ホスト**（持ち越し・共有 `RichTextEditor` 画像対応＋backend お知らせ画像アップEP）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`http://localhost:8000`・frontend=`http://localhost:3000`・openapi=`http://localhost:8000/openapi.json`・MailHog=`http://localhost:8025`。workers＝`docker compose --profile workers up -d worker mail-worker`。
- 反映（ソースベイク・volumes 無）：`cd impl && docker compose up -d --build backend|frontend`。型再生成＝backend 再ビルド後 `cd impl/frontend && npm run codegen`。
- テスト：
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。未コミット反映は `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin・会社 `OPS`）／MFA `ACME-02`/`mfa@acme2.example`（MFA ON）。**DEMO会社**＝`DEMO`/`admin@demo.example`（company_account_admin・public＋self_signup）＝セルフサインアップのデモ。会社DB＝`ideaquest_company_acme`／`ideaquest_company_demo`。
- 公開モード手動確認：`docker compose exec -T db psql -U ideaquest -d ideaquest_control -c "UPDATE companies SET access_mode='public' WHERE company_code='ACME-01';"` → 確認 → **必ず private へ戻す**。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium・`/login` で `#company_code`/`#login_id`/`#password` fill→「ログイン」→`waitForURL`）。**使い終わったら削除**（本セッションは削除済）。
