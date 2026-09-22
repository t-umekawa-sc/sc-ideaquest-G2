# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-22 JST**
- ブランチ: **main**（作業ツリー clean・`origin/main` と同期＝全 push 済）。
- 最新コミット（新→古）: **`4d9a01d`** `feat(questgroups): グループ名の無変更保存に info トースト` → `17e3f7d` `feat(forms): 無変更保存 QuestForm/EvaluationView` → `f72b6e9` `feat(forms): 無変更保存 ProfileForm/AccountFormPanel` → `126458f` `docs(handoff)` → `9d41c38` `feat(logging): システムログ基盤` → `2047e05` `feat(info detail): 破棄確認+無変更保存で閉じて通知`。
- 本セッションのコミット列（古→新・すべて push 済）: `2047e05`（情報詳細の破棄確認）→ `9d41c38`（システムログ基盤）→ `126458f`（handoff）→ `f72b6e9`→`17e3f7d`→`4d9a01d`（無変更保存の全フォーム統一）。
- コミット方針: ユーザーが「コミットして/プッシュして」と言うまで実行しない。**1スライス=1コミット**。末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..N・画面 SC-xx）。実装は `impl/`。

## 3. 今回やったこと（変更ファイルと理由）

### A. 情報詳細＝未保存で閉じる時の破棄確認を全経路に＋無変更保存は閉じて通知（`2047e05`）
- 要件＝SC-50 §78。破棄確認は **footer「閉じる」・背景クリック・Esc・× の全経路**（footer だけだとステージした参考資料/編集が黙って破棄される）。無変更保存は**版を増やさず閉じてから info 通知**（アイデア D.3 と統一）。
- 実装＝`components/ui/RouteModal.tsx` に `beforeClose?` 追加（背景/Esc/× ガード・子の `close` はガード無し＝保存成功用）。`info-input/components/InfoDetailModal.tsx` が dirty を集約し `useConfirm` で破棄確認（standalone Modal / intercept RouteModal 両対応）。`InfoDetailView.tsx` は `onRequestClose`（footer 用ガード）/`onDirtyChange`（dirty 通知）を受け、無変更保存は `onClose()`＋snack。設計＝`doc/画面設計/screens/SC-50_情報インプット.md §78` 更新。回帰 e2e＝`impl/frontend/e2e/sc-52-info-detail-close.spec.ts`（**N-TC-206/207**・台帳 N §3.1）。**テストは作った情報を DELETE で後始末**（放置すると created_at 降順で seed 行を押し出し他 e2e を壊す＝実際に踏んだ）。

### B. 本番向けシステムログ基盤（`9d41c38`）
- 目的＝本番の問題/データ不整合を後から解析できる十分なログをファイル記録（ユーザー依頼）。
- 形式＝**JSONL**。全ログに `request_id`（X-Request-ID と一致）・`actor`(account_id)・`tenant`(会社DB識別子)・`ip`/`ua` を**自動相関注入**。秘匿(PW/token/session/otp/csrf 等)は**キー名でマスク**（実機で password 漏洩0を確認）。
- 収録＝①アクセスログ（全 HTTP・status/所要ms・`/healthz` 除外）②AppError/未捕捉例外（request_id 付きスタック・画面には出さない）③データ変更（audit.record・outbox worker）。冗長な httpx 等は WARNING 抑制。
- ファイル＝stdout＋`LOG_DIR/<service>.jsonl`(+`<service>.error.jsonl`)。service＝backend/worker/mail-worker。**日次ローテーション・前日分 gzip・保持 `LOG_RETENTION_DAYS`(既定30・env)**。dir 書込不可時は stdout フォールバック。
- 新規＝`impl/backend/app/core/logging_config.py`（configure_logging/JsonFormatter/ContextFilter/DailyGzipTimedRotatingFileHandler/log_mutation）・`app/core/log_context.py`（request_id/tenant contextvar）。改修＝`main.py`(configure＋request_id contextvar)・`core/audit_context.py`(アクセスログ)・`core/errors.py`(ログ＋catch-all Exception→internal_error)・`worker.py`/`mail_worker.py`(configure＋構造化)・`db/tenant.py`(tenant 注入)・`control_plane/audit/repository.py`(log_mutation 併記)・`core/config.py`(LOG_* settings)。`impl/compose.yaml`(LOG_* env＋`./logs:/var/log/ideaquest` ×3)・`.gitignore`(impl/logs/)。
- 正本＝`doc/本番デプロイ要件.md §6.6`（新設）。テスト＝**新ドメイン O**（`doc/テスト/O_システムログ.md`・O-TC-001..006／トレーサビリティ regex は**英字1文字プレフィクス**なので多文字 `LOG-` 等は不可）。実装＝`impl/backend/tests/core/test_logging.py`。後追い red は `doc/テスト/red確認台帳.md` に O-TC-003/005 記録。

