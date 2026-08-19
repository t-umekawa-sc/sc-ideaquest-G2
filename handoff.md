# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-19 JST**
- ブランチ: **main**（作業も main に直接コミットしている）。**origin/main と同期・作業ツリー clean**。
- 直近コミット群（新しい順）＝`2b768df` docs(design) アクティビティフィード設計追記 ／ `aa4aca9` fix(style-guide) 進捗デモ復元 ／ `9d7ad89` feat(SC-03) プロフィール レイアウト刷新 ／ `f1fa476` feat(SC-03) 獲得履歴接続 ／ `49e4e11` feat(G) GET /me/activities ／ `4f10772` docs(handoff)。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝**画面移植は完了**。今は **backend 接続フェーズ**を **1画面単位ループ**（フロー規約 §1.1）で回している。

## 3. 今回やったこと（変更ファイルと理由）
本セッション＝G 台帳の読取（履歴）接続＋プロフィール UI 刷新＋既存バグ修正＋新要件の設計追記。

### 3-1. GET /me/activities（活動履歴・G.6・`49e4e11`）
- 残高の元帳 `activities` を新しい順で返す**読取 EP（自分専用）**。`me` ルータ配下（`/api/v1/me/activities`）。
- 実装＝`me/router`（`kind?`/`period?` Literal 検証・`limit`1..100・`cursor`）／`me/schemas`（`MeActivityDTO`/`CursorPageInfo`/`MeActivitiesResponse`）／`me/application.get_my_activities`（会社DB activities 取得・`period_bounds_utc`・**キーセットカーソル**〔`(created_at,id)` の base64 不透明値〕・不正カーソル 422）／`tenant/gamification/repository.list_activities`（`tuple_` 行値キーセット・limit+1 で has_next）／`tenant/gamification/daily.period_bounds_utc`（this_week/last_week/this_month/all・JST 週起点月曜・**ランキング G.5 とも共用予定**）。
- red-green（§5.1）＝router 退避でルート未登録→API テスト 5 failed(404)→復元で green。

### 3-2. SC-03 獲得履歴 接続（`f1fa476`）＋プロフィール レイアウト刷新（`9d7ad89`）
- **接続**＝`lib/me.getServerActivities`（初回ページをサーバ取得）＋`features/profile/ActivityHistory`（client・「もっと見る」でカーソル追加読込・**next rewrite 経由**で `/api/v1/*`→backend）。reason 日本語ラベル化・獲得=金/消費=赤・相対時刻。e2e `sc-03-activities`。
- **レイアウト刷新**＝最上部に**ゲーム風パネル(`pixel-panel`)**を新設し 3Dアバター表示グループ＋獲得履歴を1枚に。3Dアバター群を `ProfileForm` から presentational `ProfileHero` に分離（サーバ /me 由来・編集後 `router.refresh()` で追従）。「ユーザ情報」見出し追加＋カード先頭の無意味な罫線（`.kv` border-top）削除。**XPバーのホバーツールチップ**（獲得XP {レベル内}/{必要量}（累計）) を SC-01 と同一化＝様式を `design-system.css` の `.xp-bar-wrap` に**共通化**（dashboard.css は幅指定のみに縮小）。

### 3-3. 前セッションの UI 3点（`89e2ec6`＋`e19ed2c`・前 handoff 以降に push 済み）
- SC-01 ヒーロー XP バーのホバーツールチップ／共通ヘッダーのアクションメニュー（グループ罫線＋非表示項目の空き帯解消）。

### 3-4. style-guide.html「進捗デモを再生」修正（`aa4aca9`）
- 原因＝進捗バー(13.2) `#sgProgRun` の click ハンドラが shared 昇格リファクタ（`663eca6`・**本セッション前の既存リグレッション**）で誤削除→無反応。ハンドラを復元（fill 0→100%・完了で `.is-complete`＋`window.iqSnack`）。`file://` で再生→完了・pageerror 0 を確認。

