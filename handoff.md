# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-23 JST**
- ブランチ: **main**（作業ツリー clean・`origin/main` と同期＝全 push 済）。
- 本セッションのコミット列（古→新・すべて push 済）＝**e2e フレーク恒久対処（§7-2）**:
  - `1aba983` test(flake): e2e並列セッション衝突とadmin company-directoryのフレーク恒久対処
  - `5000a75` test(e2e): 並列フル実行のログイン衝突をstorageState認証で恒久対処（62failed→解消）
  - `5b5b72d` test(e2e): データ蓄積の後始末をteardown projectに集約＋SC-93発行フォーム閉判定の実バグ修正
  - `58e5799` test(e2e): 並列実行の残タイミング分散を retries=2 で吸収
  - `8d4e1a4` test(e2e): retries でも残る決定的3件＋D-TC-218 の実バグ/脆さを修正
  - （＋本 handoff コミット）
- 前セッションの末尾＝`4bddd60`（情報インプット受入・ドメインN）。
- コミット方針: ユーザーが「コミットして/プッシュして」と言うまで実行しない。**1スライス=1コミット**。末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..N・画面 SC-xx）。実装は `impl/`。

## 3. 今回やったこと（e2e 並列フル実行のフレーク恒久対処・全て検証済み）
**動機**＝Playwright 全 e2e 一括（workers=7・約146件）が **78 passed / 67 failed** だった。原因を段階的に特定し恒久対処、**138 passed / 6 flaky(retry回復) / 3 failed** まで改善。残3件は負荷依存の非決定（§5）。

### A. 全端末ログアウトの共有アカウント衝突（`1aba983`）
- `sc-00-login.spec.ts` の **A-TC-022「全端末からログアウト」**が共有 `user@acme` に `logout_all`（backend `delete_account_sessions`）を叩き、同アカウントで並列実行中の他ワーカを一斉に session_expired へ巻き込んでいた。→ 破棄系専用の隔離シード垢 **`e2e-session@acme.example`**（`bootstrap.py` の `_SEEDS`・非prodのみ）を新設し A-TC-022 をそれでログイン。
- 同コミットで backend `B-TC-083b/083c`（`tests/admin/test_admin_quest_groups.py`）のフル実行フレークも恒久対処＝conftest factory `make_seed_company_account` に `display_name` 引数追加、083b/083c は一意タグで `company-directory?q=<tag>` を絞り、ページング蓄積に依存しないように。メモリ `admin-directory-tests-flaky`（解消済）。

### B. ログインのレート制限バケット共有（主因~62件・`5000a75`）
- 真因＝backend `check_login_rate_limit`＝**(IP+login_id) 固定窓**（dev 既定 `LOGIN_RATE_LIMIT_MAX=50/300s`・成功ログインも枠消費）。全 Playwright ワーカが同一 frontend コンテナIP＋同一 `user@acme` で毎テスト再ログイン→窓内で超過→429→ログイン画面から進めず大量 fail。
- 対処＝**Playwright storageState 方式**。`e2e/auth.setup.ts`（setup project）で `user@acme` を1回ログイン→`playwright/.auth/user.json` 保存。`playwright.config.ts` の chromium project は `dependencies:['setup']`＋既定 `storageState`。各 spec の `login()` は `goto('/')` だけ（再ログイン廃止）。user@acme 既定 spec 35本＋sc-24-chat を変換。
- 認証フロー spec（`sc-00-login/session-expiry/mfa/password-setup`）は `test.use({storageState:{cookies:[],origins:[]}})` で**未認証 opt-out**し自前ログイン。
- **落とし穴**＝`sc-00-password-setup` は complete で当該垢の全セッションを破棄する→共有 user@acme を使うと storageState セッションを壊す→専用垢 **`e2e-pwreset@acme.example`**（`_SEEDS`）に分離。
- 付随＝`sc-99-gamemode` の曖昧ロケータ `/クエスト/`（「クエストを探す」と二重一致）を href 一意化。`.gitignore` に `**/playwright/.auth/`（session Cookie を含むので追跡しない・中間スラッシュ anchor 罠を回避）。
- メモリ `e2e-storagestate-auth`・`shared-account-logout-all-e2e-cascade`。

