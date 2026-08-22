# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-22 JST**
- ブランチ: **main**（作業も main に直接コミット）。**push は都度ユーザー承認制**。
- **未 push の並び（新しい順・7 本＝すべてローカル先行）**。push 済み境界＝`df16fd4`（前回 handoff）:
  1. `14549b3` feat(C/SC-11): クエスト編集導線（論点1）＝GET 詳細＋編集モード＋編集ルート
  2. `9f78b87` feat(C/SC-11): クエスト作成のフロント接続＋入力検証エラー UI §4.7 共通部品
  3. `c171884` feat(design/複製): 実装済み登録系一覧に「複製」標準アクションを追加
  4. `1ff1be0` feat(C/SC-11): 作成/編集/公開・パーティー差分・候補・アイコンの backend（C.2/C.3/C.4）
  5. `888b7e8` docs(design): 用語を「複製」に統一（複写→複製・ユーザー指定）
  6. `6e509af` docs(design/CLAUDE): 複製を DataTable 標準に追加＋CLAUDE.md に設計正本の参照節
  7. `b419f5c` docs(spec-first/C→H): publish 参加通知トリガーを正の md に登録＋SC-11 方針確定
- 再開時は `git status -sb` と `git log --oneline origin/main..HEAD` で確認。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝画面移植完了、**backend 接続を 1画面単位ループ**（フロー規約 §1.1・各画面で受入ゲート）。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)。**フェーズ2「クエスト管理（C ドメイン）」進行中**。
- **CLAUDE.md に「設計の正本」参照節を新設**（`6e509af`）＝デザイン標準/セキュリティ一覧/実装計画/本番デプロイ要件/要件定義README/API設計README を必読タイミング付きでポインタ登録（自動全文ロードはしない）。

## 3. 今回やったこと（変更ファイルと理由）
本セッション＝(A) spec-first の文書整合、(B) 「複製」標準の追加、(C) SC-11（クエスト作成/編集）の backend＋frontend フル接続。

### 3-A. spec-first：publish 参加通知トリガーの登録（`b419f5c`）
- C.2 publish の「参加通知（H）」が H の発火元台帳・`notification_type` enum・`notifications` の ref に**未登録**という文書間不整合を解消（H 実装時の実装漏れ防止）。
- `doc/データモデル.md` §3 に `notification_type` 値 **`quest_party_invited`** 追加／§5.24 に **`ref_quest_id`**（FK→quests）追加＝**spec のみ・DDL 変更なし**（`notifications` テーブルは H フェーズで未作成）。
- `doc/API設計/H_通知.md` H.0 発火元表に **C 行**＋冒頭/H.9 の発火元リストに C を追加。
- `doc/API設計/C_...md` C.7 に SC-11 実装方針（論点1〜4）と TBD を記録。
- `doc/規約/フロントエンド実装フロー規約.md` §7.1 に「実装時に見つけた設計時点の不整合もコード前に正の md を最新化」の一般則を追記。

### 3-B. 「複製」標準アクション（`6e509af`＋`888b7e8`＋`c171884`）
- `doc/画面設計/デザイン標準.md` §4.5 に**複製**を新設＝登録（追加）ダイアログを追加モードで開き選択行値をプリフィル、**一意キー/サーバー採番列は複製しない**（UNIQUE 衝突回避）。用語は「複製」に統一（`style-guide.html` サンプルも）。
- impl 共通＝`impl/frontend/src/lib/forms/duplicate.ts`（`buildDuplicateHref`/`readDuplicatePrefill`＝URL モーダル用 `?dup=<JSON>`）。
- 適用＝**SC-91 会社一覧**（CompanyList・名前/カラー引継、会社コード/DB識別子除外）／**SC-93 アカウント一覧**（AccountSection・表示名/ロール引継、ログインID/メール除外）／**SC-92 会社詳細の QG 作成**（QuestGroupSection・state モーダル・名前引継、コード除外）。各作成フォームが `dup` を読み案内文表示。
- **SC-90 qgadmin（QuestGroupAdminView）は対象外**＝メンバー管理一覧（メンバー追加ピッカー＋破壊的除外のみ）で登録ダイアログを持たない（複製非適用と判断・ユーザー了承）。

