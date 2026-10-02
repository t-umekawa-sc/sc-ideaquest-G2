# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/規約/テスト規約.md §4.1`（e2e 方針）／`doc/セッション調整/並行開発の取り決め.md`（2トラック並行＋iqe2e 起動 env の正本）。
> **体制**＝2トラック。**本トラック＝テストコード改修（e2e 信頼性基盤）**／**別セッション＝機能実装**。並行時は取り決め md を必読。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-10-02（P2＝control-plane @serial 完了・フル N=7 実測 0 failed・P4 規約明文化まで）
- ブランチ: `main`（作業ツリー clean）。本セッションのコミットは push 済み。
- 最新コミット（新しい順）:
  - `36e4faac` docs(規約): テスト規約 §4.2「2系統モデル」を新設（P4）
  - `fc7a9bec` test(e2e): control-plane 9本を会社数非依存に硬化＋フルN=7実測を handoff 反映
  - `fdd1eecc` test(e2e): P2 着手＝control-plane 14本に @serial タグ＋2パス scripts
  - `502cfdfb` docs(handoff): 前セッション末（helpers.ts 新設＋会社スコープ43本集約）
  - `c20fc030` test(e2e): P3 段階移行＝会社スコープ残り23本を helpers へ集約
- iqe2e スタックは本 handoff 時点で **N=7 で起動したまま**（撤去する場合は §8 の `down -v`）。worktree は未使用（main 直接作業）。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発をゲーム感UIで一気通貫。本トラックの本命＝**肥大化しても安定する e2e テスト基盤の確立**（2系統モデル＝§6）。

## 3. 今回やったこと（変更とその理由）
2系統モデルの横断層＝**共有ヘルパ `impl/frontend/e2e/helpers.ts` を新設し、会社スコープ spec 43本の重複実装を helpers へ集約**した（§6 の P1・P3）。目的＝各 spec に散った `psql`/`csrfOf`/`createRecruiting`/`login` 等の重複を一本化し、個別 spec を1本ずつ硬化し続ける whack-a-mole を根治する。

### (A) helpers.ts 新設（`b6f2b383`）
- `impl/frontend/e2e/helpers.ts` に以下を集約（export 関数）:
  - 認証＝`gotoAuthed(page)`（storageState 前提で `/` へ＋`.app-header` 可視）／`formLogin(page, {company,loginId,password})`（フォーム実ログイン・SC-00/別アカウント用）。
  - CSRF/HTTP＝`csrfToken(page)`（iq_csrf cookie 抽出）／`csrfHeaders(page)`（CSRF+JSON ヘッダ）。
  - 会社DB＝`psql(db, sql)`／`psqlValue(db, sql)`（`docker compose exec db psql`・`IMPL_DIR` 内包）。db は fixtures の `workerCompany.dbName` を渡す。
  - ドメイン生成＝`createRecruiting(page, title, opts?)`（opts＝categories/questGroupIds/status/deadline/purpose。既定値付き＝案B）／`createPublishedIdea(page, questId, stamp)`（title は固定「評価アイデア_」）／`createInfoItem(page, title)`。
  - DataTable assertion＝`expectListCount(region, n)`（`tbody tr` 行数）／`expectRowVisible(region, name)`／`expectSearchCleared(region)`（`.list-count` 多重一致を回避）。
- 設計＝**案B（既定値付き opts）**を採用（§6）。呼び出しの見た目は最頻ケースで最短（引数なし）、変種は opts で吸収しローカル再実装の復活を防ぐ。

