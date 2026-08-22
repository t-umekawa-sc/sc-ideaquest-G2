# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-22 JST**
- ブランチ: **main**（作業も main に直接コミット）。**push は都度ユーザー承認制**。
- **全コミット push 済み（未 push＝0・`main...origin/main` 同期）**。最新＝`ddf332a`。
- 直近コミット（新しい順）:
  - `ddf332a` feat(C/SC-12): クエスト詳細のフロント接続（ヘッダー/概要/パーティー＋状態遷移＋削除）
  - `afde1e7` fix(SC-92/93): 所属グループの役割選択をモック準拠のセグメント切替に（native select→.seg）
  - `f66e3d6` feat(C/SC-12): パーティー粒度EP＋状態遷移＋クエスト削除の backend（C.3/C.5/C.2）
  - `9430acd` feat(design §4.8): 編集不可フィールドの表示標準（readonly/disabled）
  - `b9db16d` feat(SC-92/QG): クエストグループの「リネーム」を「編集」ダイアログ化
  - （その前＝`ae0aa38` 前回 handoff／`14549b3` SC-11 編集導線／`9f78b87` SC-11 作成接続＋§4.7 ほか）
- 再開時は `git status -sb` と `git log --oneline -15` で確認。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝画面移植完了、**backend 接続を 1画面単位ループ**（フロー規約 §1.1・各画面で受入ゲート）。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)。**フェーズ2「クエスト管理（C ドメイン）」がほぼ完了**（残りは D/E/F/G/J 依存部分）。
- **CLAUDE.md に「設計の正本」参照節あり**＝デザイン標準/セキュリティ一覧/実装計画/本番デプロイ要件/要件定義README/API設計README を必読タイミング付きでポインタ登録（自動全文ロードはしない）。

## 3. C ドメイン（クエスト）の到達点と今回の作業
**C ドメインは SC-10/SC-11/SC-12 を backend＋frontend で接続完了**（D/E/F/G/J 依存部分を除く）。今回セッション（`b9db16d`〜`ddf332a`）＝SC-12 実装＋横断UI是正。

### 3-A. SC-12 クエスト詳細（`f66e3d6` backend／`ddf332a` frontend）
- backend（`impl/backend/app/tenant/quests/`）に **C.3 パーティー粒度／C.5 状態遷移／C.2 削除** を追加:
  - `application.py`＝`list_party_members`/`set_party`/`add_party_member`/`remove_party_member`/`set_member_permissions`/`transition_quest`/`delete_quest`＋`_guard_not_completed`（完了凍結 409）＋`_finalize_completion`（**F.4 コイン確定は F 実装まで no-op フック＋TODO**）。`_build_detail` を `_members_payload`/`_member_dto` に共通化。
  - `router.py`＝`GET /quests/{id}/members`・`PUT /quests/{id}/party`・`POST /quests/{id}/members`・`DELETE /quests/{id}/members/{user_id}`・`PUT /quests/{id}/members/{user_id}/permissions`・`POST /quests/{id}/transition`・`DELETE /quests/{id}`（変更系は Origin/CSRF）。
  - `schemas.py`＝`QuestMembersResponse`/`QuestPartyUpdateRequest`/`QuestMemberAddRequest`/`QuestMemberPermissionsRequest`/`QuestPermissionsResponse`/`QuestTransitionRequest`（一意名）。
  - 遷移＝前進のみ（現在の次のみ許可・逆行/飛び越えは 409）。`draft→recruiting` は publish 相当で strict 検証。作成者保護（除外/owner 剥奪不可）。
- frontend（`impl/frontend/src/features/quests/components/QuestDetailView.tsx`）＝デモから実接続:
  - `GET /quests/{id}` でヘッダー/概要タブ/パーティータブ（実メンバー＋権限バッジ）を描画。ローディング/404/401 表示。
  - 状態遷移（owner/quest_admin＝⋯「ステータスを進める→次」・`useConfirm`/`useSnackbar`）＝`POST transition`。削除（⋯「クエストを削除」・danger 確認）＝`DELETE`→一覧へ。`QUESTS_CHANGED_EVENT` 発火。
  - 「クエスト編集」「パーティー・権限を編集」→ `/quests/{id}/edit`（**従来 `/quests/new` に飛ぶバグを修正**）。
  - **アイデア一覧＝D／全文検索＝J／週間ランキング＝G は未実装ドメイン依存＝デモ維持**（各所に「※デモ」注記）。
  - `api.ts` に `transitionQuest`/`deleteQuest` 追加。

