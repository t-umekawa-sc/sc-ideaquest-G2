# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/規約/テスト規約.md §4.1`（e2e 方針）／`doc/セッション調整/並行開発の取り決め.md`（2トラック並行＋iqe2e 起動 env の正本）。
> **体制**＝2トラック。**本トラック＝テストコード改修（e2e 信頼性基盤）**／**別セッション＝機能実装**。並行時は取り決め md を必読。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-10-01（セッション末）
- ブランチ: `main`（作業ツリー clean）。origin 同期済み（本 handoff コミットを push）。
- 最新コミット（新しい順）:
  - `186aa0ea` test(e2e): control-plane アカウント一覧の件数判定を堅牢化（B-TC-124/125）
  - `0b53594b` docs(handoff): 会社スコープ spec 全変換＋iqe2e に LOGIN_RATE_LIMIT_MAX 必須を明記
  - `66bfdbf0` test(e2e): 残りの会社スコープ spec を会社スコープ隔離に変換（31本）
  - `2316d9cf` test(e2e): discovery/info デモseed をワーカ会社に展開＋sc-50 変換
  - `016fd677` sc-24-chat 変換／`2c7b43c8` sc-21/32/99 変換／`709e7a74` 基盤＋sc-02／`f278e339` pristine復元（詳細は git log）
- 作業用 worktree/ブランチ・iqe2e スタックは撤去済み（セッション末に down -v）。残骸は root 所有ログ dir のみ（`! sudo rm -rf /home/t-umekawa/g2-e2e*`）。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発をゲーム感UIで一気通貫。本トラックの本命＝**肥大化しても安定する e2e テスト基盤の確立**。

## 3. 今回やったこと（変更とその理由）
e2e の「毎回同じ失敗」根治（前セッション）に続き、**会社スコープの並列競合をワーカ別DB隔離で解消**し、**スケールする基盤の設計を確定**した。

### (A) ワーカ別DB隔離（会社スコープ）＝実装・マージ済
- 各 Playwright ワーカに専用会社DB（`ACME-W{parallelIndex}`／`ideaquest_company_acme_w{i}`）を割り当て、共有会社DB・共有 user@acme の並列競合を断つ。
- `impl/frontend/e2e/fixtures.ts`（中核）＝worker スコープ fixture `workerCompany`（company/dbName/loginId）＋ storageState 上書き（各ワーカが自社 user@acme で1回ログイン）。**N=0（通常スタック）は ACME-01 共有へフォールバック**（移行互換）。
- `impl/backend/scripts/bootstrap.py`＝env `E2E_WORKER_COMPANIES`（既定0・`app/core/config.py` の `e2e_worker_companies`）で N 社 seed（`_worker_seeds`/`_worker_company_defs`/`_demo_db_identifiers`）。`seed_demo_quest_group`/`seed_demo_discovery`/`seed_demo_info`/`seed_demo_info_filler` を会社パラメータ化し ACME-01＋ワーカ会社をループ seed。**既定0＝通常スタック/本番は ACME-01 のみで不変**。
- `impl/compose.yaml`＝`E2E_WORKER_COMPANIES`/`APP_BASE_URL`/`ALLOWED_ORIGINS` をパラメータ化（iqe2e 隔離用）。
- `impl/frontend/e2e/db.reset.ts`＝ワーカ会社DBも毎回 drop→bootstrap。`playwright.config.ts`＝N>0 のとき `workers=N`。
- **変換済み spec ≒43本**＝会社スコープはほぼ全部（sc-02/sc-21/sc-22-*/sc-24-chat/sc-25/sc-30-*/sc-31/sc-32/sc-40/sc-41/sc-03-*/sc-10/sc-11/sc-12-*/sc-13/sc-18/sc-50-*/sc-52-*/sc-70/sc-99-*/sc-01-dashboard-notif/responsive 等）。storageState のみは import 替えだけ。psql は `workerCompany.dbName`、form-login は `workerCompany.company`、login_id は `LOGIN_ID`/`user2`。

### (B) control-plane の件数判定を堅牢化（`186aa0ea`）
- `sc-93-own-accounts`（B-TC-124）・`sc-92b-accounts`（B-TC-125）＝`getByText("1 件")` が region 内の複数 `.list-count`（件/名）やページャ span と二重一致して strict 違反→**件数ラベル依存をやめ「行の有無」＋「検索欄クリア（value=''）」で判定**。

### (C) 基盤設計の確定（**未実装・次の本命＝§7**）
- 肥大化に耐える e2e 基盤として**2系統モデル**を採用決定（§6）。実装は未着手。

## 4. 現在の状態
- **確認済み（本セッション）**:
  - **iqe2e フル（N=7・workers=7・ワーカ起動）＝12 failed / 5 flaky / 144 passed**。12 のハード失敗は**全て変換スコープ外**＝control-plane 9本（B-TC-110/114/116/117/125※/169/178/179・※は本修正前）＋SC-00×2（認証・mail timing）＋D-TC-218（添付アップロード timing）。**変換済み spec のデータ競合失敗はゼロ**＝会社スコープ隔離は完了・回帰なし。
  - **backend pytest（クリーンDB・N=0）＝907 passed**（bootstrap 改修は通常スタックに無害）。
  - control-plane 直列分類（workers=1）＝27/29 pass＝大半は並列競合（直列では通る）。