### (B) 会社スコープ spec 43本を helpers へ移行（`b6f2b383`/`8dc6194e`/`f6725ec4`/`c20fc030`）
- `login(page)`（storageState の goto型）→ `gotoAuthed`、`csrfOf(...)` → `csrfToken`、`psql`/ドメイン生成 → helpers。死んだ `USER`/`CREDS` 定数・未使用 `type Page` import を除去。
- spec 固有の生成/操作（`patchIdea`/`transition`/`setGameOverride`/`createIdeaApi`[status付き]/`createIdeaWithAttachment`/`deleteInfoItem`/`seedInfoWithLinks` 等）は残しつつ、csrf は `csrfHeaders`/`csrfToken` 経由に統一。
- 変種の保持例＝`sc-24-chat` は会社全体クエスト（`createRecruiting(..., { questGroupIds: [] })`）＋タイトル検証のため `createPublishedIdea` のみローカル温存（title「チャットアイデア_」）。`loginAs`→`formLogin`。
- `sc-22-quest-ref` は categories を helpers 既定（`["業務改善"]`）に寄せて positional 引数を除去。

## 4. 現在の状態
- **移行済み＝会社スコープ 43本**（helpers 集約・前セッション）＋**P2＝control-plane 14本に @serial 付与・会社数脆弱性9本を硬化（本セッション 2026-10-02）**。
- **フル e2e N=7 実測済み（本セッション・iqe2e スタック N=7・2パス）＝ハード失敗 0**:
  - **bulk パス**（会社スコープ 118本・workers=7・`npm run e2e:bulk`）＝**113 passed / 5 flaky / 0 failed**。flaky5＝既知タイミング（sc-03-images/sc-18-loading/D-TC-215/sc-12-quest-detail/sc-50-info-to-quest-draft・retry 吸収）。
  - **control パス**（@serial 43本・workers=1・`npm run e2e:control`・`MAILHOG_URL=:8125` 必須）＝**45 passed / 1 flaky / 0 failed**。flaky1＝B-TC-115（§7-P5 既知の編集反映タイミング・retry 吸収）。
  - **合計＝158 passed / 6 flaky / 0 failed**。前回フル N=7（12 failed/5 flaky/144 passed）→ **0 failed に到達**（control-plane の並列競合を @serial 直列化で解消＋per_page 脆弱性を硬化）。
  - `npx playwright test --list` ＝exit 0・161 tests / 60 files（@serial 43／会社スコープ 118 に分離・@serial を含む spec はちょうど14本）。
- **per_page 脆弱性の硬化（本セッション）**＝SC-91 会社一覧は初期 `per_page=5`。会社数が増える（N=7＝9社）と OPS 系テストが前提する「ACME-01 が無絞りの先頭ページにいる」が崩れる（backend 既定ソート＝`created_at, id`・タイブレーク依存）。対象9本（sc-91 B-TC-110／sc-92b 114,125／sc-92b2 115,178／sc-92c 116,117,179／sc-92d 169）に ACME-01 の `searchbox.fill` を前置して N 非依存化（手法は同spec B-TC-139 と同じ）。
- **壊れているもの＝無し**。残フレークは全て既知タイミングで retry 吸収（恒久対策は §7-P5）。
- **未確認（次回要再検証）**:
  - **backend pytest は本セッション未実行**（前回907 passed）。今回の変更は e2e テストコードのみ＝backend 無関係のはずだが未確認。
  - **frontend vitest は本セッション未実行**（前回218 passed）。
  - **tsc は e2e を型検査していない**（§5 の学び）。本セッションで `npx tsc --noEmit` は `src/features/info-input/api.test.ts`・`src/features/quests/joinRequests.api.test.ts` の2件で既に赤（feature track の既存エラー・本トラック変更外・未修正）。

## 5. 詰まっている点（試して失敗した / なぜ）
- **e2e の import 漏れはコンパイルで検知できない**＝e2e ディレクトリは `tsconfig.json` の型検査対象外、`playwright test --list` は transpile のみで型検査しない。実際、移行途中で `csrfToken is not defined`（import し忘れ）が `--list` も `tsc` も通過し、実機 run で初めて露見（10 failed → import 追加で解消）。
  - **対策＝移行後は必ず「静的 import ガード grep」＋「対象 spec の実機 run」をセットで回す**。ガード＝「helpers の関数名が `name(` で呼ばれているのに `import {...} from "./helpers"` に無い」を検出する bash ループ（本セッションで毎バッチ実行）。注意＝spec にローカル同名関数がある場合（例 sc-24-chat の `createPublishedIdea`）は false positive になるのでローカル定義の有無で判断する。