### 3-C. SC-11 backend（`1ff1be0`＋`14549b3`）
- `impl/backend/app/tenant/quests/schemas.py`＝作成/編集/公開の request（`QuestCreateRequest`/`QuestUpdateRequest`/`QuestPublishRequest`・`extra=forbid`＝§2.2）＋応答（`QuestDetailDTO`/`QuestMemberDTO`/`QuestCandidateDTO`/`QuestCandidatesResponse`/`QuestIconImageResponse`）＋`PERMISSION_VALUES`。**名前は C 専用の一意名**（衝突回避）。
- `impl/backend/app/tenant/quests/application.py`＝`create_quest`/`update_quest`/`publish_quest`/`get_quest_detail`/`set_quest_icon`/`delete_quest_icon`/`get_group_member_candidates` ＋ドメイン関数 `_validate_publishable`・`_apply_party_diff`（候補制限/owner 付与は作成者のみ/作成者保護/既定権限）・`_normalize_categories`（NFKC＋トリム＋大小無視の重複排除）・`_authorize_edit`・`_build_detail`・`_notify_party_invited`（**H まで no-op フック＋TODO**）。現在 status で検証分岐（draft=緩い/公開中=strict/completed=409）。
- `impl/backend/app/tenant/quests/repository.py`＝候補系を追加（`list_active_group_member_user_ids`/`list_group_member_candidates`〔キーセット display_name,id〕/`get_users_by_ids`）。
- `impl/backend/app/tenant/quests/router.py`（既存 quests ルータに追記）＝`GET /quests/{id}`・`POST /quests`・`PATCH /quests/{id}`・`POST /quests/{id}/publish`・`PUT/DELETE /quests/{id}/icon-image`・`GET /quest-groups/{id}/members`。変更系は `verify_origin`/`verify_csrf`。
- test＝`impl/backend/tests/quests/test_sc11_api.py`（C-TC-110〜129＝20件）。red-green＝候補制限/owner付与/publish状態機械/完了凍結/可視性ガードを一時無効化して該当 TC の red を目視→復元して green。

### 3-D. SC-11 frontend（`9f78b87`＋`14549b3`）＋入力検証 §4.7 共通部品
- **§4.7 の impl 共通部品を初導入**＝`impl/frontend/src/components/ui/FormSummary.tsx`（上部サマリ `.form-summary`・role=alert・**フォーカス移動しない**）／`impl/frontend/src/lib/forms/validation.ts`（ロケール別カタログ `t()`＋problem+json→フィールド別/サマリ写像 `mapServerErrors`・**ja/en**）／`design-system.css` に `.form-summary` 移植（正＝mocks/shared.css）。
- `impl/frontend/src/features/quests/api.ts`＝`getQuest`/`createQuest`/`updateQuest`/`publishQuest`/`setQuestIcon`/`deleteQuestIcon`/`listGroupMemberCandidates`＋型＋`QUESTS_CHANGED_EVENT`。
- `impl/frontend/src/features/quests/components/QuestForm.tsx`＝デモ配列を廃し**作成/編集 両対応**に実接続。グループ（`GET /quest-groups`）・候補（`GET /quest-groups/{id}/members`・自分＋作成者＋追加済みを exclude）フェッチ、権限キー UI⇔API 写像、下書き=POST draft／作成=POST recruiting／編集=PATCH・publish、**アイコンは本体保存後に PUT/DELETE（2段・論点2）**、編集はグループ不変で固定表示、完了は書き込み凍結（無効化）。送信時＋blur 検証・インライン aria-invalid＋上部サマリ。
- `QuestCreateModal`/`QuestCreatePanel`/`QuestEditModal`/`QuestEditPanel`＋ルート＝`/quests/new`（既存）と**新設 `/quests/[questId]/edit`（フルページ＋`@modal/(.)quests/[questId]/edit` intercept・論点1）**。session の `user.user_id`（候補の自己除外）と `locale` を供給。作成/公開/編集成功で `QUESTS_CHANGED_EVENT` 発火→ `QuestListView` が購読して再取得。
- `QuestListView`＝下書き行クリックの遷移先を `/quests/new`→**`/quests/{id}/edit`** に修正（従来は新規作成へ飛ぶバグ・§4.5⑪/C.1）。