- **重要な前提**＝**隔離は iqe2e スタック（`E2E_WORKER_COMPANIES=7` 等の env）で実行した時だけ有効**。**通常の既定スタックで e2e を回すと fixtures は N=0 フォールバック＝ACME-01 共有＝従来どおり並列競合でフレークする**。基盤の恩恵を得るには iqe2e で回すこと（§8）。
- **壊れているもの**＝確認範囲で無し（通常スタック・本番は不変）。
- **未確認**＝frontend vitest 全域（前セッションでは 218 passed・本セッション末は未再実行）／機能側（FR-45 等）。

## 5. 詰まっている点（試して失敗した / なぜ）
- **429 レート制限 cascade**＝全ワーカが同一 login_id `user@acme` でログインし (IP+login_id) バケットを共有（fixtures のワーカ別ログイン＋sc-00/sc-30-32 form-login＋retry）＝既定50だと大量失敗。→ **iqe2e は `LOGIN_RATE_LIMIT_MAX=100000` 必須**（compose env 既化・通常スタックは既定50で不変）。
- **ブラウザログイン 403**＝`allowed_origins`（`app/core/deps.py`・既定 3000/8000）が iqe2e の :3100 を弾く。→ iqe2e は `ALLOWED_ORIGINS` に :3100/:8100 を含める。
- **control-plane は個別硬化（wait/scoped assertion）では直らない**＝共有 admin@ops セッション＋共有 control DB（会社/アカウント一覧）の並列競合が原因。B-TC-115（編集反映）は wait+reload を試すも改善せず原状復帰（retries 吸収のフレークのまま）。件数曖昧（B-TC-124/125）のみ堅牢化できた。
- **batch 変換の落とし穴**＝`replace_all` はインデント一致必須（`await login(page)` の2/4スペース差で未更新になり G-TC-163/164 が company=undefined で落ちた→修正済）。

## 6. 決定事項と根拠（採用しなかった案も）
- **肥大化に耐える基盤＝2系統モデルを採用**（§7 で実装）：
  - **会社スコープ**（機能＝今後の増加の主体）＝per-worker 会社DB 隔離（実装済）＝新規は import だけで無償隔離・フル並列。
  - **control-plane/認証**（少数・増えにくい）＝`@serial` タグ→直列フェーズ＝共有 admin@ops 競合を構造的に回避・新規はタグだけ。
  - **共有ヘルパ `e2e/helpers.ts`**（DataTable assertion/psql/生成/login を集約）＋**規約化**で fragile を根治。
- **不採用①＝backend への test 専用「名前空間 Cookie ルーティング」**（各ワーカに専用の control+会社DB一式を Cookie で振り分け）＝最もエレガントだが**セキュリティで却下**。クライアント Cookie で接続先DBを選ばせる＝マルチテナント分離のバイパス面を最もセキュア critical なコードに常在させる（非prodゲートが壊れたら越境参照/破壊）。加えてワーカ（account_sync/mail/llm）はリクエスト文脈外で Cookie を運べず破綻。**ユーザー判断でNG**。
- **不採用②＝ワーカごとに丸ごと別スタック（N backend/frontend）**＝安全（backend 無改変）だが 7スタック≒50コンテナで資源・複雑さ過大。得られるのは「少数で増えにくい control-plane を並列化」だけ＝費用対効果が合わない。
- **不採用③＝ワーカ数低減で決定性**＝実測で無効（7→4→2 どれも稀に1件失敗）。
- **control-plane を直列にするのは妥協でなく適切**＝プラットフォーム/会社台帳は本質的に1個＝共有。画面数も限定的で増えにくい。無制限に増えるのは会社スコープ側で、そこは既に完全並列隔離済み。

## 7. 次にやること（優先順・本トラック＝e2e 基盤の 2系統モデル実装。§6 の決定に沿う）
> いずれも worktree＋iqe2e スタックで検証（§8）。着手前に取り決め md を読む。
1. **P1＝共有ヘルパ `impl/frontend/e2e/helpers.ts` 新設**（whack-a-mole の根治）。
   - DataTable assertion＝`expectListCount(region, n)`／`expectRowVisible(region, re)`／`expectSearchCleared(region)`（`.list-count` 多重・セル内 badge 問題をヘルパ内で吸収）。
   - 会社DB操作＝`psql(db, sql)`／`psqlValue(db, sql)`。ドメイン生成＝`createRecruiting`/`createOwnedQuest`/`createPublishedIdea`/`issueAccount`。ログイン＝`gotoAuthed(page)`（storageState）/`formLogin(page, creds)`。
   - 既存 spec に重複実装がある（例：`psql` は sc-02/sc-24/sc-01-dashboard-notif/sc-30-32、`createRecruiting` は sc-21/sc-25/sc-10 等）＝これを集約元にする。
