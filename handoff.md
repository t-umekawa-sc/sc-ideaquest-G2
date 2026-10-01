# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/規約/テスト規約.md`（テスト規約・§4.1 が今回の e2e 方針）。
> **本セッションからの体制**＝作業を2トラックに分割。**本トラック（次回の自分）＝テストコード改修（e2e 信頼性）**／**別セッション＝機能実装（SC-94 等）**。並行作業の衝突回避ルールは [`doc/セッション調整/並行開発の取り決め.md`](doc/セッション調整/並行開発の取り決め.md)（着手前に必読）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-10-01（セッション末）
- ブランチ: `main`（作業ツリーは本 handoff＋取り決め md のコミットのみ）。origin と同期予定（本コミットを push）。
- 本セッションのコミット（新しい順・いずれも push 済 or 本コミットで push）:
  - （本コミット）docs(handoff)＋並行開発の取り決め md
  - `447f3f89` test(e2e): フレーク硬化＝隠れ決定的seed依存の自己完結化＋明確なrace修正
  - `f278e339` test(e2e): pristine復元(方式A)＋正準seed再現化で「毎回同じ失敗」を解消
  - `0bb6199c` 以前＝前回までの FR-45 Phase1（backend＋SC-04 フロント）。詳細は git log。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。直近の本命は FR-45 LLM連携基盤（機能トラック）と、**e2e の信頼性確立（本トラック）**。

## 3. 今回やったこと（変更したファイルと理由）

本セッションは **e2e の「毎回同じ失敗が再現する」問題の根治**に費やした。

### (A) 真因の特定（蓄積ではなく seed 欠落）
- 当初「共有 dev DB の蓄積ドリフト」と仮説を立てたが、実装中に真因が判明＝**e2e の正準 seed が bootstrap で再現されない**こと。デモクエストグループ・`user2/user3/kanri` アカウント・`user@acme` の参加クエストは**手動作成で DB ボリュームにのみ存在**し、どの seed にも無かった。clean pytest 用に `ideaquest_company_acme` を drop した瞬間に消え、`createRecruiting` の `groups.data[0]` 等が undefined になり **46–48本が決定的に失敗**していた（「毎回同じ失敗」の正体）。

### (B) pristine 復元（方式A）＝コミット `f278e339`
- `impl/frontend/e2e/db.reset.ts`（新規）＝実行最前段で会社DB（`ideaquest_company_acme/acme2`）を `DROP DATABASE ... WITH (FORCE)` → `docker compose exec backend python -m scripts.bootstrap`（最新 migration＋demo seed）。bootstrap は冪等だが既存行はスキップするため復元には DROP が必須。
- `impl/frontend/playwright.config.ts`＝`reset` project を追加。chain＝**reset→setup(auth)→chromium→cleanup**（`setup` が `reset` に依存）。chromium の `testIgnore` に `db.reset` を追加。
- `impl/backend/scripts/bootstrap.py`＝正準 seed を**再現可能化**。`_SEEDS` に `user2@acme`/`user3@acme`/`kanri@acme`（kanri=`company_account_admin`）を追加＋新関数 `seed_demo_quest_group()`（固定UUID・`quest_group_code="DEV-DEMO"`・seed ユーザーを **member** 所属。`main()` から `seed_company_users()` の後に呼ぶ）。`GET /quest-groups` は「自分が有効所属するグループ」のみ返す（`app/tenant/quests/repository.py::get_quest_groups`）ため所属が必須。
- `doc/規約/テスト規約.md §4.1`＝方針を明文化（pristine復元／永続テストDB禁止＝migration ドリフト回避／seed は bootstrap に再現可能に／テストは seed 破壊禁止・自前データ+scoped assertion／直列トリアージ）。

### (C) フレーク硬化＝コミット `447f3f89`
- 並列で「flaky」に見えた一部は、実は pristine DB で**決定的に落ちる隠れ seed 依存**（並列時は他テスト生成物で"たまたま"埋まり retry 通過）だった。直列 `--workers=1` で炙り出して自己完結化：
  - `impl/frontend/e2e/sc-10-list-state.spec.ts`（M-TC-016/017/018）＝`beforeEach` で `createRecruiting` を2回呼び user@acme 参加クエストを2件用意。
  - `impl/frontend/e2e/sc-01-dashboard.spec.ts`（I-TC-157/158・D-TC-226）＝`createOwnedQuest` ヘルパを追加し、dash から is_owner を探す依存を排除。
  - `impl/frontend/e2e/sc-99-scroll-restore.spec.ts`（M-TC-014）＝自前でクエスト生成してからカードを待つ。
- 明確なテスト自身の race 修正：
  - `sc-92-company-detail.spec.ts`（B-TC-113）＝MFAトグル後 `waitForResponse(PATCH /settings)` を待ってから reload。
  - `sc-92c-quest-groups.spec.ts`（B-TC-179）＝`getByText(code)` を `getByRole("cell", {name:code})` に（検索チップとの二重一致＝strict違反回避）。

