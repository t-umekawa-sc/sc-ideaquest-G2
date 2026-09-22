# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-22 JST**
- ブランチ: **main**（作業ツリー clean・`origin/main` と同期＝push 済）。
- 最新コミット（新→古）: **`9d41c38`** `feat(logging): 本番向けシステムログ基盤` → **`2047e05`** `feat(info detail): 未保存破棄確認を全経路に＋無変更保存は閉じて通知` → `4a28afc`（前セッションの handoff）。
- 本セッションのコミット列（古→新・すべて push 済）: `2047e05`（情報詳細の破棄確認スライス）→ `9d41c38`（システムログ基盤スライス）。
- コミット方針: ユーザーが「コミットして/プッシュして」と言うまでコミットしない。**1スライス=1コミット**。末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..N・画面 SC-xx）。本セッションは**①情報詳細ダイアログの未保存破棄確認（SC-50 §78）**と**②本番向けシステムログのファイル記録**の2機能を実装・コミット・push した。

## 3. 今回やったこと（変更ファイルと理由）

### A. 情報詳細＝未保存で閉じる時の破棄確認を全経路に＋無変更保存は閉じて通知（`2047e05`）
- **要件**＝SC-50 §78「未保存で閉じる時は破棄確認（dirty 時のみ）」。ユーザー決定＝**保存ボタンは常時活性**（dirty ゲートしない＝なぜ押せないか分かりにくい）／**無変更で保存したら版を増やさず閉じてから通知**（アイデア D.3 と統一）。破棄確認は**footer「閉じる」・背景クリック・Esc・× の全経路**（footer だけだとステージした参考資料/編集が黙って破棄される）。
- **実装**＝`components/ui/RouteModal.tsx` に `beforeClose?` を追加（背景/Esc/× のガード・子に渡す `close` はガード無し＝保存成功用）。`info-input/components/InfoDetailModal.tsx` が dirty を集約し `useConfirm` で破棄確認（standalone Modal / intercept RouteModal 両対応）。`InfoDetailView.tsx` は `onRequestClose`（footer 用ガード）/`onDirtyChange`（dirty 通知）を受け、無変更保存は `onClose()` で閉じてから snackbar。
- **設計更新**＝`doc/画面設計/screens/SC-50_情報インプット.md §78` を確定挙動へ。
- **回帰**＝e2e `impl/frontend/e2e/sc-52-info-detail-close.spec.ts`（**N-TC-206/207**・台帳 `doc/テスト/N_情報インプット.md §3.1`）。**red 目視→実装→green**。テストは作った情報を DELETE API で**後始末**する（放置すると created_at 降順で seed 行を押し出し他 e2e〔N-TC-203 等〕を壊す＝実際に踏んだので対策済）。

### B. 本番向けシステムログ基盤（`9d41c38`）
- **目的**＝本番の問題/データ不整合を後から解析できる十分なログをファイル記録（ユーザー依頼）。
- **形式**＝JSONL（1行1 JSON）。全ログに `request_id`（X-Request-ID と一致）・`actor`(account_id)・`tenant`(会社DB識別子)・`ip`/`ua` を**自動相関注入**。秘匿(PW/token/session/otp/csrf 等)は**キー名でマスク**（§15・実機で password 漏洩0件を確認）。
- **収録（full）**＝①アクセスログ（全 HTTP・status/所要ms・`/healthz` 除外）②AppError/未捕捉例外（request_id 付きスタック・画面には出さない・§14）③データ変更（audit.record・outbox worker の各パス）。冗長な httpx 等は WARNING 抑制。
- **ファイル/保持**＝stdout＋`LOG_DIR/<service>.jsonl`(+`<service>.error.jsonl`＝WARNING以上)。service＝backend/worker/mail-worker。**日次ローテーション・前日分 gzip・保持 `LOG_RETENTION_DAYS`(既定30・env)**。dir 書込不可時は stdout フォールバック。
- **入口/新規**＝`app/core/logging_config.py`（configure_logging/JsonFormatter/ContextFilter/DailyGzipTimedRotatingFileHandler/log_mutation）・`app/core/log_context.py`（request_id/tenant contextvar・新規）。改修＝`main.py`(configure＋request_id contextvar)・`audit_context.py`(アクセスログ)・`errors.py`(ログ＋catch-all Exception→internal_error)・`worker.py`/`mail_worker.py`(configure＋構造化)・`db/tenant.py`(tenant 注入)・`audit/repository.py`(log_mutation 併記)・`config.py`(LOG_* settings)。`compose.yaml`(LOG_* env＋`./logs:/var/log/ideaquest` バインドマウント×3)・`.gitignore`(impl/logs/)。
- **正本/テスト**＝`doc/本番デプロイ要件.md §6.6`（新設）・**新ドメイン O**＝`doc/テスト/O_システムログ.md`（O-TC-001..006・トレーサビリティ regex は英字1文字プレフィクスなので多文字不可）。テスト＝`impl/backend/tests/core/test_logging.py`。後追い red は `doc/テスト/red確認台帳.md` に O-TC-003/005 を記録。

