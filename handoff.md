# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-23 JST**
- ブランチ: **main**（作業ツリー clean・`origin/main` と同期＝全 push 済）。
- 最新コミット（新→古の要点）:
  - `70a9635` feat(info-links): 成果物側「＋ 関連情報を追加」逆向きピッカー（RelatedInfoPanel・SC-12・slice③）
  - `07bbc03` / `a95a263` 関連情報ストリップの配置調整（最終＝新着の議論/活動の活発さ の下・KPI/ランキングの上）
  - `ba73df2` RelatedInfoPanel を SC-12 上部に結線（FR-41 Phase1・slice①）
  - `ad6dc43`〜`23049c2` 情報リンク編集の不具合修正群（棄却の除外／トースト最前面／並び順維持 等）
  - `d1529b1`〜`fd1debc` 関連情報の backend read EP（C.8b/D）＋`info_links.created_by_id`＋設計/モック
  - `c7c5e38` 前半＝e2e フレーク恒久対処の handoff（本コミット群 `1aba983`〜`8d4e1a4` の記録）
- コミット方針: ユーザーが「コミット/プッシュして」と言うまで実行しない。**1スライス=1コミット**。末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..N・画面 SC-xx）。実装は `impl/`。

## 3. 今回やったこと（2アーク。**再開の主対象は B＝FR-41 関連情報**）

### アーク A（前半・完了）＝e2e 並列フル実行のフレーク恒久対処（§7-2）
- 詳細は前 handoff（`c7c5e38`）に記録済み。要点だけ再掲＝**e2e は storageState 認証方式に転換済み**（`impl/frontend/e2e/auth.setup.ts`＝共有 user@acme を1回ログイン→`playwright/.auth/user.json` 再利用）／末尾に **cleanup teardown project**（`e2e/auth.cleanup.ts`＝テスト専用データを psql 掃除）／**`retries: 2`**（`playwright.config.ts`）。破棄系 spec（`sc-00-*`）は `test.use({storageState:{cookies:[],origins:[]}})` で未認証。専用 seed 垢＝`e2e-session@acme.example`（全端末ログアウト用）・`e2e-pwreset@acme.example`（パス再設定用）を `impl/backend/scripts/bootstrap.py` の `_SEEDS` に追加済み。全 e2e 並列＝**137 passed / 数件は負荷依存の非決定フレーク**（実バグではない）。

### アーク B（後半・進行中）＝FR-41 情報インプット↔成果物の「関連付け（related-info）」Phase 1
**目的**＝情報インプット（`info_links`）を成果物（クエスト/アイデア）側でも表示・追加できる双方向連携。設計正本＝`doc/画面設計/screens/SC-12_*`（§4.1d）・`SC-22_*`（§4.6b）・`doc/API設計/C_*`（C.8b）・`D_*`（related-info 行）・`N_*`（N.3 追記）・`doc/データモデル.md`（§5.35 `created_by_id`）・モック `doc/画面設計/mocks/SC-12-22_関連情報パネル.html`。

- **backend read EP（C.8b/D）**: `GET /quests/{id}/related-info`・`GET /ideas/{id}/related-info`＝各ドメインの read（新規横断EPなし・N.1 委譲）。
  - `impl/backend/app/tenant/info/repository.py`＝`list_links_for_target()`（target で info_links を引く・rejected/archived 除外・score 降順）／`create_link()` に `created_by_id` 追加。
  - `impl/backend/app/tenant/info/application.py`＝`related_info_for_target()`（DTO 整形・manual は `created_by_id` を氏名/アバターに解決＝linked_by）／`add_link()` が actor.id を渡す。
  - `impl/backend/app/tenant/info/schemas.py`＝`RelatedInfoItemDTO`/`RelatedInfoResponse`。
  - `impl/backend/app/tenant/info/orm.py`＝`InfoLink.created_by_id`（NULL可・FK users）を追加。**migration `impl/backend/migrations/company/versions/0031_info_link_created_by.py`**。
  - `impl/backend/app/tenant/quests/{application,router}.py`＝`get_quest_related_info`＋route（門番＝`get_quest_detail` と同一）。`ideas/{application,router}.py`＝`get_idea_related_info`＋route。**遅延 import で info application を呼ぶ（循環回避）**。
