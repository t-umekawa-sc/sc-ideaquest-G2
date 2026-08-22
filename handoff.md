# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-22 JST**
- ブランチ: **main**（作業も main に直接コミット）。**push は都度ユーザー承認制**。
- **全コミット push 済み（未 push＝0・`main...origin/main` 同期）**。最新＝`c5164d7`。
- 直近コミット（新しい順）:
  - `c5164d7` docs(README): 検証用の会社・ユーザー追加手順（手動プロビジョニング）を追記
  - `e60e2ac` test(e2e/SC-11・SC-12): クエスト作成/検証/詳細/遷移/削除の実接続 e2e
  - `d4a6ec3` fix(SC-92/93): 所属グループ行をモック準拠のカード化（.mrow・薄い灰色背景＋境界）
  - `8eb1774` docs(handoff)／`ddf332a` SC-12 詳細フロント接続／`afde1e7` 役割 .seg 化／`f66e3d6` SC-12 backend／`9430acd` §4.8 readonly／`b9db16d` QG 編集ダイアログ
  - （さらに前＝`14549b3` SC-11 編集導線／`9f78b87` SC-11 作成接続＋§4.7／`1ff1be0` SC-11 backend）
- 再開時は `git status -sb` と `git log --oneline -15` で確認。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝画面移植完了、**backend 接続を 1画面単位ループ**（フロー規約 §1.1・各画面で受入ゲート）。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)。**フェーズ2「クエスト管理（C ドメイン）」ほぼ完了**（残りは D/E/F/G/J 依存部分）。**次フェーズ＝D（アイデア）**。
- **CLAUDE.md に「設計の正本」参照節あり**（デザイン標準/セキュリティ一覧/実装計画/本番デプロイ要件/要件定義README/API設計README を必読タイミング付きでポインタ登録・自動全文ロードはしない）。

## 3. C ドメイン（クエスト）の到達点
**C ドメインは SC-10/SC-11/SC-12 を backend＋frontend で接続完了**（D/E/F/G/J 依存部分を除く）。詳細は git 履歴。要点:

### 3-A. backend（`impl/backend/app/tenant/quests/`）＝C.1〜C.5 をほぼ網羅
- EP＝`GET /quests`（一覧 SC-10）・`GET /quests/{id}`（詳細）・`POST /quests`（作成）・`PATCH /quests/{id}`（編集）・`POST /quests/{id}/publish`（公開）・`POST /quests/{id}/transition`（前進遷移 C.5）・`DELETE /quests/{id}`（論理削除）・`PUT/DELETE /quests/{id}/icon-image`（アイコン2段・論点2）・`GET /quests/{id}/members`・`PUT /quests/{id}/party`・`POST /quests/{id}/members`・`DELETE /quests/{id}/members/{user_id}`・`PUT /quests/{id}/members/{user_id}/permissions`（C.3）・`GET /quest-groups`・`GET /quest-groups/{id}/members`（候補 C.4）。
- `application.py`＝ドメイン関数 `_validate_publishable`／`_apply_party_diff`（候補制限・owner 付与は作成者のみ・作成者保護・既定権限）／`_normalize_categories`（NFKC＋トリム＋大小無視の重複排除）／`_authorize_edit`／`_build_detail`（`_members_payload`/`_member_dto` に共通化）／`_guard_not_completed`（完了凍結 409）／`_notify_party_invited`＋`_finalize_completion`（**H の参加通知・F.4 コイン確定は各ドメイン実装まで no-op フック＋TODO**）。現在 status で検証分岐（draft=緩い/公開中=strict/completed=409）。遷移は前進のみ（現在の次のみ・逆行/飛越 409・draft→recruiting は strict）。
- 変更系は Origin/CSRF＋認可（owner/quest_admin・owner 付与は作成者のみ）。schema 名は `Quest*` で一意化（衝突回避）。

### 3-B. frontend
- SC-10 一覧（`QuestListView`・下書きクリック→`/quests/{id}/edit`）／SC-11 作成・編集（`QuestForm` 両対応・グループ/候補フェッチ・権限 UI⇔API 写像・下書き/公開・アイコン2段・編集ルート `/quests/[id]/edit`＋intercept）／SC-12 詳細（`QuestDetailView`＝ヘッダー/概要/パーティーを実接続＋⋯ 状態遷移・削除。**アイデア/検索/ランキングタブは D/J/G 未実装でデモ維持**）。
- `api.ts`＝getQuest/createQuest/updateQuest/publishQuest/transitionQuest/deleteQuest/setQuestIcon/deleteQuestIcon/listGroupMemberCandidates＋`QUESTS_CHANGED_EVENT`（作成/公開/遷移/削除で発火→一覧再取得）。