### 3-5. 時系列アクティビティフィードを設計に追記（`2b768df`・新要件）
- **要件**＝自分／クエスト参加メンバー／参加クエスト横断のアクティビティを時系列表示（要件定義 FR-36）。**`activities` の絞り込み表示で実現＝新テーブル不要**（データモデル §8-㉑）。
- **API設計 G.5.1 新設**＝`GET /me/activities`(SC-03・実装済)／`GET /quests/{id}/activities`(SC-12)／`GET /me/feed`(SC-01)。
- **プライバシー（初期値）**＝他者フィードは成果系のみ（`idea_post`/`selection`/`achievement_reward`/`levelup_sp`）。私的行動（購入/魔法解放/ログイン）・匿名性関連（投票/評価）は非表示。自分の履歴（SC-03）は全種別。
- **依存**＝SC-12/SC-01 は C（パーティー所属＝門番／参加クエスト集合）、リンク付き表示は D/E（ref 解決）。画面 SC-01 §4.8b・SC-12 §4.1c・SC-03 §4.1b にも反映。

## 4. 現在の状態（動く/壊れている/テスト）
### 4-1. フロント
- 画面移植は全完了。`features/` は 17 ディレクトリ。
- **backend 接続済み**＝認証 SC-00・プロフィール SC-03/K（**残高＋獲得履歴**）・管理 SC-90/91/92/93・SC-01 ヒーロー残高＋共通ヘッダー通貨。
- **残高が実データで動く**＝ログイン XP（G.6 login）で XP/レベル/進捗、獲得履歴に記録。コイン/SP は購入・解放・実績など後続で動く。
- **デモ fixtures（未接続）**＝SC-02/10/11/12/21/22/24/25/30/31/32/40/41、SC-01 の週間ランキング/下書き/未投票/参加中クエスト/フォロー中/**チームアクティビティ(§4.8b・C 依存)**。

### 4-2. backend
- 登録ルータは **auth/admin/me の3つ**。`me` に **`GET /me/activities`** を追加（応答形 MeActivitiesResponse・OpenAPI 反映済み）。
- 実装済み＝`control_plane/{auth,admin,me,account_sync,audit,mail_outbox}`・`tenant/{profile,quest_group,gamification}`。**`tenant/gamification`** ＝ level(純関数)/daily(JST日境界・期間境界)/orm(Activity)/repository(存在チェック・キーセット一覧)/ledger(grant・grant_daily_login)。
- **未実装ドメイン**＝G の残り（ショップ/装備/魔法/実績/ランキング各EP・spend 系・フィード集約 `quests/{id}/activities`・`me/feed`）／H 通知／C パーティー・D アイデア・E チャット・F 評価・I ダッシュボード集約・L WS。API 設計は全ドメイン確定（`doc/API設計/{A..L}_*.md`）。

### 4-3. テスト
- **backend pytest＝211 passed**（前 203＋period 3＋me_activities 5）。マウント（`-v "$PWD/backend:/app"`）で即反映＝entrypoint bootstrap が migration 0007（activities）も自動適用。
- **frontend e2e**＝回帰確認済み `sc-01-dashboard`／`sc-03-activities`／`k-profile`（直列 green）。フルは並列ログインのレート制限フレーク（直列＋FLUSHALL で切り分け）。
- **既知の壊れ（本変更と無関係の既存）**＝(1) `sc-92c B-TC-116`（RowMenu position:fixed の viewport 脆弱性・旧レイアウトでも再現）。(2) backend `test_a_tc_040`（メール）が pytest-randomly のランダム順で稀に IndexError（単独/別シードで green）。

## 5. 詰まっている点（試して失敗した/注意）
- **backend/frontend はソース焼き込み（bind mount 無し）**＝稼働反映は再ビルド。backend＝`up -d --build backend worker mail-worker`／frontend＝`build frontend`→`up -d frontend`。**openapi 変更時は** frontend `schema.d.ts` を codegen 再生成（§8）。
- **frontend 再ビルドで Playwright chromium/依存が消える**＝毎回 `install-deps chromium`(root)＋`install chromium`。**`docker compose cp` で入れた使い捨て spec/png も再ビルドで消える**＝rebuild 後に再 cp（今回頻発）。
- **CSS の落とし穴**＝(1) `overflow:hidden` の要素に `::after` ツールチップは切れる→ラッパー(`.xp-bar-wrap`)に出す。(2) `.usermenu__list li > *` の `background:none`/padding が `.usermenu__sep` を上書き＝区切り線が透明/膨張→高特異度(0,2,1)で打ち消す。**layout.css と design-system.css が usermenu を二重定義**（layout.css が後 import で勝つ）。
- **カーソルページング**＝キーセットは `(created_at, id)` の行値比較（`sqlalchemy.tuple_`）。同一Tx で複数付与すると `created_at`（=Tx開始時刻）が同値＝id で決定化。カーソルは base64 の `created_at.isoformat()|id`・不正は 422。
- **テナントセッションは commit しない**（`get_tenant_session`）＝書込み時は明示 commit。会社DB user は `users.account_id==account_id` で引く（`accounts.id≠users.id`）。
- **red-green**＝新規挙動は「配線/実装前に走らせて behavior-red（404/値不一致）を撮る」。実装済み変更は `git stash push -- <repoルート基準パス>`。
- **フル e2e フレーク**＝`--workers=1`＋`redis-cli FLUSHALL` で切り分け。**background の Bash は cwd 非継承**＝compose は絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml`。

## 6. 決定事項と根拠
- **backend 接続は1画面単位ループ＋受入ゲート**（§1.1）。**各画面の実装後は必ず止めてユーザー動作確認**（運用メモリにも保存）。
- **G 台帳 canonical＝`activities` が真実・`users` 残高はキャッシュ・同一 UoW**。レベル/進捗は §7 純粋関数で xp から算出。ログイン XP フック点＝ログイン成功時のみ（最小）。
- **時系列フィード＝`activities` の絞り込み表示で実現（新テーブル不要）**（データモデル §8-㉑・API設計 G.5.1）。他者フィードは成果系のみ公開（プライバシー）。SC-12/SC-01 は C 依存。
- UI＝アクションメニューはグループ罫線で区切り非表示項目は高さ0／XPバーはホバーで獲得XPをツールチップ（SC-01/SC-03 共通様式・`design-system.css .xp-bar-wrap`）／プロフィール上部はゲーム風パネル（アバター群＋履歴）。

## 7. 次にやること（優先順・具体的に）
1. **G を続けて §1.1 を回す**（依存の少ない順）。有力＝
   - **ショップ SC-30（`GET /items`＋`POST /items/{id}/purchase`）**＝spend 系の初回。`ledger.grant(COIN_SPEND, reason=shop_purchase)` を UoW で使い、残高検証（不足→409 `insufficient_balance`）・`Idempotency-Key`（§1.9）・`user_items` 作成。**残高がコインでも動き出す**・**購入が獲得履歴(SC-03)に出る**。**推奨**。
   - または **H 通知（SC-02）**＝一覧/既読 API（ref 解決は ideas/achievements 未実装で seed body 部分実装）。
   - 着手前に必ず対象ドメインの `doc/API設計/*` と既存4層テンプレ（`control_plane/me`・`tenant/gamification`）を読む。
2. **時系列フィード（SC-12→SC-01）**＝**C（パーティー・所属）を実装する周回**で `GET /quests/{id}/activities`→`GET /me/feed` を接続（G.5.1・門番は C.0）。リンク付き表示は D/E 後。
3. **既存脆弱性 `sc-92c B-TC-116` の修整**（別件・RowMenu の viewport 収まり手当）。
4. SC-01 の残り（週間ランキング/下書き/未投票/参加中クエスト/フォロー中）＝I 集約 or 各ドメイン（G/C/D）接続時に demo→API 差替。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**（特に background）。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／mailhog UI :8025。**e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend コード反映**＝`build frontend`→`up -d frontend`。
- **openapi 型再生成**＝backend 再ビルド後、`docker compose exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose cp frontend:/app/src/lib/api/schema.d.ts <host>`。
- **backend テスト**（cwd=`impl`）＝先に `docker compose stop worker mail-worker`→ `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（マウント即反映・migration も適用）。e2e に戻すとき `--profile workers up -d worker mail-worker`。
- **frontend e2e**（Docker）: (1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium` (3)`exec -T redis redis-cli FLUSHALL` (4)`exec -T frontend npx playwright test e2e/<spec> --reporter=line`（疑わしい失敗は `--workers=1`）。spec 差替＝`cp impl/frontend/e2e/x.spec.ts frontend:/app/e2e/x.spec.ts`（再ビルドで消える＝再 cp）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。※**ログインで +10 XP/JST日**。※検証用に **ACME-01 の dev DB に獲得履歴デモを十数件シード済み**（`ledger.grant` 手動投入・不要なら削除可）。MailHog＝`http://localhost:8025`。
- 規約＝`CLAUDE.md` から辿る。デザインの正＝`doc/画面設計/mocks/*.html`＋`screens/*.md`＋`デザイン標準.md`。API 設計の正＝`doc/API設計/{A..L}_*.md`。データモデル＝`doc/データモデル.md`（残高/台帳＝§5.27・§7、フィード決定＝§8-㉑）。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に必ず削除。