- **既存フレーク2件（移行起因でない・密集バッチ限定）**:
  - `D-TC-215`（sc-22-attachments・添付アップロード→投稿後ナビ）＝8本×3worker 密集で投稿ナビの 5s `toHaveURL` timeout が負荷で trip。単体 run は移行前後とも green。失敗箇所は本移行が触れないアップロードフロー。
  - `M-TC-013`（sc-99-scroll-restore・スクロール復元）＝23本×3worker 密集で scroll 位置判定が trip。単体 run は green（4 passed）。本 spec の diff は login→gotoAuthed のみでスクロール測定に無関係。handoff §7.5（前版）に既知フレークとして記載あり。
  - ＝どちらも「密集バッチ特有の負荷タイミング」で、フル N=7 では各 spec が分散して通る見込み（前版では144 passed 側）。恒久対策は §7-P5。

## 6. 決定事項と根拠（採用しなかった案も）
- **2系統モデル（肥大化に耐える基盤）＝ユーザー合意済み**。本セッションで「仕様は検討中では？」の確認があり、2系統の大枠は合意・実装は横断層（helpers）と会社スコープ隔離が完了、control-plane の @serial は未着手、という状態で再確認済み。
  - **会社スコープ**（機能＝増加の主体）＝per-worker 会社DB隔離（`impl/frontend/e2e/fixtures.ts` の `workerCompany`・前セッションで実装済）＋helpers 集約（本セッション完了）＝新規は import だけで無償隔離・フル並列。
  - **control-plane/認証**（少数・増えにくい）＝`@serial` タグ→直列フェーズ（**未実装・§7-P2**）＝共有 admin@ops 競合を構造的に回避。
- **helpers の createRecruiting は案B（既定値付き opts）を採用**（採用しなかった案A＝固定デフォルトのみ）。理由＝案A は変種 spec（categories 指定の sc-22-quest-ref・会社全体の sc-24-chat）が helpers に乗らずローカル再実装の穴が残る。案B は呼び出しの見た目は案Aと同じまま変種も1箇所に集約でき、whack-a-mole 根治の目的に合致。ユーザーに案A/B の違いを説明し案B で合意。
- **control-plane spec を helpers 化しないで @serial に回す根拠**＝これらは会社スコープ外（OPS/admin の form login・`fixtures` 非使用）。性質が逆（会社スコープ＝発散／control-plane＝少数固定）なので別戦略が正しい。
- **前版§6 の不採用案（記録保持）**：①backend への test 専用 Cookie ルーティング＝セキュリティで却下（マルチテナント分離のバイパス面をセキュア critical なコードに常駐／ワーカはリクエスト文脈外で Cookie 不可）＝ユーザー判断NG。②ワーカごと丸ごと別スタック＝資源過大で費用対効果×。③ワーカ数低減で決定性＝実測で無効。