### 3-C. 横断UI 標準・是正（本フェーズで整備）
- **§4.7 入力検証**＝impl 共通部品 `components/ui/FormSummary`＋`lib/forms/validation`（i18n カタログ`t()`＋problem+json→フィールド/サマリ写像`mapServerErrors`・ja/en）＋`.form-summary`（design-system.css）。インライン `aria-invalid`＋上部サマリ・送信時＋blur・**フォーカス移動しない**。
- **§4.8 編集不可フィールド**＝`.input/.textarea/.select` の `:disabled`/`[readonly]` に muted 塗り＋文字色＋弱いボーダー（design-system.css＋mocks/shared.css）。`readonly`=値を見せるが変更不可／`disabled`=操作不可。
- **§4.5 複製**＝`lib/forms/duplicate.ts`（URL モーダル用 `?dup=<JSON>`）＋SC-91/SC-93/SC-92(QG) に適用。一意キーは複製しない。SC-90 qgadmin はメンバー管理一覧＝非適用。
- **役割選択 `.seg`／所属行 `.mrow`**＝アカウント発行/編集の所属クエストグループを `MembershipsEditor` でモック SC-92 に一致（`.seg__btn` 役割切替＋`.mrow` の薄い灰色カードで境界明確化）。native select は使わない。
- **SC-92 QG「編集」ダイアログ**＝`window.prompt` 廃止・共通 Modal でグループ名のみ編集（コードは readonly）。

## 4. 現在の状態（動く / 壊れている / テスト）
### 4-1. backend
- 登録ルータ＝auth / admin / me / **quests**。company migration head＝`0009_company_quests`（本フェーズで変更なし・SC-12 は DDL 不要）。
- **未実装（他ドメイン依存）**＝アイデア=D／チャット=E／評価=F／週間ランキング・時系列フィード・XP/コイン確定(F.4 フック)=G／全文検索=J／通知(`quest_party_invited` は spec 登録済み・C 側 no-op)=H／WS=L。API 設計は全ドメイン確定。
- **pytest＝269 passed**（quests 48件＝repository 10＋SC-10 api 5＋SC-11/12 api 33）。既知フレーク＝`test_a_tc_040`（pytest-randomly 順で稀に IndexError・単独で green）。

### 4-2. frontend
- backend 接続済み＝SC-00 認証／SC-03/K プロフィール／SC-10 一覧／SC-11 作成・編集／SC-12 詳細（ヘッダー/概要/パーティー＋遷移＋削除）／SC-90/91/92/93 管理。「複製」＝SC-91/93/92(QG)。
- **受入ゲート未確定**＝SC-11/SC-12 はユーザー動作確認待ち（疎通は curl・e2e で確認済）。
- **未接続（デモ fixtures）**＝SC-01 各パネル/SC-02/SC-12 のアイデア・検索・ランキングタブ/SC-21/22/24/25/30/31/32/40/41。
- **frontend tsc＝既知2件のみ**＝`Snackbar.tsx:57`・`ShopView.tsx:98`（今回変更と無関係）。

### 4-3. テスト
- **backend pytest 269 passed**。
- **e2e 追加済み（green 確認）**＝`e2e/sc-11-quest-create-modal.spec.ts`（4件＝URLモーダル開閉/直アクセス/§4.7検証/下書き作成→一覧反映）・`e2e/sc-12-quest-detail.spec.ts`（2件＝詳細の実データ描画/遷移＋削除）。**ACME-01 一般ユーザー＋デモグループ seed 前提**・各テストで API 後片付け。**1ファイルずつ＋FLUSHALL** で実行。
- OpenAPI 型再生成後の**スキーマ名衝突なし**を確認済。