### (D) 取り決め md（本コミット）
- `doc/セッション調整/並行開発の取り決め.md`（新規）＝本トラック（e2e）と別トラック（機能実装）が衝突せず並行するためのルール（ブランチ分離・ファイル所有・docker 2スタック分離・db.reset のデータ破壊注意・マージ順）。

## 4. 現在の状態
- **動いている（本セッションで確認済み）**:
  - **backend pytest（クリーンDB）＝907 passed**（bootstrap seed 追加は無害・2026-10-01・acme/acme2 drop→bootstrap 後にフル）。
  - **frontend vitest＝218 passed**（33 files）。
  - **TC トレーサビリティ＝OK（code 927 件すべて md 記載）**。
  - **e2e フル（workers 既定7・worker/mail-worker 起動）＝0 failed / 7 flaky / 154 passed（exit 0＝green）**。決定的失敗 46–48→**0**。
- **壊れているもの**＝確認範囲では無し。
- **残課題（壊れてはいない）**＝e2e の残り数本は**非決定の並列競合フレーク**（直列では通る・顔ぶれが毎回変わる）。`retries:2` が吸収し大半の run は green だが、**毎回 green は保証しない**（下記 §5）。ユーザーの本来の懸念「毎回**同じ**失敗（決定的）」は解消済み。
- **未確認**＝(a) 機能側（FR-45 Phase1 の SC-04 フロント挙動・SC-94 等）は本セッションでは個別再検証していない＝前回 handoff／機能トラックに委ねる。(b) e2e 実機 LLM（Ollama）は未実施（テストは FakeChat 固定）。

## 5. 詰まっている点（試して失敗した / なぜ失敗したか）
- **ワーカ数低減では決定性に到達しない**（データで反証済み）＝workers 7→4→2 と下げても、どの値でも**2回に1回ほど1件ハード失敗**が出た（run 記録：w4=run1 0/run2 1 failed、w2=run1 1 failed/run2 0）。flaky 数は減るが、共有DBの競合（並列＋順次累積）が残るため消えない。**この変更は main に残していない**（`playwright.config.ts` は既定ワーカのまま）。
- **pristine 復元だけでは不十分だった**＝会社DBを drop しても、`seed_company_users` が control に溜まった過去テスト垢を会社DBへ全ミラーする／そもそも正準 seed（グループ・参加クエスト）が bootstrap に無い、の2点で決定的失敗が残った。→ (B)(C) で bootstrap seed 化＋テスト自己完結化して解消。
- **直列フル実行は "盲目的な時間" になりがち**＝全スイート直列は ~15–20分。トリアージは**疑わしい spec だけ `--workers=1` で単独/少数実行**して決定的/並列フレークを切り分けるのが速い。
- **Playwright はパイプで exit code がマスクされる**＋`tail` でサマリ先頭が切れると誤読する＝**本体 exit code**か `test-results/.last-run.json` の `status`/`failedTests` で判定する。ANSI 除去（`sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'`）してから grep する。

## 6. 決定事項と根拠（採用しなかった案も）
- **e2e リセット＝方式A（毎回 drop→bootstrap）採用。永続テンプレDB（方式B）不採用**＝B は速いが company migration head が進むとテンプレが陳腐化しスキーマがドリフト（焼き直し忘れ事故）。A は bootstrap が毎回最新 migration を流す＝維持すべきテスト専用DBが無い（backend pytest と同じ思想）。ユーザーの「マイグレーション先を増やすな／運用に注意」懸念に合致。
- **正準 seed は bootstrap に昇格**（手動作成の非再現 seed に依存しない）。`kanri` は `system_role="company_account_admin"`（`app/control_plane/admin/schemas.py` の Literal に有）。グループ所属は user@acme も **member**（admin にしない＝SC-90 B-TC-119/123「非QG管理者」前提を壊さない）。
- **残フレーク対策の最終方針＝ワーカ別DB隔離（option 2）**を選択（ユーザー決定）。ワーカ低減は無効と判明したため。per-test の個別硬化は決定的 seed 依存には有効だったが、非決定の競合フレーク全消しには非効率＝隔離が本筋。
- **2トラック並行は docker を別 compose プロジェクトで分離**（`COMPOSE_PROJECT_NAME=iqe2e`＋別ポート）＝ホストポートは env 化済・named volume・固定 `name:` 無しで並立可能。

## 7. 次にやること（優先順・具体的に＝本トラック＝テストコード）
> 機能実装（SC-94 等）は**別セッションの担当**。本トラックは e2e 信頼性を進める。着手前に [`doc/セッション調整/並行開発の取り決め.md`](doc/セッション調整/並行開発の取り決め.md) を読む。