### C. 無変更保存の全フォーム統一（保存ボタン統一・デザイン標準 §14）（`f72b6e9`/`17e3f7d`/`4d9a01d`）
- 標準＝「無変更で保存を押したら API を呼ばず版を増やさず、閉じてから（ページ内フォームは閉じずに）`info`「変更はありません」を通知」。基準実装＝`IdeaForm`／`InfoDetailView`。§14 が名指しした逸脱フォームを是正した。
- **ProfileForm**（`f72b6e9`）＝読込時スナップショットと比較・無変更なら PATCH /me を呼ばず info。回帰 e2e **K-TC-026**（`e2e/k-profile.spec.ts`）。
- **AccountFormPanel 編集**（`f72b6e9`）＝identity＋所属集合（置き換え時のみ）を基準と比較・無変更なら PATCH を呼ばず info＋閉じる（発行=新規は対象外）。回帰 e2e **B-TC-178**（`e2e/sc-92b2-account-edit.spec.ts`＝既存 seed を無編集保存＝mutation なし）。
- **QuestForm 編集**（`17e3f7d`）＝内容シグネチャ（`questContentSig`＝title/color/categories/deadline/purpose/参加部署/discoverable/members＋アイコン）を比較・edit-save で無変更なら updateQuest を呼ばず info（発行/公開/パーティーは対象外）。回帰 e2e **C-TC-284**（`e2e/sc-11-quest-create-modal.spec.ts`）。
- **EvaluationView 再確定/再保存**（`17e3f7d`）＝既存評価の状態＋内容シグネチャ（`evalSig`）を比較・同状態同内容なら putEvaluation を呼ばず info（draft→submitted 等の状態遷移は対象外）。回帰 e2e **F-TC-210**（`e2e/sc-25-eval.spec.ts`）。
- **QuestGroupSection リネーム**（`4d9a01d`）＝無変更時は元々 API 抑制済みだが「無音」だったので `onEditSubmit` の else 分岐に info トースト追加。回帰 e2e **B-TC-179**（`e2e/sc-92c-quest-groups.spec.ts`）。
- 設計＝`doc/画面設計/デザイン標準.md §14` の適用状況を「全編集フォーム是正済み」に更新。