## 4. 現在の状態（動く / 壊れている / テスト）
### 4-1. backend
- 登録ルータ＝auth / admin / me / **quests**。quests EP＝`GET /quests`・`GET /quests/{id}`・`POST /quests`・`PATCH /quests/{id}`・`POST /quests/{id}/publish`・`PUT/DELETE /quests/{id}/icon-image`・`GET /quest-groups`・`GET /quest-groups/{id}/members`。
- **company migration head＝`0009_company_quests`（今回変更なし）**。GET 詳細/編集/通知トリガーは DDL 不要（`notifications.ref_quest_id` は spec のみ）。
- **未実装ドメイン**＝C の状態遷移 `POST /quests/{id}/transition`（C.5）・パーティー粒度 EP（C.3 `PUT /party`・増分）・`DELETE /quests/{id}`／D アイデア／E チャット／F 評価／G/H/I/J/L。API 設計は全ドメイン確定（`doc/API設計/{A..L}_*.md`）。
- **pytest＝256 passed**（前回 236＋SC-11 api 20）。既知フレーク＝`test_a_tc_040` が pytest-randomly 順で稀に IndexError（単独/別シードで green・既存）。

### 4-2. frontend
- backend 接続済み＝認証 SC-00／プロフィール SC-03/K／管理 SC-90/91/92/93／**SC-10 クエスト一覧**／**SC-11 クエスト作成・編集（新）**。
- **SC-11＝code-complete。受入ゲートは §7 参照（作成/編集ともユーザー動作確認待ち）**。疎通は curl/backend で確認済（作成→一覧反映、GET 詳細→PATCH→publish）。
- 入力検証 §4.7＝**標準確定・impl 共通部品を SC-11 で初適用**。既存フォーム（CompanyCreateForm 等の `.form-error` 旧式）への横展開は随時（§7）。
- 「複製」＝SC-91/93/92(QG) に反映済（再ビルド済）。
- デモ fixtures（未接続）＝SC-01 各パネル/SC-02/12/21/22/24/25/30/31/32/40/41。

### 4-3. テスト
- **frontend tsc（`npx tsc --noEmit`）＝既知2件のみ**＝`Snackbar.tsx:57`・`ShopView.tsx:98`（今回変更と無関係のデモ画面）。SC-11・複製・§4.7 の全変更はクリーン。
- **未実施＝SC-11 の e2e**（`sc-11-quest-create.spec.ts` を実接続に更新＋編集シナリオ）と、複製の e2e。手動受入ゲートを優先。
- OpenAPI 型再生成後の**スキーマ名衝突なし**を確認済（`Body_put_quest_icon...` は multipart 自動生成で正常）。

### 4-4. 稼働状態
- **本セッションで backend/frontend を再ビルド済み・全サービス起動中**（`--profile workers`）。ホスト/Docker 再起動で全 exit したら §8 で再起動。
- **dev seed を追加済み（検証用・削除可）**＝ACME-01 会社DB に **クエストグループ「デモグループ」(code `DEMO`)** を作成し、一般ユーザー `user@acme.example`（表示名「テスト 太郎」）を所属させた。疎通で作成したクエスト1件が存在（現在「編集後タイトル」・recruiting）。**これが無いと一般ユーザーはグループ未所属で SC-11 作成不可**だったため用意（handoff 前は 0 グループ）。