### 3-B. 横断UI 是正（`b9db16d`・`9430acd`・`afde1e7`）
- **SC-92 クエストグループ「リネーム」→「編集」ダイアログ化**（`QuestGroupSection.tsx`）＝`window.prompt` 廃止・共通 Modal で**グループ名のみ編集**（コードは readonly）。RowMenu と行クリック主アクションも「編集」に。
- **デザイン標準 §4.8 新設＝編集不可フィールドの表示**＝`.input/.textarea/.select` の `:disabled`/`[readonly]` に muted 塗り＋文字色＋弱いボーダー（`design-system.css`＋`mocks/shared.css`）。`readonly`=値を見せるが変更不可（cursor default）／`disabled`=操作不可（not-allowed）。不変理由は `hint` で明示。`style-guide.html`「4c.」。ユーザー指摘（readonly が編集可能に見える）由来。
- **MembershipsEditor をセグメント切替（`.seg`/`.seg__btn`）に**＝アカウント発行/編集の所属グループ役割（メンバー/管理者）が native select だったのをモック SC-92 の `.seg` に一致（`afde1e7`）。

### 3-C. （前セッション・push 済み）C の土台と SC-10/SC-11
- SC-10 一覧（`GET /quests`）・SC-11 作成/編集（`POST/PATCH/publish`・アイコン2段・編集ルート `/quests/[id]/edit`＋intercept）は接続済。**§4.7 入力検証の impl 共通部品**＝`components/ui/FormSummary`＋`lib/forms/validation`（i18n カタログ＋problem+json 写像）＋`.form-summary`。**「複製」標準**＝`lib/forms/duplicate.ts`＋SC-91/SC-93/SC-92(QG) に適用。詳細は git 履歴参照。

## 4. 現在の状態（動く / 壊れている / テスト）
### 4-1. backend
- 登録ルータ＝auth / admin / me / **quests**。quests EP は C.1〜C.5 のうち**作成/編集/公開/削除/遷移/パーティー粒度/候補/詳細/一覧**を実装（下記の未実装以外は網羅）。変更系は Origin/CSRF＋認可（owner/quest_admin、owner 付与は作成者のみ）。
- **company migration head＝`0009_company_quests`（今回変更なし）**。SC-12 は DDL 不要。
- **未実装（他ドメイン依存）**＝アイデア一覧/投稿=D／チャット=E／評価=F／週間ランキング・時系列フィード・XP/コイン確定（F.4 フック）=G／全文検索=J／通知（`quest_party_invited` は spec 登録済み・C 側は no-op フック）=H／WS=L。API 設計は全ドメイン確定。
- **pytest＝269 passed**（quests 48件＝repository 10＋SC-10 api 5＋SC-11/12 api 33）。既知フレーク＝`test_a_tc_040`（pytest-randomly 順で稀に IndexError・単独/別シードで green）。

### 4-2. frontend
- backend 接続済み＝SC-00 認証／SC-03/K プロフィール／SC-10 クエスト一覧／**SC-11 作成・編集**／**SC-12 詳細（ヘッダー/概要/パーティー＋遷移＋削除）**／SC-90/91/92/93 管理。「複製」＝SC-91/93/92(QG)。
- **受入ゲート未確定**＝SC-11（作成/編集）・SC-12（詳細/遷移/削除）はユーザー動作確認待ち（疎通は curl で確認済）。
- **未接続（デモ fixtures）**＝SC-01 各パネル/SC-02/SC-12 のアイデア・検索・ランキングタブ/SC-21/22/24/25/30/31/32/40/41。
- **frontend tsc（`npx tsc --noEmit`）＝既知2件のみ**＝`Snackbar.tsx:57`・`ShopView.tsx:98`（今回変更と無関係のデモ画面）。C 実装・横断UI 是正はクリーン。

### 4-3. テスト
- **未実施＝SC-11/SC-12 の e2e**（実接続版への更新）と複製の e2e。手動受入ゲートを優先。
- OpenAPI 型再生成後の**スキーマ名衝突なし**を確認済（C は `Quest*` で一意化・`Body_put_quest_icon...` は multipart 自動生成で正常）。