### 4-4. 稼働状態 / dev seed
- **本セッションで backend/frontend を再ビルド済み・全サービス起動中**（`--profile workers`）。再起動で全 exit したら §8 で再起動。
- **dev seed（検証用・削除可）**＝ACME-01 会社DB に **クエストグループ「デモグループ」(code `DEMO`)** ＋一般ユーザー `user@acme.example`（表示名「テスト 太郎」）を所属。
- **手動追加テナント＝SYSCON**（`db_identifier=db_sc`・**本セッションで `status=active` に更新済み**）。db_sc は会社スキーマ head まで適用済み。発行済みアカウント `t-umekawa`（初回PW設定は MailHog 経由・未確認）。→ 会社追加/有効化の手順は **README.md「検証用の会社・ユーザーを追加する」**（`c5164d7`）に明文化。

## 5. 詰まっている点（試して失敗した / 注意）
- **frontend/backend はソース焼き込み（ボリューム未マウント）**＝`up -d --build frontend`／`up -d --build backend worker mail-worker` で再ビルドしないとホスト編集が反映されない。**e2e spec もコンテナに焼き込み**＝実行前に `docker compose cp <spec> frontend:/app/e2e/`（または frontend 再ビルド）。
- **backend テスト/red-green の cwd 罠**＝`run --rm -T -v "$PWD/backend:/app" backend pytest ...` は **cwd=`impl` 前提**。`cd .../quests` 等に移ると `$PWD/backend` が消えて bootstrap が `No module named 'scripts'` で落ちる。**必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`**。`docker compose cp` 先も絶対パス。
- **red-green の運用**＝コードが先に出来ている時は対象ガードを一時無効化して red を目視→復元して green。`cp application.py /tmp/xxx.bak`→編集→`cp /tmp/xxx.bak application.py`→`grep -c RED-DEMO`＝0 を確認。
- **テナント検証の前提**＝一般ユーザーはクエストグループ所属が無いと作成不可＆一覧空。**会社が suspended だとテナント API 503**（§1.5）。**会社の active 化は MVP 手動**＝`UPDATE companies SET status='active' ...`（control DB `ideaquest_control`・専用 EP 未実装）。会社DBの作成/移行は `docker compose exec backend python -m scripts.bootstrap`（冪等・全会社走査）。
- **OpenAPI schema 名の衝突**＝同名 Pydantic クラスが2ドメインにあると openapi-typescript が完全修飾名にリネームし既存型を壊す。**新規 schema は名前衝突しないか確認**（C は `Quest*` で一意化）。codegen 後は必ず frontend tsc で検知。
- **impl 共通部品の型注意**＝`useConfirm` の本文は **`msg`**（`message` ではない）。`QuestIcon` props は `name/color/imageUrl/size`（`ownerName` 無し）。`.seg` は `.seg__btn`＋`aria-pressed`。所属行は `.mrow`（`.mrows` コンテナ＋`.mrow__name`/`.mrow__remove`）。
- **e2e の OPS ログイン レート制限フレーク**＝**1ファイルずつ＋各前に `redis-cli FLUSHALL`**。frontend 再ビルドで Playwright chromium/依存が消える（毎回 `install-deps chromium`＋`install chromium`）。
- **MinIO 署名URL**＝backend は内部 `minio:9000`、ブラウザは公開 `localhost:9000`。e2e（コンテナ内ブラウザ）では実ロード不可＝`src` 属性検証のみ。クエストアイコン prefix＝`quest-icons/`。
- **Alembic revision id は 32字以内**。会社DB head＝`0009_company_quests`。管理DB head は要確認（前回 `0010_accounts_pending_email`）。

## 6. 決定事項と根拠
- **SC-11/SC-12 実装方針（論点1〜4・確定 2026-08-22）**＝編集ルート追加／アイコン専用EP+2段／publish 参加通知は H まで no-op（`quest_party_invited` を enum/§5.24/H.0 に登録済み＝漏れ防止）／下書き members 空は許容（公開時 strict）。
- **状態遷移（C.5）**＝前進のみ・現在の次のみ許可（逆行/飛越 409）。draft→recruiting は publish 相当で strict。evaluating→completed の副作用（F.4 コイン一括確定）は `_finalize_completion` の no-op フック＋TODO（F 実装で結線）。完了後は書き込み凍結。
- **削除（C.2 DELETE）**＝論理削除（`deleted_at`/`deleted_by_id`）・子データは監査保持（§5.6）。
- **会社プロビジョニング＝MVP 手動運用（データモデル §8-⑫）**＝会社作成 API は control DB に `status=suspended` 行を作るのみ。会社DB作成/移行＝bootstrap。active 化＝control DB 直接 UPDATE（専用 EP 未実装＝将来 SC-91/92 に「有効化」アクション候補）。手順は README に明文化。
- **横断UI 標準**＝§4.7 入力検証／§4.8 編集不可フィールド／§4.5 複製／役割 `.seg`・所属行 `.mrow`（DoD=モック一致・native select 不可）。
- **カテゴリ `is_custom`**＝会社内マスタ未整備（C.7 TBD）で現状全 True。**色**はプリセット10色 hex 正本未確定で形式検証（#RRGGBB）のみ。
- **可視性**＝下書きは本人のみ／公開系は owner か有効パーティー員のみ（範囲外 404）。候補の自己除外は `SessionUser.user_id`（tenant user_id）を frontend に渡す。
- **実装順**＝アカウント→クエスト→アイデア→評価→その他（`doc/実装計画.md`）。

## 7. 次にやること（優先順・具体的に）
1. **SC-11/SC-12 の受入ゲート（ユーザー動作確認）**＝作成/下書き/編集/公開／詳細（ヘッダー/概要/パーティー）→遷移→編集→削除。合意で完了確定。
2. **既存フォームを §4.7 へ順次是正**（`.form-error` 旧式・先頭1件のみ表示のもの＝CompanyCreateForm/AccountFormPanel/QuestGroupSection 等）＝`FormSummary`＋`lib/forms/validation` に載せ替え。
3. **次ドメイン＝D（アイデア）着手**（実装計画）。SC-12 アイデアタブ・SC-21 アイデア登録編集・SC-22 アイデア詳細。まず D の API 設計（`doc/API設計/D_*.md`）・データモデル（§ideas 系）・screens を精読 → データ基盤（ORM/migration/repository）→ 1画面ループ。
4. **C の残り（他ドメイン依存で保留）**＝時系列フィード（SC-12→SC-01・`activities` 絞り込み＝G）／クエスト内週間ランキング（G）／全文検索（J）／アイデア一覧（D）。C 単体 EP はほぼ完了。
5. **（任意）SC-91/92 に「会社を有効化」アクション**（＋DBプロビジョニングのトリガー）で手動運用を解消。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／minio :9000/:9001／mailhog UI :8025。**e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend コード反映**＝`up -d --build frontend`。
- **backend テスト**（cwd=`impl`）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`（`--no-deps` 不可／db 起動直後は `pg_isready` 待ち）。範囲＝`pytest tests/quests -q`。
- **openapi 型再生成**（backend 再ビルド後）＝`docker compose -f impl/compose.yaml exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose -f impl/compose.yaml cp frontend:/app/src/lib/api/schema.d.ts /home/t-umekawa/sc-ideaquest-G2/impl/frontend/src/lib/api/schema.d.ts`（cp 先は絶対パス）。
- **frontend 型チェック**＝`docker compose -f impl/compose.yaml exec -T frontend npx tsc --noEmit`（既知2件は §4-2）。
- **frontend e2e**（Docker）＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium` (3)`cp <spec> frontend:/app/e2e/`（焼き込み・ホスト編集を反映）(4)`exec -T redis redis-cli FLUSHALL`（各 spec 前）(5)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ**。
- **会社DB 作成/有効化（手動）**＝`docker compose exec backend python -m scripts.bootstrap`（作成+移行・冪等）→ `docker compose exec db psql -U ideaquest -d ideaquest_control -c "UPDATE companies SET status='active' WHERE company_code='<CODE>';"`。詳細は README。
- **dev ログイン（PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF・表示名「テスト 太郎」・**デモグループ所属済**)・`ACME-02`/`mfa@acme2.example`(MFA ON)。手動追加＝`SYSCON`/`t-umekawa`（active・初回PW設定は MailHog）。MailHog＝`http://localhost:8025`。
- **MinIO env（dev）**＝`MINIO_ACCESS_KEY=ideaquest`/`MINIO_SECRET_KEY=ideaquest-secret`/`MINIO_BUCKET=ideaquest`。
- 規約＝`CLAUDE.md`（「各種規約」＋「設計の正本」節）。実装順の正＝`doc/実装計画.md`。デザインの正＝`doc/画面設計/mocks/*.html`（`style-guide.html`：§4b 入力検証・§4c 編集不可・§9 複製）＋`screens/*.md`＋`デザイン標準.md`（§4.5 DataTable/複製・§4.7 入力検証・§4.8 編集不可）。API 設計＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`。**会社追加手順＝ルート `README.md`**。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に削除。