### C. admin データ蓄積の後始末（`5b5b72d`）
- 永続DB（db_data ボリューム）にテストが作るクエストグループ/アカウント/会社が実行ごと累積（実測 ACME 空グループ21・OPS 発行垢16・E2E 会社24）＝admin 一覧の件数/ページング/検索を不安定化。
- **`e2e/auth.cleanup.ts`（teardown project）**を追加＝実行末に psql で「テスト専用パターンのみ」削除（QG/QGN/SCDEV グループ＋所属／OPS の `e2e-l-*@ops.example` 垢を FK 順〔otp_challenges・trusted_devices・account_sync_outbox・mail_outbox・system_audit_logs→accounts〕／アカウント無しの `E2E-*` 会社）。seed は不可侵。config で setup→chromium→cleanup に配線。
- 同コミットで **SC-93 B-TC-124 の実バグ**修正＝発行フォーム閉判定 `getByText("アカウントを発行")` が成功トースト「アカウントを発行しました」に部分一致してトーストが残る間 count>0（並列負荷でフレーク）→ `getByRole("heading",{exact})` に。

### D. 残タイミング分散＋決定的3件（`58e5799`・`8d4e1a4`）
- `retries: 2`（`playwright.config.ts`）＝各テスト単体 green・実行毎に落ちる顔ぶれが変わる非決定分散を吸収（実バグは全試行で落ちマスクされない）。
- retries でも残る決定的3件を個別修正＝**sc-92c B-TC-116**（曖昧ロケータ→検索チップ「🔍 "code"✕」と二重一致→`getByRole("cell")`）／**sc-99-appnav M-TC-002**（ドロワー開閉アニメ中の空振り→`is-open` 待ち）／**sc-99-scroll-restore M-TC-013/014**（復元位置の単発読み→近傍まで poll）。
- **sc-22-attachments D-TC-218**（実は test setup バグ）＝ヘルパが添付を別API直POSTで足すだけで版に載らず、公開時 rev1（添付なし）と正味同値で削除しても版が増えなかった。設計は「添付だけの変更でも保存で版が増える」（D-TC-145/D-TC-234・**product は正**）。同値PATCHで添付を rev2 に確定→削除保存=rev3 とし、削除が版差分に出ることを正しく検証。メモリ `idea-attachment-revision-versioning`。

## 4. 現在の状態（本セッションで実行・確認）
- **全 e2e 並列(workers=7)**＝**138 passed / 6 flaky(retryで回復) / 3 failed**（前=78/67）。TC トレーサビリティ ✅ 733（新規TC-IDなし＝既存テストの隔離強化）。
- **backend**＝`tests/admin` フル 107 passed（083b/083c 含む・-v マウント）。
- 稼働コンテナ＝backend/db/redis/mailhog/minio/frontend/worker/mail-worker とも Up（backend は `e2e-session`/`e2e-pwreset` seed 済で `--build` 済）。
- 壊れているもの＝認識範囲で無し（§5 の負荷依存フレークを除く）。

## 5. 詰まっている点 / 未確認
- **残 3 failed は全て負荷依存の非決定フレーク**＝実行毎に顔ぶれが変わり（今回は `sc-01-dashboard-notif I-TC-144/I-TC-155`・`sc-01-dashboard D-TC-226`）、**いずれも単体（--workers=1/2）では 100% green**＝7ワーカ CPU 競合で重いダッシュボード描画が retry も含めタイムアウトする現象。**実バグではない**。ユーザー判断で「ここで区切る」＝これ以上の per-test 追い込みはしない方針（移動標的）。
- 日常は従来通り **targeted 実行**（`npx playwright test e2e/<spec> --workers=1 --grep <TC>`）または全並列を回すなら **workers を 4〜5 に落とす**と重いページも安定する（未コミットの運用ノウハウ・必要なら config 化）。次に green を厳密に詰めるなら `retries:3` か workers 抑制が候補（§7）。
- **未確認**＝frontend 全 vitest（本セッション未実行）。

## 6. 決定事項と根拠
- **e2e 認証は storageState 方式**（共有 user@acme を1回ログイン再利用）＝レート制限バケット共有の根絶。破棄系（全端末ログアウト/パス再設定完了/権限変更）は必ず**専用垢**で（`e2e-session`/`e2e-pwreset`）＝共有セッションを壊さない。
- **データ後始末は teardown project に集約**（各 spec 個別の finally は UI 操作自体がフレークになりやすいため）。テスト専用パターンのみ削除・seed 不可侵。
- **残る負荷依存分散は retries=2 で吸収**（実バグはマスクされない）。ノイズ隠しではない＝systemic 要因は解消済み、という判断。
- **添付だけの編集で版が増える**のは設計（D-TC-145/D-TC-234）＝product は正。D-TC-218 の失敗はテスト setup が添付を版に確定していなかったバグ。