### 4-4. 稼働状態
- **本セッションで backend/frontend を再ビルド済み・全サービス起動中**（`--profile workers`）。ホスト/Docker 再起動で全 exit したら §8 で再起動。
- **dev seed（検証用・削除可）**＝ACME-01 会社DB に **クエストグループ「デモグループ」(code `DEMO`)** ＋一般ユーザー `user@acme.example`（表示名「テスト 太郎」）を所属。**クエスト1件**が存在（疎通テストで作成→編集→遷移した結果、現在 **`in_progress`**・title「編集後タイトル」）。これが無いと一般ユーザーはグループ未所属で SC-11/12 を実データ検証できない。

## 5. 詰まっている点（試して失敗した / 注意）
- **frontend/backend はソース焼き込み（ボリューム未マウント）**＝`up -d --build frontend`／`up -d --build backend worker mail-worker` で再ビルドしないとホスト編集が反映されない。
- **backend テストの cwd 罠**＝`run --rm -T -v "$PWD/backend:/app" backend pytest ...` は **cwd=`impl` 前提**。`cd .../quests` 等に移ると `$PWD/backend` が消えて bootstrap が `No module named 'scripts'` で落ちる。**テスト/red-green の前に必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`**。`docker compose cp` 先も cwd=impl だと `impl/impl/...` になるので絶対パス。
- **red-green の運用**＝コードが先に出来ている時は対象ガードを一時無効化して red を目視→復元して green。無効化前に `cp application.py /tmp/xxx.bak`→編集→`cp /tmp/xxx.bak application.py` で復元し `grep -c RED-DEMO`＝0 を確認。
- **テナント検証の前提**＝一般ユーザーはクエストグループ所属が無いと作成不可＆一覧空。会社が suspended だとテナント API 503（§1.5）。ACME-01 は active（確認済）。会社の active 化手順（`companies.status` 更新方法）は**未確認**。
- **OpenAPI schema 名の衝突**＝同名 Pydantic クラスが2ドメインにあると openapi-typescript が完全修飾名にリネームし既存型を壊す。**新規 schema は名前衝突しないか確認**（C は `Quest*` で一意化）。codegen 後は必ず frontend tsc で検知。
- **impl の共通部品の型に注意**＝`useConfirm` の `ConfirmOptions` は本文が **`msg`**（`message` ではない）。`QuestIcon` の props は `name/color/imageUrl/size` のみ（`ownerName` 無し）。`.seg` は `.seg__btn`＋`aria-pressed`。
- **e2e の OPS ログイン レート制限フレーク**＝**1ファイルずつ＋各前に `redis-cli FLUSHALL`**。frontend 再ビルドで Playwright chromium/依存が消える（毎回 `install-deps chromium`＋`install chromium`）。
- **MinIO 署名URL**＝backend は内部 `minio:9000`、ブラウザは公開 `localhost:9000`。e2e（コンテナ内ブラウザ）では実ロード不可＝`src` 属性検証のみ。クエストアイコン prefix＝`quest-icons/`。
- **Alembic revision id は 32字以内**。会社DB head＝`0009_company_quests`。管理DB head は要確認（前回 `0010_accounts_pending_email`）。

## 6. 決定事項と根拠
- **SC-11/SC-12 実装方針（論点1〜4・確定 2026-08-22）**＝編集ルート追加／アイコン専用EP+2段／publish 参加通知は H まで no-op（`quest_party_invited` を enum/§5.24/H.0 に登録済み＝漏れ防止）／下書き members 空は許容（公開時 strict）。
- **状態遷移（C.5）**＝前進のみ・現在の次のみ許可（逆行/飛び越え 409）。`draft→recruiting` は publish 相当で strict。`evaluating→completed` の副作用（F.4 コイン一括確定）は `_finalize_completion` の **no-op フック＋TODO**（F 実装で結線）。完了後は書き込み凍結（`_guard_not_completed`）。
- **削除（C.2 DELETE）**＝論理削除（`deleted_at`/`deleted_by_id`）・子データは物理削除せず監査保持（§5.6）。
- **横断UI 標準**＝§4.7 入力検証（インライン＋上部サマリ・blur・フォーカス移動なし・i18n）／§4.8 編集不可フィールド（muted 塗りで区別・readonly/disabled 使い分け）／§4.5 複製（登録ダイアログ プリフィル・一意キー除外）。役割選択は `.seg` セグメント切替（native select 不可・DoD=モック一致）。
- **カテゴリ `is_custom`**＝会社内マスタ未整備（C.7 TBD）で現状全 True（`_PRESET_CATEGORIES` 空）。**色**はプリセット10色 hex 正本未確定で形式検証（#RRGGBB）のみ。
- **可視性**＝下書きは本人のみ／公開系は owner か有効パーティー員のみ（範囲外 404）。候補の自己除外は `SessionUser.user_id`（tenant user_id）を frontend に渡す。
- **実装順**＝アカウント→クエスト→アイデア→評価→その他（`doc/実装計画.md`）。C が D/E/F/フィードの門番。

## 7. 次にやること（優先順・具体的に）
1. **SC-11/SC-12 の受入ゲート（ユーザー動作確認）**＝SC-10 一覧→作成/下書き→編集→公開／SC-12 詳細（ヘッダー/概要/パーティー）→⋯ステータスを進める→編集→削除。合意で完了確定。
2. **SC-11/SC-12 の e2e**＝`impl/frontend/e2e/` に実接続版（作成→一覧反映・§4.7 エラー・編集プリフィル→保存／詳細表示・遷移・削除・パーティー）。**1ファイルずつ＋FLUSHALL**。複製 e2e も検討。
3. **既存フォームを §4.7 へ順次是正**（`.form-error` 旧式・先頭1件のみ表示のもの＝CompanyCreateForm/AccountFormPanel/QuestGroupSection 等）＝`FormSummary`＋`lib/forms/validation` に載せ替え。
4. **C の残り（他ドメイン依存で保留）**＝時系列フィード（SC-12→SC-01・`activities` 絞り込み＝G）／クエスト内週間ランキング（G）／全文検索（J）／アイデア一覧（D）。C 単体の EP はほぼ完了。
5. **次ドメイン＝D（アイデア）** に着手（実装計画）。SC-12 のアイデアタブ・SC-21/22 が対象。
6. **（保留）会社の active 化手順の確認**（`companies.status` 更新方法＝suspended だとテナント API 503）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／minio :9000/:9001／mailhog UI :8025。**e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend コード反映**＝`up -d --build frontend`。
- **backend テスト**（cwd=`impl`）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`（`--no-deps` 不可＝redis 前提／db 起動直後は `pg_isready` 待ち）。範囲＝`pytest tests/quests -q`。
- **openapi 型再生成**（backend 再ビルド後）＝`docker compose -f impl/compose.yaml exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose -f impl/compose.yaml cp frontend:/app/src/lib/api/schema.d.ts /home/t-umekawa/sc-ideaquest-G2/impl/frontend/src/lib/api/schema.d.ts`（cp 先は絶対パス）。
- **frontend 型チェック**＝`docker compose -f impl/compose.yaml exec -T frontend npx tsc --noEmit`（既知2件は §4-2）。
- **frontend e2e**（Docker）＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium` (3)`exec -T redis redis-cli FLUSHALL`（各 spec 前）(4)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ**。
- **dev ログイン（PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF・表示名「テスト 太郎」・**デモグループ所属済**)・`ACME-02`/`mfa@acme2.example`(MFA ON)。MailHog＝`http://localhost:8025`。
- **MinIO env（dev）**＝`MINIO_ACCESS_KEY=ideaquest`/`MINIO_SECRET_KEY=ideaquest-secret`/`MINIO_BUCKET=ideaquest`。
- 規約＝`CLAUDE.md`（「各種規約」＋「設計の正本」節）から辿る。実装順の正＝`doc/実装計画.md`。デザインの正＝`doc/画面設計/mocks/*.html`（`style-guide.html`：§4b 入力検証・§4c 編集不可・§9 複製）＋`screens/*.md`＋`デザイン標準.md`（§4.5 DataTable/複製・§4.7 入力検証・§4.8 編集不可）。API 設計＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`（クエスト §5.6〜§5.9・通知 §5.24・enum §3）。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に削除。