1. **worktree＋ブランチを作る**＝`git worktree add ../g2-e2e -b e2e/per-worker-db-isolation`（main は別セッションが使う）。以降の (2)〜(5) はこのブランチで。
2. **ワーカ別DB隔離（option 2）＝ bootstrap**＝`impl/backend/scripts/bootstrap.py` に**ワーカ用会社を N 社 seed**（例 `ACME-W0..W{N-1}`／DB `ideaquest_company_acme_w{i}`／アカウント `w{i}@acme`／`seed_demo_quest_group` と同等の所属）。N はワーカ上限（例8）。`_SEEDS` 生成をループ化。
3. **worker スコープ fixture**＝`impl/frontend/e2e/fixtures.ts`（新規）で `testInfo.parallelIndex → {company, loginId, dbName}` を提供し、ワーカ別に storageState を作る（各ワーカが自社アカでログイン）。`auth.setup.ts` をワーカ別 state 生成に拡張。
4. **db.reset.ts をワーカ別対応**＝`impl/frontend/e2e/db.reset.ts` が N 社すべてを drop→bootstrap。
5. **約50 spec のパラメータ化**＝`ACME-01`/`user@acme.example`/`ideaquest_company_acme` を fixture 値へ。影響範囲（本日時点の grep）＝`ACME-01` 直書き **50/57 spec**・`user@acme.example` **45**・`ideaquest_company_acme` 直 psql **6**。OPS/管理系（control 直操作・会社作成）は共有が残るので隔離対象外として個別判断。段階的に＋都度 iqe2e スタックで検証。
6. **compose の `APP_BASE_URL` をパラメータ化**＝`impl/compose.yaml` 86行目（現状ハードコード `http://localhost:3000`）を `${APP_BASE_URL:-http://localhost:3000}` に（iqe2e でメールリンク基点を 3100 にするため・sc-00 メール系 e2e 用）。
7. **検証**＝iqe2e スタックで**2回連続 full green**を確認（決定性）。green なら main へマージ（別セッションの機能ブランチと `bootstrap.py` が競合し得る＝§取り決め md のマージ順）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（シェル cd 不持続）。compose＝`impl/compose.yaml`。
- **通常起動（本トラックのデフォルト or 既定スタック）**＝`cd impl && docker compose up -d --build`。e2e は **worker/mail-worker 起動必須**（`docker compose up -d worker mail-worker`／sc-00 OTP・再設定メール・ディレクトリミラーが依存）。
- **別 compose プロジェクトで隔離起動（並行作業時・取り決め md §4）**＝
  `export COMPOSE_PROJECT_NAME=iqe2e FRONTEND_PORT=3100 BACKEND_PORT=8100 DB_PORT=5533 REDIS_PORT=6380 MAILHOG_SMTP_PORT=1125 MAILHOG_UI_PORT=8125 MINIO_PORT=9100 MINIO_CONSOLE_PORT=9101 MINIO_PUBLIC_ENDPOINT=localhost:9100 APP_BASE_URL=http://localhost:3100 PLAYWRIGHT_BASE_URL=http://localhost:3100` → `cd impl && docker compose --profile workers up -d --build`。
- **backend pytest（クリーンDB切り分け）**＝ワーカ停止 `docker compose stop worker mail-worker llm-worker` → `docker compose exec -T db psql -U ideaquest -d postgres -c "DROP DATABASE IF EXISTS ideaquest_company_acme WITH (FORCE);"`（acme2 も）→ `docker compose run --rm -T -v "$PWD/backend:/app" backend pytest -q`（cwd=impl・未コミット編集を反映）。全テストは FakeEmbeddings＋FakeChat 固定（conftest autouse）。**pyt e2e の前にワーカを戻す**（`docker compose up -d worker mail-worker`）。
- **frontend 検証**＝`cd impl/frontend && npm run build`（tsc/lint・必須）・`npx vitest run`。e2e＝`npx playwright test --project=chromium`（**本体 exit code を見る・パイプ禁止**）。トリアージは `--workers=1` で単独/少数。結果は `test-results/.last-run.json`（`status`/`failedTests`）でも確認可。**e2e は実行のたび会社DBを drop→bootstrap する**（`db.reset.ts`・既定スタックで回すと手動投入データが消える）。
- **e2e seed（bootstrap が作る・方式A で毎回再現）**＝ACME-01 の `user@acme`（member・storageState 既定）/`user2@acme`/`user3@acme`/`kanri@acme`（company_account_admin）＋デモグループ `DEV-DEMO`＋発見デモ/情報デモ。`mfa@acme2`（ACME-02）。OPS 管理者 `admin@ops`（system_admin）。全 PW `Passw0rd!`。
- **新 DTO**＝backend 再ビルド→`cd impl/frontend && npm run codegen`（`http://localhost:8000/openapi.json`→`src/lib/api/schema.d.ts`）→frontend ビルド。
- **ポート（既定）**＝frontend 3000／backend 8000／db 5432／MailHog 8025／MinIO 9000／Ollama 11434（profile ai）。
- **TC トレーサビリティ**＝リポジトリ直下 `python3 scripts/check_tc_traceability.py`（コミット前ゲート・一意性は見ない）。
- **company migration head**＝`0048_ai_jobs`（次は 0049）。