## 7. 次にやること（優先順・具体的に）
> いずれも iqe2e スタックで検証（§8）。着手前に `doc/セッション調整/並行開発の取り決め.md` を読む。
1. **P2＝control-plane/認証 spec に `@serial` タグ＋2パス実行**（本命・**実装完了＝2026-10-02**）。
   - 完了内容＝対象14本（`sc-90-quest-group-admin`・`sc-91-companies`・`sc-92-company-detail`・`sc-92b-accounts`・`sc-92b2-account-edit`・`sc-92c-quest-groups`・`sc-92d-email-verify`・`sc-93-own-accounts`・`sc-00-login`・`sc-00-mfa`・`sc-00-password-setup`・`sc-00-session-expiry`・`k-profile`・`sc-01-dashboard`）の全 `test()`/`test.describe()` 計44箇所に Playwright 1.49 の `{ tag: "@serial" }` を付与。`package.json` に `e2e:bulk`（`--grep-invert @serial`）／`e2e:control`（`--grep @serial --workers=1`）／`e2e:all`（bulk→control）を追加。
   - 検証済み（iqe2e・**N=7 フル2パス**）＝合計 **158 passed / 6 flaky / 0 failed**（§4 詳細）。`MAILHOG_URL=http://localhost:8125` 必須（未付与だと sc-00 メール2本が 8025 で ECONNREFUSED＝§8 に追記済）。per_page 脆弱性9本も硬化済み（§4）。
   - **P2 follow-up＝完了**＝control-plane 12本のローカル `login`/`loginAs` を全廃し `helpers.formLogin(page, creds)` に集約（creds＝各 spec の OPS/GENERAL/CREDS/USER/LOGOUT_ALL_CREDS 定数を opts で渡す）。未使用 `type Page` import も除去（csrfHeaders/createOwnedQuest を持つ sc-90/93/01 は保持）。net −113行。control パス実機＝46 passed / 0 failed で挙動不変を確認。残は sc-00-mfa/password-setup（ローカル login 無し・メール系ヘルパ別）。
2. ~~**P4＝テスト規約に 2系統モデルを明文化**~~ ＝**完了（`36e4faac`）**。`doc/規約/テスト規約.md §4.2` を新設（会社スコープ隔離／control-plane @serial・2パス運用・分類指針・static import ガード・per_page 非依存・既知フレーク）。
3. **P5＝残タイミングフレークの恒久対策（別件・費用対効果で判断）**＝`D-TC-215`（投稿後ナビの `toHaveURL` timeout を延長）・`M-TC-013`（scroll 判定の待ち強化）・`B-TC-115`（編集反映）・`sc-03-images`/`sc-18-loading`/`sc-12-quest-detail`/`sc-50-info-to-quest-draft`。現状は `retries:2` で吸収（N=7 フルで 6 flaky）。受容 or 個別硬化を判断。
4. **（節目タスク）backend pytest・frontend vitest の再実行**＝本セッション未実行（前回 907 / 218 passed）。今回の変更は e2e のみ＝無関係のはずだが節目で回す。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`。**コマンドは絶対パス**（シェル cd 不持続）。
- **通常起動（既定スタック・別セッションもこれ）**＝`cd impl && docker compose up -d --build`。e2e は worker/mail-worker 起動（`docker compose up -d worker mail-worker`）。**この既定スタックで e2e を回すと隔離は効かない（N=0 フォールバック＝ACME-01 共有）**。
- **iqe2e 隔離スタック（本トラックの e2e 検証＝隔離が効く・本セッションはこれで検証）**＝別 compose プロジェクトで起動（取り決め md §4 が正本）。本セッションは `E2E_WORKER_COMPANIES=3`（bootstrap を軽く）で回した。env:
  `export COMPOSE_PROJECT_NAME=iqe2e DB_PORT=5533 REDIS_PORT=6380 MAILHOG_SMTP_PORT=1125 MAILHOG_UI_PORT=8125 MINIO_PORT=9100 MINIO_CONSOLE_PORT=9101 BACKEND_PORT=8100 FRONTEND_PORT=3100 E2E_WORKER_COMPANIES=3 APP_BASE_URL=http://localhost:3100 MINIO_PUBLIC_ENDPOINT=localhost:9100 ALLOWED_ORIGINS='["http://localhost:3100","http://localhost:8100"]' LOGIN_RATE_LIMIT_MAX=100000`
  → `cd impl && docker compose --profile workers up -d --build`。**`LOGIN_RATE_LIMIT_MAX`（429回避）・`ALLOWED_ORIGINS`（:3100 の403回避）・`E2E_WORKER_COMPANIES`（workers と一致）は必須**。
  - 起動後は backend の bootstrap 完了（`docker compose logs backend | grep "[bootstrap] done"` と `Application startup complete`）を待ってから実行。bootstrap が ACME-01＋`ACME-W0..W{N-1}` を seed する。
  - e2e 実行＝`cd impl/frontend && COMPOSE_PROJECT_NAME=iqe2e PLAYWRIGHT_BASE_URL=http://localhost:3100 E2E_WORKER_COMPANIES=3 ALLOWED_ORIGINS='["http://localhost:3100","http://localhost:8100"]' LOGIN_RATE_LIMIT_MAX=100000 MAILHOG_URL=http://localhost:8125 npx playwright test --project=chromium [spec名...]`（reset が全会社DBを drop→bootstrap・auth.setup/cleanup が前後に走る）。
    - **`MAILHOG_URL=http://localhost:8125` は sc-00-mfa／sc-00-password-setup（メール/OTP 系・@serial）に必須**＝spec の既定は `http://localhost:8025`（既定スタックの MailHog UI）だが iqe2e は 8125 に割当（8025 は閉）。未指定だと両 spec が `ECONNREFUSED 127.0.0.1:8025` で落ちる（P2 で判明＝タグ起因でなく run recipe の欠落）。
  - **フル実測は `E2E_WORKER_COMPANIES=7`＋`workers=7`（playwright.config が N>0 で workers=N）で全spec**。N は backend の seed 数（compose の env）と一致必須。
  - 出力は ANSI 除去（`sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'`）してから grep。**パイプで exit code がマスクされるので本体 exit か "N failed" 行で判定**。トリアージは `--workers=1`。密集バッチ失敗は単体 run で負荷フレークか実バグか切り分ける（本セッションの D-TC-215/M-TC-013 の手法）。
  - 撤去＝`cd impl && COMPOSE_PROJECT_NAME=iqe2e docker compose --profile workers down -v`。