- **「対象を選ぶ」ダイアログ（情報側の関連付け＝TargetPicker）改善**（`impl/frontend/src/features/info-input/components/TargetPicker.tsx`）:
  - 種別セレクタを**フッターから本文へ移動**＝`🔍絞り込み → 🏷️設定する種別 → 📋絞り込み結果` の3セクション（仕切り線 `.pick-divider`）。`onConfirm(selected, kind)`。
  - `existing` を受け取り「既に関連付け済み」を**折り畳み表示＋絞り込み結果から除外**（重複 409 防止）。**棄却済みも existing に含めて除外**（find_link が棄却行も 409 にするため・復活は詳細の「戻す」）。
  - 呼び元＝`InfoDetailView.tsx`（`existing={item.links}` 全件）・`InfoFormPanel.tsx`（ステージ済み `links`）。両者の `addPicked(picked, kind)` は選んだ種別で即追加/ステージ。
- **リンク操作の UX 修正**（`impl/frontend/src/features/info-input/components/InfoDetailView.tsx`）:
  - `linkOp(fn, doneMsg?)`＝再取得で**表示順を維持**（既存 id 順・新規は末尾。`InfoLink` に created_at が無いためフロントで順序保持）＋**完了トースト**（保存前に反映済みと明記）。
- **成果物側パネル（RelatedInfoPanel）＝SC-12 に結線**（新規 `impl/frontend/src/features/info-input/components/RelatedInfoPanel.tsx`・`index.ts` で export）:
  - 横スクロール棚＋ヘッダー（件数・⚠反証数・**＋ 関連情報を追加**・⤢全画面）＋カード（種別バッジ・由来〔🤖自動／✋アバター+氏名〕・一致度・機会/脅威・出典・要約）。⚠反証を先頭固定。カードクリックで `/info-items/{id}`（SC-52）。「⤢全画面」は Modal でグリッド。`INFO_CHANGED_EVENT` で再取得。
  - `impl/frontend/src/features/info-input/api.ts`＝`fetchRelatedInfo(targetType,id)`。`types.ts`＝`RelatedInfoItem`。CSS＝`info-input.css` の `.ri-*`。
  - `impl/frontend/src/features/quests/components/QuestDetailView.tsx`＝`.quest-top` 内で `.discuss-row`（新着の議論/活動の活発さ）の直後・`.quest-panels`（KPI/ランキング）の直前に `<RelatedInfoPanel targetType="quests" .../>` を配置（ゲームモード非依存）。
- **「＋ 関連情報を追加」逆向きピッカー**（新規 `impl/frontend/src/features/info-input/components/AddRelatedInfoDialog.tsx`）:
  - 既存情報を検索（`searchInfoItems`＝`GET /info-items?q`）→種別選択→`addLinkApi()`（`POST /info-links`・target=当該成果物・**新規EPなし**）。既に関連付け済みは検索結果から除外。反証は確認ダイアログ。確定後 `INFO_CHANGED_EVENT`＋完了トースト。
- **UI 基盤の実バグ修正**（`impl/frontend/src/styles/design-system.css`）:
  - 完了トーストがモーダル表示中に見えなかった真因＝`body.modal-open :not(.modal)...` の背景アニメ一時停止（DFT-E-012）が **snackbar の登場アニメ（opacity0→1）まで止めていた**。→ 一時停止セレクタに `:not(.snackbar-stack):not(.snackbar-stack *)` を追加。併せて `.snackbar-stack` の z-index を 90→2000（最前面）。

## 4. 現在の状態（本セッションで確認）
- **稼働コンテナ**＝backend/db/redis/mailhog/minio/frontend/worker/mail-worker **すべて running**（frontend は本セッション最終コードで `--build` 済）。
- **backend**＝`tests/info` 67 passed／`tests/admin` 107 passed／新規 api テスト（C-TC-285/286・D-TC-235/236）4 passed（いずれも `-v` マウントで確認）。
- **frontend `npm run build`**＝Compiled successfully（必須ゲート・都度通過）。
- **e2e（targeted）**＝`sc-52-info-link-ops.spec.ts`（N-TC-220/221/222）・`sc-12-related-info.spec.ts`（C-TC-287/288）＝各 green。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅ **742件**。
- **壊れているもの**＝認識範囲で無し。**未確認**＝FR-41 の**ブラウザ実機受入は SC-12 まで**（ユーザーは slice ごとに確認する運用）／全 vitest／全 e2e 一括（アーク A の非決定フレークが残る想定）。