2. **P2＝control-plane/認証 spec に `@serial` タグ＋2パス実行**。
   - 対象＝`sc-90-quest-group-admin`/`sc-91-companies`/`sc-92*`/`sc-93-own-accounts`/`sc-00-*`。テスト名 or `test.describe` に `@serial` を付す。
   - 実行＝バルク `npx playwright test --grep-invert @serial`（全並列）／control `npx playwright test --grep @serial --workers=1`。`playwright.config.ts` か実行スクリプト（`impl/frontend/package.json` の scripts 等）に恒久化。
3. **P3＝既存 spec を helpers へ段階移行**（重複 psql/login/list-assertion を置換）。会社スコープは変換済なので主に DRY 化。
4. **P4＝テスト規約 `doc/規約/テスト規約.md §4.x` に 2系統モデルを明文化**（分類・ヘルパ使用・@serial 運用）。
5. **（別件・スコープ外）残タイミングフレーク**＝D-TC-218（添付アップロード）・M-TC-013（scroll）・B-TC-115（編集反映）・SC-00（mail/OTP）。retries 吸収で受容 or 個別硬化（費用対効果で判断）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`。**コマンドは絶対パス**（シェル cd 不持続）。
- **通常起動（既定スタック・別セッションもこれ）**＝`cd impl && docker compose up -d --build`。e2e は worker/mail-worker 起動（`docker compose up -d worker mail-worker`）。**この既定スタックで e2e を回すと隔離は効かない（N=0 フォールバック）**。
- **iqe2e 隔離スタック（本トラックの e2e 検証＝隔離が効く）**＝別 compose プロジェクトで起動（取り決め md §4 が正本）:
  `export COMPOSE_PROJECT_NAME=iqe2e DB_PORT=5533 REDIS_PORT=6380 MAILHOG_SMTP_PORT=1125 MAILHOG_UI_PORT=8125 MINIO_PORT=9100 MINIO_CONSOLE_PORT=9101 BACKEND_PORT=8100 FRONTEND_PORT=3100 E2E_WORKER_COMPANIES=7 APP_BASE_URL=http://localhost:3100 MINIO_PUBLIC_ENDPOINT=localhost:9100 ALLOWED_ORIGINS='["http://localhost:3100","http://localhost:8100"]' LOGIN_RATE_LIMIT_MAX=100000`
  → `cd impl && docker compose --profile workers up -d --build`。**`LOGIN_RATE_LIMIT_MAX`（429回避）・`ALLOWED_ORIGINS`（:3100 の403回避）・`E2E_WORKER_COMPANIES`（workers と一致）は必須**。
  - e2e 実行＝`cd impl/frontend && COMPOSE_PROJECT_NAME=iqe2e PLAYWRIGHT_BASE_URL=http://localhost:3100 E2E_WORKER_COMPANIES=7 ALLOWED_ORIGINS='["http://localhost:3100","http://localhost:8100"]' LOGIN_RATE_LIMIT_MAX=100000 npx playwright test --project=chromium`（reset が全会社DBを drop→bootstrap）。トリアージは `--workers=1`。結果は `test-results/.last-run.json` でも。出力は ANSI 除去（`sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'`）してから grep・**パイプで exit code がマスクされるので本体 exit か "N failed" 行で判定**。
  - worktree 運用＝`git worktree add /home/t-umekawa/g2-e2e-X -b e2e/<topic>` ＋ `ln -s .../impl/frontend/node_modules <worktree>/impl/frontend/node_modules`（再インストール回避）。撤去＝`COMPOSE_PROJECT_NAME=iqe2e docker compose --profile workers down -v` ＋ `git worktree remove <path> --force`（残骸 logs は root 所有で `! sudo rm -rf`）＋ `git branch -d`。
- **backend pytest（クリーンDB・N=0）**＝ワーカ停止→`docker compose exec -T db psql -U ideaquest -d postgres -c "DROP DATABASE IF EXISTS ideaquest_company_acme WITH (FORCE);"`（acme2 も）→`docker compose run --rm -T -v "$PWD/backend:/app" backend pytest -q`（cwd=impl）。**pytest 後はワーカを戻す**。FakeEmbeddings＋FakeChat 固定。**iqe2e の DB で pytest する時は N=0 を明示**（`-e E2E_WORKER_COMPANIES=0`）＋ワーカ会社が control に残ると admin 系テストが汚染で落ちるので全DB drop 推奨。
- **frontend 検証**＝`cd impl/frontend && npm run build`（tsc/lint・必須）・`npx vitest run`。
- **seed（方式Aで毎回再現）**＝ACME-01: `user@acme`(member)/`user2`/`user3`/`kanri`(company_account_admin)/`e2e-session`/`e2e-pwreset`＋`DEV-DEMO`グループ＋発見/情報デモ。N>0 なら `ACME-W0..` にも同一 login_id 群＋デモ一式。`mfa@acme2`(ACME-02)。OPS `admin@ops`(system_admin)。全 PW `Passw0rd!`。
- **ポート（既定）**＝front 3000／back 8000／db 5432。iqe2e＝3100/8100/5533/6380/8125/9100。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py`。company migration head＝`0048_ai_jobs`（次 0049）。
