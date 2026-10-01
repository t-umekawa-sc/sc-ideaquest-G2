# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/規約/テスト規約.md §4.1`（e2e 方針）／`doc/セッション調整/並行開発の取り決め.md`（2トラック並行の衝突回避）。
> **体制**＝2トラック。**本トラック＝テストコード改修（e2e 信頼性）**／**別セッション＝機能実装（SC-94 等）**。並行時は取り決め md を必読。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-10-01（セッション末）
- ブランチ: `main`（作業ツリー clean 見込み）。origin 同期＝本更新を push 予定。
- 最新コミット（新しい順）:
  - `a2d9a7d1` test(e2e): fixtures に N=0 フォールバック（通常スタックは ACME-01 共有＝移行互換）
  - `0899a013` test(e2e): sc-22-attachments を会社スコープ隔離に変換
  - `709e7a74` test(e2e): ワーカ別DB隔離の基盤＋sc-02を会社スコープ隔離に変換（MVP実証）
  - `6ca34373` docs(handoff): e2e信頼性トラックの区切り＋並行開発の取り決め
  - `447f3f89` test(e2e): フレーク硬化（隠れ決定的seed依存の自己完結化＋race修正）
  - `f278e339` test(e2e): pristine復元(方式A)＋正準seed再現化で「毎回同じ失敗」を解消
- worktree `../g2-e2e`（ブランチ `e2e/per-worker-db-isolation`）は main に ff マージ済み＝**撤去してよい**（§7-注）。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発をゲーム感UIで一気通貫。直近の本命＝FR-45 LLM連携基盤（機能トラック）／**e2e 信頼性確立（本トラック）**。

## 3. 今回やったこと（変更とその理由）

### (A) e2e「毎回同じ失敗」の根治（`f278e339`・`447f3f89`）
- 真因＝正準 e2e seed（デモクエストグループ・`user2/user3/kanri`・`user@acme` の参加クエスト）が **bootstrap に無く手動DBボリューム依存**。clean pytest 用に acme を drop すると消え 46–48本が決定的失敗。
- 対策＝pristine 復元（方式A・`e2e/db.reset.ts`＋config `reset` project）＋ seed を bootstrap に再現可能化（`scripts/bootstrap.py` の `_SEEDS` に user2/user3/kanri・`seed_demo_quest_group`）＋ 隠れ decisive 依存のテスト自己完結化（`sc-10-list-state`・`sc-01-dashboard`・`sc-99-scroll-restore`）＋ race 修正（`sc-92-company-detail` B-TC-113・`sc-92c` B-TC-179）。規約 `doc/規約/テスト規約.md §4.1` に明文化。

### (B) ワーカ別DB隔離（会社スコープ・`709e7a74`→`0899a013`→`a2d9a7d1`）
- 残る**非決定の並列競合フレーク**を断つ機構。**会社スコープのデータ競合**（共有 `user@acme`/会社DB の奪い合い）に有効。
- 仕組み＝各 Playwright ワーカに専用会社 `ACME-W{parallelIndex}`（DB `ideaquest_company_acme_w{i}`）を割当て。各ワーカ会社は ACME-01 と同じ login_id 群（login_id は会社単位一意＝使い回し）。
  - `impl/backend/app/core/config.py`＝`e2e_worker_companies`（env `E2E_WORKER_COMPANIES`・既定0）。
  - `impl/backend/scripts/bootstrap.py`＝非prod かつ N>0 で `ACME-W0..W{N-1}` を seed（`_worker_seeds`／`_seed_quest_group_for` をループ）。**既定0＝通常スタック/本番は不変**。
  - `impl/compose.yaml`＝`E2E_WORKER_COMPANIES`／`APP_BASE_URL`／`ALLOWED_ORIGINS` をパラメータ化（iqe2e 隔離用）。
  - `impl/frontend/e2e/fixtures.ts`（新規）＝worker スコープ fixture（`workerCompany`）＋ storageState 上書き（各ワーカが自社 user@acme で1回ログイン）。**N=0 は ACME-01 共有へフォールバック**（通常スタック互換）。
  - `impl/frontend/e2e/db.reset.ts`＝ワーカ会社DBも drop 対象（N から算出）。
  - `impl/frontend/playwright.config.ts`＝N>0 のとき `workers=N`（parallelIndex↔会社対応）。