## 5. 詰まっている点 / 試して失敗したこと（＝次回同じ轍を踏まない）
- **完了トーストが見えない**＝最初 z-index を疑い 90→2000 にしたが**直らなかった**。真因は §3B の「modal-open の背景アニメ停止が snackbar の登場アニメ(opacity0→1)を止め、opacity0 のまま裏に居た」。**教訓＝Playwright の `toBeVisible()` は opacity:0 を「見える」と判定する**ので見逃す→ **computed opacity>0 を assert**（N-TC-220 で追加済み）。
- **棄却リンクが「選択済0件」**＝`existing` を `!rejected` でフィルタしていたため。だが `find_link` は棄却行も 409 にする→ピッカーから再追加すると矛盾。→ 棄却も除外対象に含め、折り畳みに「棄却済み・戻すで復活」表示（N-TC-222）。
- **`info_links.created_by_id` は当初「共通監査列で装備済み」と誤認**＝実際は `InfoLink` に無く、migration `0031` で追加した（`CompanyBase` は素の DeclarativeBase で監査列を自動付与しない）。
- **cwd の罠（再掲・実際に2回踏んだ）**＝`docker compose up`（cwd=impl）の直後に `npx playwright test` を同じ Bash で叩くと「No tests found」。**Playwright は必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl/frontend` から**。

## 6. 決定事項と根拠（不採用案も）
- **関連情報パネルの UI＝自動カルーセルは不採用**（reduce-motion 停止で無意味化／見逃し／⚠反証が隠れる／入れ子モーダル）。→ **ユーザー操作の横スクロール棚＋⚠反証先頭固定＋⤢最大化（SC-13 流用の Modal）**。
- **配置**＝SC-12 は「新着の議論/活動の活発さ の下・KPI/ランキングの上（全幅ストリップ・ゲーム非依存）」（ユーザー確定）。SC-22 は「評価結果の下（右レール・`variant="rail"`）」＝**未実装（次の主タスク）**。
- **種別選択はダイアログ本文の3セクション**（絞り込み→設定する種別→絞り込み結果）。「選択を確定」で選んだ種別のまま追加。
- **追加/種別変更/棄却＝会社内 active 全員**（情報側 N.3）。「＋追加」は逆向きピッカー（`GET /info-items`＋`POST /info-links`）で**新規EPなし**。**採否・「処理済み」入力（管理権限者）は Phase 2**（別スコープ）。**割り振り＋議論チャットも Phase 2**（コンセプト機能のチャット一般化と統合＝チャット乱立を避けるため単独実装しない）。
- **手動リンクは「関連付けた人」をアバター＋氏名で表示**（`info_links.created_by_id`・auto は system＝表示なし）。

## 7. 次にやること（優先順・具体的に）
1. **slice②＝SC-22（アイデア詳細）に RelatedInfoPanel を結線**（FR-41 Phase1 の最後）:
   - `impl/frontend/src/features/ideas/components/IdeaDetailView.tsx` の**右レール「評価結果」パネル（§4.6・`evalAgg` 描画箇所）の下**に `import { RelatedInfoPanel } from "@/features/info-input";` して `<RelatedInfoPanel targetType="ideas" targetId={ideaId} variant="rail" />` を追加（`ideaId` は既存の prop/変数を確認して使用）。
   - e2e 追加＝`e2e/sc-22-related-info.spec.ts`（**D-TC-2xx**・SC-12 の `sc-12-related-info.spec.ts` を雛形に／API で quest+idea 作成→情報を related-info でリンク→`/ideas/{id}` で `.ri-panel` 表示＋「＋追加」）。TC 行を `doc/テスト/D_アイデア.md` に先行追記→`check_tc_traceability.py` ✅。
   - `npm run build`→`docker compose up -d --build frontend`→targeted e2e→**ユーザーに実機受入**（backend-connection-per-screen-loop）。
2. **（任意）「一致度 0.82」表記の見直し**＝ユーザーは以前 OK と回答済み（現状維持で可）。
3. **Phase 2（別スコープ・要ユーザー着手判断）**＝成果物側の採否・「処理済み」入力（管理権限者）／割り振り＋議論チャット（コンセプト機能のチャット一般化と統合）。
4. **前セッション由来の残**＝コンセプト機能設計（正本ドラフト `doc/設計ドラフト/コンセプト機能_ISO56002_再設計.md`・メモリ `concept-feature-design-split`/`fr39-iso-mapping-superseded`＝FR-39 の ISO 対応は「置換済み」＝要件定義 README で反映済み）／システムログ フェーズ2（`doc/本番デプロイ要件.md §6.6`・メモリ `system-logging-mechanism`）。`doc/実装計画.md` で次ドメイン確認。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。compose=**`impl/compose.yaml`**（`docker-compose.yml` は無い＝罠）。docker は **cwd=`impl/`**。
- **起動**: `cd impl && docker compose up -d`。**frontend/backend はソースをベイク（volumes 無）**＝コード反映は **`docker compose up -d --build frontend`**（または backend）。**backend の `_SEEDS`/migration 追加後は `--build backend`**（entrypoint が bootstrap＝DB作成/migrate/seed を毎起動・冪等）。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート＝Next lint 含む）。
- **e2e（Playwright）**: **必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl/frontend` から** `npx playwright test e2e/<spec> --workers=1`（フルスタック起動＋frontend `--build` が前提。host の Playwright が `http://localhost:3000` のコンテナを叩く）。認証は **storageState 方式**（`e2e/auth.setup.ts` が既定・spec 側は再ログイン不要）／破棄系は `test.use({storageState:{cookies:[],origins:[]}})`／末尾で `e2e/auth.cleanup.ts` がテストデータを掃除／`retries:2`。作成系 e2e は必ず後始末（try/finally で DELETE）。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` で未コミット反映）。**pytest 前に `docker compose stop worker mail-worker`**（*_outbox 競合回避）→終わったら start。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（現在 742件・TC-ID＝`[A-Z]-TC-\d{3}`）。コミット前に ✅ を確認。**TC はコードより先に `doc/テスト/<ドメイン>_*.md` に行追加**（`根拠` 列付き）。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=`/healthz`）/ db 5432 / redis 6379 / minio 9000・9001 / mailhog 1025・8025。
- **ログイン**: `user@acme.example`/`ACME-01`/`Passw0rd!`＝一般（多くの e2e の owner・storageState の主体）。`kanri@acme.example`＝company_account_admin。`admin@ops.example`/`OPS`＝system_admin。`e2e-session@acme.example`＝全端末ログアウト e2e 専用。`e2e-pwreset@acme.example`＝パス再設定 e2e 専用。認証は Cookie セッション、状態変更 API は `iq_csrf` Cookie を `X-CSRF-Token` に載せる（`page.request`/curl 検証時）。
- **DB 名（罠）**: control=`ideaquest_control`／ops=`ideaquest_ops`／ACME=`ideaquest_company_acme`／ACME2=`ideaquest_company_acme2`／システムコンシェルジュ=`db_systemcon`。ユーザー/パス=ideaquest。
- **設計正本/メモリ**: `CLAUDE.md`（毎回自動ロード）から各規約・正本へ。メモリ index=`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/MEMORY.md`（本セッションで `e2e-storagestate-auth`・`shared-account-logout-all-e2e-cascade`・`idea-attachment-revision-versioning` を追加・`admin-directory-tests-flaky` を解消済に更新）。

---
### 自己チェック（本ファイルだけで再開できるか）
- 起動/再ビルド（frontend/backend ベイク＝--build・_SEEDS/migration 後は --build backend）/e2e（storageState 認証・cleanup teardown・retries・**cd impl/frontend の罠**）/backend テスト（-v＋worker 停止）/TC 先行＋トレーサビリティ/ログイン（専用垢2つ含む・Cookie+CSRF）/ポート/DB名罠/compose ファイル名罠＝記載済。
- FR-41 の到達点（backend read EP＋created_by_id migration／TargetPicker 改善／RelatedInfoPanel を SC-12 に結線＋AddRelatedInfoDialog／トースト・棄却・並び順の各修正）と**次の主タスク＝SC-22 右レール結線**をファイル/関数レベルで記載。
- 失敗した診断（トースト z-index 誤診→真因は modal-open のアニメ停止・toBeVisible は opacity0 を拾わない／created_by_id 未装備の誤認）を §5 に記録＝再発防止。