## 7. 次にやること（優先順）
1. **（任意）全並列を厳密 green にするなら**＝`playwright.config.ts` を `retries:3` か、全並列運用を workers=4〜5 に。重い sc-01 ダッシュボード群の CPU 競合タイムアウトが主因。着手前に §5 の「単体では green」を再確認。
2. **前セッション由来の残**＝SC-50 ⑥作成者モードで要約 read 非表示（§79 解釈をユーザー確認・メモリ `internal-review-remaining-items`）／反証の要再評価フラグ（§3.5）／コンセプト機能設計（メモリ `concept-feature-design-split`・`fr39-iso-mapping-superseded`）。`doc/実装計画.md` で次ドメイン確認。
3. **システムログ フェーズ2**（`doc/本番デプロイ要件.md §6.6` TODO・持ち越し）＝集約基盤転送/長期アーカイブ(WORM)/異常検知。メモリ `system-logging-mechanism`。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。compose=**`impl/compose.yaml`**（`docker-compose.yml` は無い＝罠）。docker は **cwd=`impl/`**。
- **起動**: `cd impl && docker compose up -d`。**frontend/backend はソースをベイク（volumes 無）**＝コード反映は **`docker compose up -d --build frontend`**（または backend）。**bootstrap は backend の entrypoint で毎起動実行（冪等）**＝`_SEEDS` 追加後は `--build backend` で再 seed（本セッションで `e2e-session`/`e2e-pwreset` を追加済）。
- **e2e（Playwright）**: host で実行し `http://localhost:3000`＝frontend コンテナを叩く（メモリ `frontend-baked-e2e-needs-build`）。**認証は storageState**＝`e2e/auth.setup.ts`（setup project）が `playwright/.auth/user.json` を作り、末尾に `e2e/auth.cleanup.ts`（cleanup project）がテストデータを掃除。各 Bash は絶対パスで `cd impl/frontend` から始める（repo ルートに cd 済だと `npx playwright` が「No tests found」＝罠）。
  - 全並列＝`cd impl/frontend && npx playwright test --workers=7`（重いなら 4〜5）。targeted＝`npx playwright test e2e/<spec> --workers=1 --grep "<TC-ID>"`。
  - 破棄系 e2e（パス変更成功/全端末ログアウト/権限変更）を新規追加するなら**専用垢**を使う（共有 user@acme を壊さない）。作成系はテスト専用の識別パターン（接頭辞/一意タグ）を付け cleanup が拾えるように。フォーム閉/行存在の判定は `getByText` 部分一致を避け role/exact で（トースト/検索チップ二重一致の罠）。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` で未コミット反映）。**pytest 前に `docker compose stop worker mail-worker`**（共有 control DB の *_outbox 競合回避）→終わったら start。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=`/healthz`）/ db 5432 / redis 6379 / minio 9000・9001 / mailhog 1025・8025。
- **ログイン**: `user@acme.example`/`ACME-01`/`Passw0rd!`＝一般（多くの e2e の owner・storageState の主体）。`kanri@acme.example`＝company_account_admin。`admin@ops.example`/`OPS`＝system_admin。`e2e-session@acme.example`＝全端末ログアウト e2e 専用。`e2e-pwreset@acme.example`＝パス再設定 e2e 専用。認証は Cookie セッション、状態変更 API は `iq_csrf` Cookie を `X-CSRF-Token` に載せる。
- **DB 名の会社別命名（罠）**: control=`ideaquest_control`／ops=`ideaquest_ops`／ACME=`ideaquest_company_acme`／ACME2=`ideaquest_company_acme2`／システムコンシェルジュ=`db_systemcon`。ユーザー/パス=ideaquest。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（733件）。コミット前に ✅。
- **設計正本**: `CLAUDE.md`（毎回自動ロード）から各規約・正本へ。メモリ index=`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/MEMORY.md`（本セッションで `e2e-storagestate-auth`・`shared-account-logout-all-e2e-cascade`・`idea-attachment-revision-versioning` を追加・`admin-directory-tests-flaky` を解消済に更新）。

---
### 自己チェック（本ファイルだけで再開できるか）
- 起動/再ビルド（bootstrap は entrypoint 毎起動・_SEEDS 追加は --build backend）/e2e（storageState 認証・cleanup project・cwd 絶対パス罠）/backend テスト（-v＋worker 停止）/ログイン（専用垢2つ含む・Cookie+CSRF）/ポート/DB名罠/compose ファイル名罠＝記載済。
- 本セッションの全スライス（A 全端末ログアウト衝突＋083／B storageState／C teardown＋SC-93／D retries＋決定的3件＋D-TC-218）＝対応ファイル/関数/TC-ID/コミット付きで記載。
- 残 3 failed の性質（負荷依存・単体green・実バグでない）と、厳密 green の手段（retries:3 / workers 抑制）＝明記＝過信防止。