- 変換済み spec＝`sc-02-notifications`（H-TC-208 通知count競合）・`sc-22-attachments`。**import を `./fixtures` に替え・psql は `workerCompany.dbName`・login_id は `LOGIN_ID`**。両モード（隔離/フォールバック）で動く。

## 4. 現在の状態
- **確認済み（本セッション）**:
  - **通常 main の品質**＝backend pytest（クリーンDB）907 passed／frontend vitest 218 passed／TC トレーサビリティ OK（927）。e2e フル（既定ワーカ・ワーカ起動）＝green（0 failed・flaky は retries 吸収）。
  - **ワーカ別DB隔離（iqe2e）**＝機構を end-to-end 実証。sc-02（repeat-each=3・workers=2）12 passed／sc-22（同）8 passed/1 flaky（残は添付アップロードtiming）。フォールバック（N 未設定）でも sc-02/sc-22＝8 passed。
  - **フル iqe2e（N=7・workers=7）＝5 failed / 10 flaky / 146 passed**。変換済み2本は failed/flaky に不在（隔離は効き・回帰なし）。
- **重要な確定事項（§6）**＝per-worker 会社DB隔離は**会社スコープの競合にのみ有効**。フル iqe2e の**ハード失敗5件中4件が control-plane（OPS/認証）/タイミング**（SC-00 MFA/再設定・B-TC-124・M-TC-013／会社スコープは D-TC-203 のみ）。**会社DB隔離だけでは全 green に届かない**（別アプローチが要る）。
- **壊れているもの**＝確認範囲で無し（通常スタックは不変＝E2E_WORKER_COMPANIES 既定0）。
- **未確認**＝機能側（FR-45 SC-04 挙動・SC-94 等）は本セッションで個別未検証＝機能トラックに委ねる。実機 LLM（Ollama）未実施（FakeChat 固定）。

## 5. 詰まっている点（試して失敗した / なぜ）
- **ワーカ数低減では決定性に到達しない**（workers 7→4→2 どれも2回に1回ほど1件ハード失敗）＝main は既定ワーカ据え置き。
- **ブラウザログイン 403**＝`allowed_origins`（`app/core/deps.py`・既定 3000/8000）が iqe2e の :3100 を弾いていた。compose `ALLOWED_ORIGINS` を env 化し :3100/:8100 を許可して解消（curl は Origin 無しで通っていたため気づきにくい）。
- **fixtures を import した spec は N=0 だと ACME-W{i} 未 seed で壊れる**＝N=0 フォールバック（ACME-01 共有）を fixtures に実装して解消。
- **Playwright のサマリは tail/パイプで誤読**＝本体 exit code か `test-results/.last-run.json` で判定。ANSI 除去してから grep。

## 6. 決定事項と根拠（採用しなかった案も）
- **e2e リセット＝方式A（毎回 drop→bootstrap）**。永続テンプレDB（方式B）不採用＝migration head ドリフト事故。
- **残フレーク対策＝ワーカ別DB隔離（会社スコープ先行・段階導入）をユーザー選択**。ワーカ低減は無効と実測確定のため。per-worker 会社DBは会社スコープにのみ有効（§4）と実証。
- **全 green を per-worker 会社DBで追うのは費用対効果が合わない**＝支配的残失敗が control-plane/タイミングで、会社DB隔離では直らない。**本増分（機構＋会社スコープ2本）を main にマージして区切る**（ユーザー決定）。残は retries 吸収で受容し、必要時に個別対応。