- **backend pytest（クリーンDB・N=0）**＝ワーカ停止→会社DB drop（`docker compose exec -T db psql -U ideaquest -d postgres -c "DROP DATABASE IF EXISTS ideaquest_company_acme WITH (FORCE);"`・acme2 も）→`docker compose run --rm -T -v "$PWD/backend:/app" backend pytest -q`（cwd=impl）。**pytest 後はワーカを戻す**。iqe2e の DB で回すなら `-e E2E_WORKER_COMPANIES=0` 明示＋全DB drop 推奨。
- **frontend 検証**＝`cd impl/frontend && npm run build`（Next lint/tsc・src 側）・`npx vitest run`。**e2e spec は `tsc` 対象外**なので import 漏れ検知は §5 の static ガード＋実機 run に頼る。e2e のコンパイル確認は `npx playwright test --project=chromium --list`（スタック不要）。
- **helpers 集約の静的 import ガード（移行時に必ず実行）**＝`impl/frontend/e2e/` で各 spec について「helpers 関数名が `name(` で呼ばれているのに `import {...} from "./helpers"` に含まれない」を検出する bash ループ。ローカル同名関数（sc-24-chat の createPublishedIdea 等）は false positive なので除外判断する。
- **seed（方式Aで毎回再現）**＝ACME-01: `user@acme`(member)/`user2`/`user3`/`kanri`(company_account_admin)/`e2e-session`/`e2e-pwreset`＋`DEV-DEMO`グループ＋発見/情報デモ。N>0 なら `ACME-W0..` にも同一 login_id 群＋デモ一式。`mfa@acme2`(ACME-02)。OPS `admin@ops`(system_admin)。全 PW `Passw0rd!`。login_id は会社単位一意（`uq_accounts_company_login`）なので全ワーカ会社で同じ `user@acme.example` を使う。
- **ポート（既定）**＝front 3000／back 8000／db 5432。iqe2e＝3100/8100/5533/6380/8125/9100。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py`（コミット前ゲート・本セッションは移行のみで新規TC無し・927件 OK）。company migration head＝`0048_ai_jobs`（次 0049）。