## 5. 詰まっている点（試して失敗した / 注意）
- **frontend/backend はソース焼き込み（ボリューム未マウント）**＝`up -d --build frontend`（frontend）／`up -d --build backend worker mail-worker`（backend）で再ビルドしないとホスト編集が稼働コンテナに反映されない。
- **backend テストの cwd 罠**＝`docker compose run --rm -T -v "$PWD/backend:/app" backend pytest ...` は **cwd=`impl` が前提**。別コマンドで `cd .../quests` 等に移ると `$PWD/backend` が消えて bootstrap が `No module named 'scripts'` で落ちる。**テスト実行前に必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`**。`docker compose cp` の cp 先も cwd=impl だと `impl/impl/...` になるので**絶対パス**で。
- **red-green の運用**＝コードが先に出来ている時は対象ガードを一時無効化して red を目視→復元して green。無効化前に `cp application.py /tmp/xxx.bak` してから編集し、`cp /tmp/xxx.bak application.py` で確実に復元（`RED-DEMO` マーカを grep して残存 0 を確認）。
- **テナント検証の前提**＝一般ユーザーはクエストグループ所属が無いとクエスト作成不可＆一覧が空。会社が `suspended` だとテナント API は 503（§1.5）。ACME-01 は active（確認済）。会社の active 化手順（`companies.status` 更新方法）は**未確認**。
- **OpenAPI schema 名の衝突**＝同名 Pydantic クラスが2ドメインにあると openapi-typescript が完全修飾名にリネームし既存型を壊す。**新規 schema は既存と名前衝突しないか確認**（C は `Quest*` で一意化済）。codegen 後は必ず frontend tsc で検知。
- **e2e の OPS ログイン レート制限フレーク**＝複数 spec 連続で fail。**1ファイルずつ＋各前に `redis-cli FLUSHALL`**。frontend 再ビルドで Playwright chromium/依存が消える（毎回 `install-deps chromium`＋`install chromium`）。
- **MinIO 署名URL**＝backend は内部 `minio:9000`、ブラウザは公開 `localhost:9000`。e2e（コンテナ内ブラウザ）では実ロード不可＝`src` 属性検証のみ。`storage.py` は2クライアント分離・両方に `region=` 明示。
- **Alembic revision id は 32字以内**（`alembic_version` varchar(32)）。会社DB head＝`0009_company_quests`。管理DB head は要確認（前回 `0010_accounts_pending_email`）。
- **DataTable URL 同期のループ回避**＝書き戻し effect の依存に `searchParams` を入れない（基点は `window.location.search`）。`.btn-outline`/usermenu の CSS 二重定義あり（import 順で後勝ち）。

## 6. 決定事項と根拠
- **SC-11 実装方針（論点1〜4・確定 2026-08-22・ユーザー承認）**＝(1) 編集ルート `/quests/{id}/edit`＋intercept を追加／(2) アイコンは専用 multipart EP＋2段（K.4 流儀）／(3) publish 参加通知は **H まで no-op フック**（`quest_party_invited` を enum/§5.24/H.0 に**登録済み**＝実装漏れ防止）／(4) 下書きの members 空は許容（公開時 strict で担保）。
- **「複製」標準（デザイン標準 §4.5・確定 2026-08-22）**＝登録ダイアログを追加モードで開き行値プリフィル・**一意キーは複製しない**。登録系一覧のみ（メンバーピッカー/破壊的専用の一覧は非適用＝SC-90）。
- **カテゴリ `is_custom`**＝事前定義カテゴリの正本（会社内マスタ）未整備（C.7 TBD）のため現状は**全ラベル is_custom=True**（`_PRESET_CATEGORIES` 空・機能上の消費者は未実装）。**色**はプリセット10色の hex 正本が未確定のため**形式検証（#RRGGBB）のみ**。
- **入力検証 §4.7**＝インライン（枠赤 aria-invalid＋`.field__error`）＋上部サマリ（`.form-summary`）併用／送信時＋blur／**フォーカス自動移動しない**／i18n（ja/en）。impl 共通部品＝`FormSummary`＋`lib/forms/validation`。
- **可視性（GET 詳細）**＝下書きは本人のみ／公開系は owner か有効パーティー員のみ（範囲外 404 存在秘匿）。**候補の自己除外**は `SessionUser.user_id`（tenant user_id）を frontend に渡して実現。
- **実装順**＝アカウント→クエスト→アイデア→評価→その他（`doc/実装計画.md`）。C が D/E/F/フィードの門番。

## 7. 次にやること（優先順・具体的に）
1. **SC-11 の受入ゲート（ユーザー動作確認）**＝(a) SC-10 一覧に下書き/クエストがカード表示、(b) 「＋クエストを作成」→作成モーダルでグループ「デモグループ」表示・必須未入力で §4.7 のインライン＋サマリ・下書き保存/作成で一覧反映・アイコン2段、(c) 下書きカードクリック→**編集モーダル**がプリフィルで開く・下書き保存/公開、(d) `/quests/{id}/edit` 直アクセスでフルページ。合意で完了確定。
2. **SC-11 の e2e**＝`impl/frontend/e2e/sc-11-quest-create.spec.ts` を実接続へ更新（作成→一覧反映・§4.7 エラー表示・編集プリフィル→保存）。複製の e2e（作成ダイアログがプリフィルで開く）も検討。**1ファイルずつ＋FLUSHALL**。
3. **SC-12 クエスト詳細**（C.1 詳細は `GET /quests/{id}` 実装済＝流用）＝パーティータブ（C.3 粒度 EP `PUT /party`・`POST/DELETE /members`・`PUT .../permissions`）／状態遷移（C.5 `POST /quests/{id}/transition`）／`DELETE /quests/{id}`。時系列フィード（SC-12→SC-01）は C 周回で。
4. **（折衷・随時）既存フォームを §4.7 標準へ順次是正**（`.form-error` 旧式・先頭1件のみ表示のもの）＝`FormSummary`＋`lib/forms/validation` に載せ替え。
5. **その後 D ドメイン（アイデア）へ**（実装計画）。
6. **（保留）会社の active 化手順の確認**（`companies.status` 更新方法＝suspended だとテナント API 503）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／minio :9000/:9001／mailhog UI :8025。**e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend コード反映**＝`up -d --build frontend`。
- **backend テスト**（cwd=`impl`）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`（`--no-deps` は付けない＝redis 前提／db 起動直後は `pg_isready` 待ち）。範囲指定＝`pytest tests/quests -q`。
- **openapi 型再生成**（backend 再ビルド後）＝`docker compose -f impl/compose.yaml exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose -f impl/compose.yaml cp frontend:/app/src/lib/api/schema.d.ts /home/t-umekawa/sc-ideaquest-G2/impl/frontend/src/lib/api/schema.d.ts`（cp 先は絶対パス）。
- **frontend 型チェック**＝`docker compose -f impl/compose.yaml exec -T frontend npx tsc --noEmit`（既知2件は §4-3）。
- **frontend e2e**（Docker）＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium` (3)`exec -T redis redis-cli FLUSHALL`（各 spec 前）(4)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ**。
- **dev ログイン（PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF・表示名「テスト 太郎」・**デモグループ所属済**)・`ACME-02`/`mfa@acme2.example`(MFA ON)。MailHog＝`http://localhost:8025`。
- **MinIO env（dev）**＝`MINIO_ACCESS_KEY=ideaquest`/`MINIO_SECRET_KEY=ideaquest-secret`/`MINIO_BUCKET=ideaquest`。クエストアイコンの prefix＝`quest-icons/`。
- 規約＝`CLAUDE.md`（「各種規約」＋新設「設計の正本」節）から辿る。実装順の正＝`doc/実装計画.md`。デザインの正＝`doc/画面設計/mocks/*.html`（`style-guide.html` §4b 入力検証・§9 複製）＋`screens/*.md`＋`デザイン標準.md`（§4.5 DataTable/複製・§4.7 入力検証）。API 設計＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`（クエスト §5.6〜§5.9・通知 §5.24・enum §3）。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に削除。