## 4. 現在の状態（本セッションで実行・確認）
- **frontend**: `npm run build`（host・必須ゲート）＝各スライスで Compiled successfully。新 e2e **N-TC-206/207・K-TC-026・B-TC-178・C-TC-284・F-TC-210・B-TC-179 は red 目視→green**。回帰＝`sc-50-info-list`(N-TC-202/203)・`sc-99-modal-backdrop`・`sc-25`(14件)・`sc-11`・`k-profile`(K-TC-006)＝green（B-TC-115 の初回落ちは既存フレーク・再実行で pass）。
- **backend**: `tests/core/test_logging.py`＝6 passed。**フルスイート**＝714 passed / **2 failed**＝`tests/admin/test_admin_quest_groups.py::test_b_tc_083b/083c`（**私の変更と無関係の既存フレーク**・後述 §5）。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅ **721件**。
- **実機スモーク**（システムログ）＝backend/worker/mail-worker を最新コードで再ビルド起動し login/404 で `impl/logs/*.jsonl` に相関付き JSON・password 漏洩0・httpx ノイズ抑制・各 service ファイル出力を確認。
- **稼働コンテナ**＝backend/db/redis/mailhog/minio/frontend/**worker/mail-worker とも Up**（pytest を回すなら先に `docker compose stop worker mail-worker`）。
- **壊れているもの**＝認識範囲で無し（admin 2件は既存フレーク＝リグレッションではない）。

## 5. 詰まっている点 / 試して失敗したこと / 未確認
- **e2e のデータ蓄積フレーク（重要・繰り返し踏んだ）**＝`qg.new_account()`／クエスト/情報/クエストグループ作成系の e2e・pytest が**永続 DB（db_data volume）にテストデータを残す**。ACME で users=55件・quest_groups=32件まで累積し、`company-directory`/クエストグループ一覧が**ページング＋描画重で timeout/行溢れ**し、`test_b_tc_083b/083c`（backend フル実行時）や `B-TC-116/179`（e2e）が落ちた。
  - **失敗したアプローチ**＝落ちた e2e をそのまま再実行（環境が重いままなので再発）。
  - **有効だった対処**＝(1) 単体/少数実行で切り分け（単体では pass）(2) 空の test-prefix データを掃除。実施済＝ACME の空クエストグループ（QG/QGN/SCDEV）を DB 直削除（32→7）／情報アイテムのテスト行は DELETE API で掃除。**恒久対処は未実施**（§7-2）。
  - 参考メモリ＝`admin-directory-tests-flaky`。
- **未確認**＝frontend の**全** vitest／**Playwright 全 e2e 一括**／本セッション各修正の**ブラウザ実機受入**（コード/自動テストは green だがブラウザ確認は次回ゲート）。
- **システムログのフェーズ2（§6.6 に TODO 明記・未実装）**＝①長期アーカイブのオブジェクトストレージ移送（§6.5 と統合・WORM）②集約基盤（CloudWatch/ELK/Loki）転送・保持・アラート③異常検知（大量4xx/5xx・不審ログイン）と通知先/対応手順。

## 6. 決定事項と根拠（不採用案も）
- **破棄確認は全閉じ経路**（footer＋背景/Esc/×）＝黙殺破棄を防ぐ。RouteModal に汎用 `beforeClose` を足して実現（子の `close` はガード無し＝保存成功用）。不採用=footer のみ（穴が残る）。
- **保存ボタンは常時活性・無変更は API 抑制＋info「変更はありません」**（§14）＝dirty ゲートで無効化すると「なぜ押せないか」不親切。全編集フォームへ横展開（ProfileForm/AccountFormPanel/QuestForm/EvaluationView/QuestGroupSection）。状態遷移（draft→submit・edit-publish 等）は「変更あり」＝対象外。
- **システムログ＝JSONL・request_id/tenant 相関・日次gzip・保持 env 既定30日**（ユーザー選択）。dev は `impl/logs` バインドマウント（消えて可）/prod は永続ボリューム必須。長期/集約/異常検知はフェーズ2。
- **観測性テストは新ドメイン O**（英字1文字プレフィクス制約のため `LOG-` 不可）。
- **admin/quest-group のテスト隔離フレークは本セッションで恒久対処しない**（スコープ外・別タスクが妥当・§7-2）。

## 7. 次にやること（優先順・具体的に）
1. **本セッション修正のブラウザ実機受入**（次回ゲート）＝`http://localhost:3000`。①情報詳細で編集→閉じる（背景/Esc/× 含む）で破棄確認→「編集に戻る/破棄して閉じる」②無変更保存で閉じて「変更はありません」③各フォーム（プロフィール/アカウント編集/クエスト編集/評価再確定/グループ名リネーム）で無変更保存→info トースト。ログは `impl/logs/backend.jsonl` を tail して JSON 目視。
2. **e2e/テストのデータ隔離フレーク恒久対処**（§5）＝`impl/backend/tests/admin/test_admin_quest_groups.py` の fixture `qg`（teardown でグループ/所属だけ消しアカウントを残す）に**アカウント物理削除**を追加、または `company-directory` の per_page を十分大きく／テスト専用会社で隔離。加えて e2e（sc-92c 等）作成データの後始末徹底。着手前に既存 seed を壊さないか確認。
3. **システムログ フェーズ2**（`doc/本番デプロイ要件.md §6.6` TODO）＝集約基盤転送/長期アーカイブ(WORM)/異常検知。§6.5 と突合。
4. **QuestGroupSection 以外の残 §14**＝無し（全対象是正済み）。他の「毎回 API を呼ぶ更新系」を見つけたら §14 に寄せる（横断チェック）。
5. **前セッション由来の残**＝SC-50 ⑥作成者モードで要約 read 非表示（§79 解釈をユーザー確認）／メモリ `internal-review-remaining-items`（評価ダイアログにクエスト情報・クエスト最終結果）／反証の要再評価フラグ（§3.5）／コンセプト機能設計（メモリ `concept-feature-design-split`・`fr39-iso-mapping-superseded`）。`doc/実装計画.md` で次ドメイン確認。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。compose=**`impl/compose.yaml`**（`docker-compose.yml` は無い＝罠）。docker は **cwd=`impl/`**。
- **起動**: `cd impl && docker compose up -d`。コード反映＝**`docker compose up -d --build backend`**（backend はソースをベイク＝ボリューム無・メモリ `backend-no-source-mount`）。frontend も `--build`。schema/DTO 変更後は `cd impl/frontend && npm run codegen`。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=**`/healthz`**〔`/api/v1/health` は無い＝旧記載の誤り〕）/ db 5432 / redis 6379 / minio 9000・9001 / mailhog 1025・8025。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` で未コミット変更も反映）。**pytest 前に `docker compose stop worker mail-worker`**（共有 control DB の *_outbox 競合回避）→終わったら start。※`docker compose run backend` は logs ボリュームも継承するため**テスト実行が `impl/logs/*.jsonl` に書き込む**（gitignore・無害）。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート＝Next lint 含む）／`npx vitest run <path>`（node 環境・純関数のみ・UI は e2e）／`npx playwright test e2e/<spec> --grep "<TC-ID>"`（フルスタック起動が前提）。※ルート直で `cd impl/frontend` を挟むと以降 cwd がずれることがある＝各 Bash は絶対パス `cd` から始める。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（現在 721件・TC-ID は `[A-Z]-TC-\d{3}`＝英字1文字ドメイン）。
- **システムログ**: 出力先 `impl/logs/`（gitignore・root 所有＝ホストから rm 不可→ `docker compose run --rm --no-deps -v "$(pwd)/logs:/logs" backend sh -c 'rm -f /logs/*.jsonl'`）。env は compose `&backend_env`（LOG_LEVEL/LOG_FORMAT/LOG_TO_FILE/LOG_DIR/LOG_RETENTION_DAYS/LOG_UTC）。
- **テストデータ掃除（フレーク対策）**: ACME 会社DB＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "<SQL>"`。空クエストグループ削除例＝`DELETE FROM quest_groups WHERE quest_group_code ~ '^(QG|QGN|SCDEV)' AND id NOT IN (SELECT quest_group_id FROM quest_group_members) AND id NOT IN (SELECT quest_group_id FROM quest_group_links);`（実グループは `DEV`/`DEV-01`/`DEV-02` のみ＝これらを消さない）。情報アイテムは DELETE API（raw・作成者本人なら 204）。
- **ログイン（再確認済）**: `user@acme.example`/`ACME-01`/`Passw0rd!`＝一般（＝多くの e2e の作成者/評価者）。`kanri@acme.example`/`ACME-01`/`Passw0rd!`＝company_account_admin。`admin@ops.example`/`OPS`/`Passw0rd!`＝system_admin。認証は Cookie セッション。状態変更 API は `iq_csrf` Cookie を `X-CSRF-Token` に載せる（curl/`page.request` 検証時は cookie jar から取り出す・403 csrf_failed 回避）。
- **DB 名の会社別命名（罠）**: control=`ideaquest_control`／ops=`ideaquest_ops`／ACME=`ideaquest_company_acme`／ACME2=`ideaquest_company_acme2`／システムコンシェルジュ=`db_systemcon`（会社ごと命名規則が違う。会社詳細のバナー「DB:」で確認）。ユーザー/パス=ideaquest。
- **設計正本**: `CLAUDE.md`（毎回自動ロード）から各規約・正本へ。ドメイン設計=`doc/API設計/{A..N}_*.md`・画面=`doc/画面設計/screens/SC-xx_*.md`＋`doc/画面設計/デザイン標準.md`・データモデル=`doc/データモデル.md`・テスト台帳=`doc/テスト/*.md`。メモリ index=`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/MEMORY.md`。

---
### 自己チェック（本ファイルだけで再開できるか）
- 起動/再ビルド/テスト（-v＋worker 停止・logs ボリューム副作用・cwd ずれ注意）/ログイン（Cookie+CSRF）/ポート（health=/healthz）/DB名の会社別命名の罠/compose ファイル名の罠/テストデータ掃除の SQL＝記載済。
- 本セッションの全スライス（破棄確認・システムログ・無変更保存×5フォーム）＝対応ファイル/関数/テストID/コミット付きで記載。
- 未確認（全 vitest/e2e/ブラウザ受入）・既存フレーク（admin 2件・quest-group／原因=永続DBのテストデータ累積＋ページング・私の変更外）・フェーズ2 TODO＝明記＝過信防止。
- 次アクションはファイル/関数レベルまで具体化（特に §7-2 のフレーク恒久対処と掃除 SQL）。