## 7. 次にやること（優先順・本トラック＝テストコード）
> 機能実装は別セッション。着手前に取り決め md を読む。**worktree 撤去**＝`git worktree remove ../g2-e2e --force`（node_modules シンボリックリンク済のため --force）＋ `git branch -d e2e/per-worker-db-isolation`（ff 済）。**iqe2e スタック撤去**＝`cd impl && COMPOSE_PROJECT_NAME=iqe2e docker compose --profile workers down -v`（別プロジェクトのボリュームも消す）。
1. **（やるなら）会社スコープ spec を追加変換**＝`D-TC-203`(sc-21-idea-form) 等の会社スコープ系を fixtures へ（import 替え＋psql は `workerCompany.dbName`）。storageState のみの spec は **import 替えだけ**で済む（sc-22 と同型）。変換後 iqe2e（N=7）で再測定。
2. **control-plane フレーク**（B-TC-113/114/116/124/138/140/169・SC-00 MFA/再設定）＝OPS/認証の共有が原因。per-worker 会社DBでは直らない＝(a) 各テストの個別硬化（waitFor/scoped assertion）か (b) OPS 側 per-worker 化（大）。費用対効果で判断。
3. **タイミングフレーク**（M-TC-013 scroll・D-TC-215 添付アップロード・M-TC-002 drawer）＝描画/アップロード待ちの個別硬化。
4. **（任意）実機 LLM 縦1本**＝`docker compose --profile ai up -d ollama`→`ollama pull qwen3:4b`→worker 起動→SC-04 から enqueue。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`。**コマンドは絶対パス**（シェル cd 不持続）。compose＝`impl/compose.yaml`。
- **通常起動（既定スタック・別セッションもこれ）**＝`cd impl && docker compose up -d --build`。e2e は **worker/mail-worker 起動必須**（`docker compose up -d worker mail-worker`）。
- **ワーカ別DB隔離（iqe2e・本トラックの e2e 検証）**＝別 compose プロジェクトで起動（N は seed 会社数＝workers に一致させる）:
  `export COMPOSE_PROJECT_NAME=iqe2e DB_PORT=5533 REDIS_PORT=6380 MAILHOG_SMTP_PORT=1125 MAILHOG_UI_PORT=8125 MINIO_PORT=9100 MINIO_CONSOLE_PORT=9101 BACKEND_PORT=8100 FRONTEND_PORT=3100 E2E_WORKER_COMPANIES=7 APP_BASE_URL=http://localhost:3100 MINIO_PUBLIC_ENDPOINT=localhost:9100 ALLOWED_ORIGINS='["http://localhost:3100","http://localhost:8100"]'`
  → `cd impl && docker compose --profile workers up -d --build`。
  **e2e 実行**＝`cd impl/frontend && COMPOSE_PROJECT_NAME=iqe2e PLAYWRIGHT_BASE_URL=http://localhost:3100 E2E_WORKER_COMPANIES=7 ALLOWED_ORIGINS='["http://localhost:3100","http://localhost:8100"]' npx playwright test --project=chromium`（reset が会社DBを drop→bootstrap・N 社 seed）。
- **backend pytest（クリーンDB）**＝ワーカ停止→`docker compose exec -T db psql -U ideaquest -d postgres -c "DROP DATABASE IF EXISTS ideaquest_company_acme WITH (FORCE);"`（acme2 も）→`docker compose run --rm -T -v "$PWD/backend:/app" backend pytest -q`（cwd=impl）。**pytest 後はワーカを戻す**。FakeEmbeddings＋FakeChat 固定（conftest）。
- **frontend 検証**＝`cd impl/frontend && npm run build`（tsc/lint・必須）・`npx vitest run`。e2e トリアージは `--workers=1`（直列）・結果は `test-results/.last-run.json` でも。**e2e は実行のたび会社DBを drop→bootstrap**（既定スタックで回すと手動データが消える＝取り決め md §5）。
- **seed（方式Aで毎回再現）**＝ACME-01: `user@acme`(member・storageState)/`user2`/`user3`/`kanri`(company_account_admin)/`e2e-session`/`e2e-pwreset` ＋ `DEV-DEMO` グループ＋発見/情報デモ。`mfa@acme2`(ACME-02)。OPS `admin@ops`(system_admin)。N>0 なら `ACME-W0..` にも同 login_id 群＋グループ。全 PW `Passw0rd!`。
- **ポート（既定）**＝front 3000／back 8000／db 5432／MailHog 8025／MinIO 9000／Ollama 11434（profile ai）。iqe2e は 3100/8100/5533/6380/8125/9100。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py`。company migration head＝`0048_ai_jobs`（次 0049）。