## 4. 現在の状態（本セッションで実行・確認）
- **frontend**: `npm run build` = Compiled successfully（破棄確認スライス）。e2e `sc-52-info-detail-close`（N-TC-206/207）＝**2 passed**。回帰 `sc-50-info-list`(N-TC-202/203)・`sc-99-modal-backdrop`＝pass。
- **backend**: `tests/core/test_logging.py` = **6 passed**（O-TC・red は反転手技で 2件目視→復元）。**フルスイート** = 714 passed / 2 failed。
  - 2 failed＝`tests/admin/test_admin_quest_groups.py::test_b_tc_083b/083c`＝**私の変更と無関係の既存フレーク**（メモリ `admin-directory-tests-flaky`）。単体では pass・baseline stash でも 083c は fail。原因＝fixture `qg.new_account()` がアカウント/会社DB users を teardown で消さず永続DBに累積（ACME=55件）＋company-directory がページング（offset/limit）で対象が1ページ目から溢れる。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅ **716件**。
- **実機スモーク**＝backend/worker/mail-worker を最新コードで再ビルド起動。login/404 で `impl/logs/*.jsonl` に相関付き JSON・password 漏洩0・httpx ノイズ抑制・worker/mail-worker も各ファイル出力を確認。
- **稼働コンテナ**＝backend/db/redis/mailhog/minio/frontend/**worker/mail-worker とも Up**（今は workers も起動中＝pytest を回すなら先に `docker compose stop worker mail-worker`）。
- **壊れているもの**＝認識範囲で無し（上記 admin 2件は既存フレーク）。

## 5. 詰まっている点 / 未確認 / 未修正の既知漏れ
- **未確認（本セッションで未実施）**＝frontend の**全** vitest／**Playwright 全 e2e**／本セッション各修正の**ブラウザ実機受入**（コード/自動テストは green だがブラウザ確認は次回ゲート）。
- **既存フレーク（別タスク）**＝admin company-directory テスト（B-TC-083b/083c）。恒久対処＝fixture の teardown でアカウント物理削除 or per_page 拡大 or テスト専用会社で隔離（メモリ `admin-directory-tests-flaky`）。**新規リグレッションではない**。
- **システムログのフェーズ2（TODO・§6.6 に明記）**＝①長期アーカイブのオブジェクトストレージ移送（§6.5 と統合・WORM）②集約基盤（CloudWatch/ELK/Loki）転送・保持・アラート③異常検知（大量4xx/5xx・不審ログイン）と通知先/対応手順。
- **前セッション由来の SC-50 既知漏れ**＝⑥作成者モードで要約 read 非表示（§79「要約は全モード共通」・意図か要確認）／⑦一覧⋯「リンクを編集」項目が無い（実害小）。※⑤ dirty 破棄確認は**本セッションで解消**。
- **ツール上の詰まり**＝ルート直の Bash で `cd impl/frontend` を挟むと以降 cwd がずれることがある（絶対パスで `cd` する）。Edit がテンプレートリテラル/全角特殊行を外すことがある→ perl/Python 置換。テスト seed の FK 違反は依存順に `ts.flush()`。

## 6. 決定事項と根拠（不採用案も）
- **破棄確認は全閉じ経路**（footer だけでなく背景/Esc/×）＝ステージ添付/編集の黙殺破棄を防ぐ。RouteModal に汎用 `beforeClose` を足して実現（子の `close` はガード無し＝保存成功用）。不採用=footer のみ（穴が残る）。
- **保存ボタンは常時活性・無変更保存は閉じて通知**（§78 の「dirty時のみ活性」を上書き）＝押せない理由が分かりにくいため。アイデア D.3 と統一。
- **システムログ＝JSONL・request_id/tenant 相関・日次gzip・保持 env 既定30日**（ユーザー選択）。dev は `impl/logs` バインドマウント（消えて可）/prod は永続ボリューム必須。長期/集約/異常検知はフェーズ2。
- **観測性テストは新ドメイン O**（英字1文字プレフィクス制約のため `LOG-` 不可）。
- **admin フレークは本タスクで直さない**（スコープ外・別タスク起票が妥当）。

## 7. 次にやること（優先順・具体的に）
1. **本セッション2機能のブラウザ実機受入**＝`http://localhost:3000`。①情報詳細で編集して閉じる→破棄確認（背景/Esc/× も）→「編集に戻る/破棄して閉じる」②無変更保存で閉じて「変更はありません」通知。ログは `impl/logs/backend.jsonl` を tail して JSON を目視。
2. **（任意）admin フレークの恒久対処**＝`tests/admin/test_admin_quest_groups.py` の fixture teardown でアカウント削除、または directory per_page 拡大（メモリ `admin-directory-tests-flaky`）。
3. **システムログ フェーズ2**（§6.6 TODO）＝集約基盤転送/長期アーカイブ/異常検知。着手時は本番デプロイ要件 §6.5/§6.6 と突合。
4. **前セッション由来の残**＝SC-50 ⑥要約 read の表示条件（§79 解釈をユーザー確認）／メモリ `internal-review-remaining-items`（評価ダイアログにクエスト情報・クエスト最終結果）／反証の要再評価フラグ（§3.5）／コンセプト機能設計（メモリ `concept-feature-design-split`・`fr39-iso-mapping-superseded`）。`doc/実装計画.md` で次ドメイン確認。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。compose=**`impl/compose.yaml`**（`docker-compose.yml` は無い＝罠）。docker は **cwd=`impl/`**。
- **起動**: `cd impl && docker compose up -d`。コード反映＝**`docker compose up -d --build backend`**（backend はソースをベイク＝ボリューム無・メモリ `backend-no-source-mount`）。frontend も `--build`。schema/DTO 変更後は `cd impl/frontend && npm run codegen`。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=**`/healthz`**〔`/api/v1/health` は無い＝旧 handoff の誤り〕）/ db 5432 / redis 6379 / minio 9000・9001 / mailhog 1025・8025。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` で未コミット変更も反映）。**pytest 前に `docker compose stop worker mail-worker`**（共有 control DB の *_outbox 競合回避）→終わったら start。※`docker compose run backend` は logs ボリュームも継承するため**テスト実行が `impl/logs/*.jsonl` に書き込む**（gitignore・無害）。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート＝Next lint 含む）／`npx vitest run <path>`（node 環境・純関数のみ・UI は e2e）／`npx playwright test e2e/<spec>`（フルスタック起動が前提）。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（現在 716件）。
- **システムログ**: 出力先 `impl/logs/`（gitignore・root 所有＝ホストから rm 不可→ `docker compose run --rm --no-deps -v "$(pwd)/logs:/logs" backend sh -c 'rm -f /logs/*.jsonl'`）。env は compose の `&backend_env`（LOG_LEVEL/LOG_FORMAT/LOG_TO_FILE/LOG_DIR/LOG_RETENTION_DAYS/LOG_UTC）。
- **ログイン（再確認済）**: `user@acme.example`/`ACME-01`/`Passw0rd!`＝一般。`kanri@acme.example`/`ACME-01`/`Passw0rd!`＝company_account_admin。`admin@ops.example`/`OPS`/`Passw0rd!`＝system_admin。認証は Cookie セッション。状態変更 API は `iq_csrf` Cookie を `X-CSRF-Token` に載せる（curl 検証時は cookie jar から取り出す・403 csrf_failed 回避）。
- **DB 直接確認**: `docker compose exec -T db psql -U ideaquest -d <dbname> ...`（user/pw=ideaquest）。DB 名=control=`ideaquest_control`／ops=`ideaquest_ops`／ACME=`ideaquest_company_acme`／ACME2=`ideaquest_company_acme2`／システムコンシェルジュ=`db_systemcon`（会社ごと命名規則が違う＝罠。会社詳細のバナー「DB:」で確認）。
- **設計正本**: `CLAUDE.md`（毎回自動ロード）から各規約・正本へ。ドメイン設計=`doc/API設計/{A..N}_*.md`・画面=`doc/画面設計/screens/SC-xx_*.md`・データモデル=`doc/データモデル.md`・テスト台帳=`doc/テスト/*.md`。メモリ index=`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/MEMORY.md`。

---
### 自己チェック（本ファイルだけで再開できるか）
- 起動/再ビルド/テスト（-v＋worker 停止・logs ボリュームの副作用）/ログイン（Cookie+CSRF）/ポート（health=/healthz）/DB名の会社別命名の罠/compose ファイル名の罠=記載済。
- 本セッションの2スライス（破棄確認・システムログ）＝対応ファイル/関数/テストID/コミット付きで記載。
- 未確認（全 vitest/e2e/ブラウザ受入）と既存フレーク（admin 2件・私の変更外）、フェーズ2 TODO、前セッション残＝明記。
- 次アクションはファイル/関数レベルまで具体化。
