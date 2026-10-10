# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`、**残作業の正本は `doc/バックログ/未実装・ギャップ一覧.md`**。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-10（未明・**情報インプット動的タブ D4 実装＋シークレット管理 D6(A) 完遂＋info ワードクラウド不具合修正**セッション）。
- ブランチ: `main`（worktree 無し＝通常のクローン直下 `/home/t-umekawa/sc-ideaquest-G2`）。**main 直コミット/push が本プロジェクトの慣習**（複数セッションが main に直接積む運用＝下記 §9 の並行開発注意）。
- 更新開始時点の最新コミット: **`4ab71881`** fix(info/D4): サブタブ ⋮ をタブ名の左側へ。その直前が D4 UI 調整群（`6c457a64`/`6a141b08`/`930c3f1a`/`29719fba`/`8d09ef4a`/`3329a304`/`4fc6316c`/`b0a64676`/`54ad1580`/`11c9c40a`）。
- 未コミット変更: **本ファイル（handoff.md）と `doc/バックログ/未実装・ギャップ一覧.md` の session-end 更新のみ**（このコミットで push 予定）。ソースは全て push 済み・working tree はそれ以外クリーン。
- alembic heads: company=**`0067_company_ai_settings`**（2026-10-10 追加＝会社の AI 動作ポリシー）／control=`0020_signup_challenges`（変更なし）。

## 2. このプロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘の消化＋仕様確定済み未実装機能の処理。本セッションは横断基盤（秘密管理 D6）・情報インプットの不具合修正・情報インプット動的タブ（D4）を実装した。

## 3. 今回やったこと（新しい順・理由つき・コミット）
> 2026-10-10 追加セッション＝(1) 並行引継2件の裏取り→起票（D8/F12・F4集約）、(2) AI 挙動の env 棚卸し→会社別化。以降は前セッション（D6→info修正→D4）。

### 3-0. AI 設定の会社別化（公開時自動評価・2026-10-10）
- **棚卸し結論**＝AI 挙動設定は3層（①基盤配線=env 据え置き／②既に会社別＝`alignment_method`・`company_ai_model_settings`〔ON/OFF・予算・`max_output_tokens`〕／③env だが会社ポリシー）。③のうち `llm_max_tokens` は **②の `max_output_tokens`（会社別・company>env フォールバック）で実装済**と判明＝追加不要。残る `llm_auto_evaluate_on_publish`（公開時自動評価）のみ会社別化。
- **実装（完了・未コミット→このセッションで push 予定）**＝新テーブル `company_ai_settings`（会社DB シングルトン・§5.67・migration `0067`・`auto_evaluate_on_publish` NULL=env 継承）／EP `GET/PATCH /admin/ai-policy`（S.5b・`require_company_account_admin`）／`ideas/application._enqueue_idea_ai_evaluation` を **会社値 coalesce env** に差し替え（会社 OFF なら env ON でも投入しない＝会社値優先）／frontend `features/ai-settings`（`AiSettingsView` に「AI 動作ポリシー」セクション＝SC-94 に集約・ユーザー指示「ON/OFF 画面に寄せて」）。
- **解決順＝会社設定 > env フォールバック**（ユーザー決定）。置き場は per-model の §5.58 ではなく会社横断シングルトン（将来の会社横断 AI ポリシーの受け皿）。
- **テスト**＝S-TC-215〜219（api/int・**red→green 実証済**＝実装 stash で ImportError 赤→復帰で緑）。backend `tests/ai_jobs`+`tests/ideas` 117 passed／`npm run build` ✓／TC トレーサビリティ ✅ 1131／**実UI目視済**（kanri@acme＝トグル表示・ON/OFF 永続）。設計＝`doc/設計ドラフト/会社別AI動作ポリシー_設計.md`。正本反映＝データモデル §5.67／API S.5b／SC-94 §4.0。残＝F13（e2e・任意低）。
- **自動評価 OFF 時の手動実行（F6 完了・2026-10-10）**＝AI 評価が未生成でも評価者が手動起動できるよう、SC-22 の AI 評価ブロックに**空状態＋「AI評価を実行」ボタン**を追加（`regenerate` EP は未生成でも enqueue する＝backend 無改修で流用・バグでなく仕様）。表示判定＝集計 DTO に **`ai_evaluation_available`**（会社で `idea_evaluate` 既定モデル有効か＝`ai_jobs.application.task_has_enabled_model`）を追加し、`!ai_evaluation && ai_evaluation_available && canEvaluate && !questCompleted` で出す（AI 無効の会社では出さない）。テスト F-TC-223（red-green）・正本＝API F.1/F.7.3・SC-22 §4.6a。**実UI目視済**（kanri evaluator・未生成アイデアでボタン表示）。**F6 を台帳から削除・引継 `2026-10-09_ai評価-有効化と再評価ボタン.md` も消化済で削除**。
- **クエスト「議論の主題」WC が seed で空（F12 完了・2026-10-10）**＝`scripts/bootstrap.py` の発見デモが公開アイデアを直接 INSERT するだけで `entity_tokens(owner_type='idea')` を seed せず、**fresh な demo 会社で SC-12 の語像が常に空**だった（info N-TC-334 の兄弟 DFT・読取は entity_tokens 一本）。修正＝`_seed_idea_tokens`/`_ensure_discovery_idea_tokens`（冪等・既存トークンがあれば触らない）を `seed_demo_discovery` の両分岐（新規＋既存 demo の自己修復）に配線。**migration は不要**（demo-only seed・既存は次回 bootstrap で自己修復／現行共有 DB の acme はライブ活動で既にトークンあり＝WC 稼働確認済）。テスト C-TC-323（DFT・使い捨て id で挿入+冪等を red-green）・end-to-end で demo quest word_cloud 非空を確認。
- **R.4b（経営資料の語像）も充実（2026-10-10・F12 の任意分を実施）**＝調査でデモに**経営資料/コンセプトが0件**と判明（トークン不足ではなく実コンテンツ欠如）。新規 `seed_demo_strategy`（bootstrap）で**経営資料1件＋コンセプト2件**を発見デモクエストに適用し `recompute_for_quest`→idea_alignment を生成＝R.4b 語像が info＋idea＋concept で非空に（end-to-end `related_count=11` 確認）。トークンは全てライブ `persist_entity_tokens`（同一トークナイザ）で付与＝F12 の idea トークンも**ハードコードからトークナイザ抽出に変更**（経営資料⇔アイデアの一致判定が効くように）。テスト R-TC-209（DFT・red-green）。固定UUID で冪等・demo-only・migration 不要。

### 3a. 情報インプット動的タブ D4（大部分実装・コミット多数）
> 以降は前セッション（D6 → info 不具合修正 → D4 を main に積んだ）。
- **設計改訂（変更A/B/C・ユーザー合意）**＝`f451ef04`。予約既定タブ「全般」→「**すべて**」に改名（A）／「すべて」を**特殊タブ化**＝一覧表示時に `tab_id` フィルタを外し**全件表示**（B・1情報=1タブは維持・NULL 化仮想ビュー案は §9-D で不採用）／**タブ間移動を明示機能化**（C・権限＝`info_curator`＋**登録者**・1件＋一括）。設計ドラフト＝`doc/設計ドラフト/情報インプット動的タブ_設計.md`。
- **フェーズA 正本反映**＝`25c30159`。データモデル §5.37c `info_tabs`＋§5.33 `tab_id`/`auto_link_enabled`＋enum／API設計 N.5c／テスト N（N-TC-335〜352）／画面 SC-50 §3b／要件 FR-41 ⑪／画面遷移図。
- **フェーズB backend**＝`00f5b3ce`。migration `0066_info_tabs`（`info_tabs` 作成＋「すべて」system seed＋`info_items.tab_id`(NOT NULL)/`auto_link_enabled` 追加＋既存 backfill＋**tab_id 未指定 INSERT を「すべて」で補完する BEFORE INSERT トリガ**＝他ドメインの incidental な info 作成・既存テストを壊さない安全網）。`app/tenant/info/{orm,repository,application,schemas,router}.py` にタブ CRUD・一覧/word_cloud/facet の tab_id フィルタ・移動1件/一括 EP（`PATCH /info-items/{id}/tab`・`POST /info-items/move-tab`）・予約語/同名/配下非空アーカイブ検証・`manage_tabs`（admin or curator）。テスト `tests/info/test_tabs.py`（**N-TC-335〜349**・15本）。
- **フェーズC frontend**＝`bd1a89bb` ＋ UI 調整群。`features/info-input/`＝`api.ts`/`types.ts`（InfoTab 型・tab 系 API・tabId・auto_link_enabled・manage_tabs）／`components/InfoListView.tsx`（サブタブ帯・溢れ「⋯すべて」ダイアログ `OverflowTabsDialog`・タブ切替で tab_id 絞り・行「タブを移動」）／新規 `MoveTabDialog.tsx`・`TabFormDialog.tsx`（追加/編集・§4.7 検証）／`info-input.css`。
- **UI 調整（ユーザー目視の往復）**＝`11c9c40a`（トップタブと帯を地続き＝`:has(+ .info-subtabs)` で全幅下線/隙間除去・アクティブサブタブ太め下線・**ワードクラウド常時表示＋min-height 12rem で同高**〔語の有無で画面がずれない〕）／`54ad1580`（WC 見出し「よく出る語」を常に左上固定）／`b0a64676`（タブ操作のモック `_サブタブ_タブ操作_検討.html`）／`4fc6316c`（「＋タブ」＝追加専用・各タブは ⋮ で編集/アーカイブ）／`8d09ef4a`（⋮ を**テーブルと同じ RowMenu** に・TabFormDialog を**§4.7**＝保存は常に押せる・空は検証エラー・**無変更保存は info「変更はありません」**で API 呼ばず）／`3329a304`〜`4ab71881`（ホバー背景をラベル＋⋮ 全体に・⋮ 枠線を 1px→撤去・⋮ をタブ名の左へ＝最終は**タブ名の左・枠線なし・青アイコン**）。

### 3b. info ワードクラウド/類似度が seed データで空になる不具合（修正・`5e9aa6d7`）
- 原因＝**bootstrap seed が旧 `info_tokens`（InfoToken）に書き、読取（word_cloud・類似度 `all_info_tokens`）は `entity_tokens`（§5.36b）を見ていた**ズレ。テストは conftest が entity_tokens へ直書きのためすり抜けていた。
- 修正＝`scripts/bootstrap.py` の seed を `EntityToken(owner_type='info')` へ是正／migration `0065_drop_info_tokens`（残存を entity_tokens へ backfill→旧表 drop）／`orm.py` の `InfoToken` 撤去／テスト `tests/info` の cleanup を entity_tokens へ。回帰テスト **N-TC-334**（DFT）。※台帳項目ではない（発見→即修正）。

### 3c. シークレット管理 D6（(A) 完遂・コミット `9200a89c`/`be5a3599`/`6ce2eff9`）
- (A) **ファイル供給基盤**＝`app/core/config.py`（`secrets_dir="/run/secrets"`＋`settings_customise_sources` で **file > env**）／jasper `_secrets.py`（file>env・`hmac.compare_digest`）／`impl/compose.secrets.yaml`（本番オーバーレイ・最小権限）。**本番 fail-closed ガード**＝`insecure_prod_secrets`→`main.lifespan`（dev 既定/空秘密で起動拒否）。
- (A) **SOPS+age 本体 at-rest**＝`impl/.sops.yaml`／`secrets/secrets.template.yaml`／`scripts/decrypt-secrets.sh`（**案1 デプロイ時復号・案2 鍵非常駐・平文 tmpfs・dir0700/file0444・`secrets.enc.yaml` 非コミット**）。運用手順書＝`doc/運用/シークレット管理_手順書.md`。テスト SEC-TC-050〜053／V-TC-212/213。
- **D6 は「部分実装」据え置き**＝残＝(B) AES-GCM DB 暗号（消費者 D3 カメリオ未実装でブロック）・秘密の完全棚卸し。

## 4. 現在の状態（動作 / テスト）
- **D4 は実UIで目視済み**（`kanri@acme.example`）＝サブタブ帯（「すべて」既定・会社タブ）／タブ切替で一覧＆ワードクラウドが tab_id 絞り（「すべて」=全件）／空タブでも WC パネル同高・見出し左上固定／タブ ⋮（RowMenu・ホバー出現・編集/アーカイブ）／「＋タブ」追加ダイアログ（§4.7・空は検証エラー）／溢れ「⋯すべて(N)」＋検索ダイアログ／登録フォームの登録先セレクタ＋auto_link トグル。一般ユーザー（`user@acme`）は「＋タブ」や ⋮ が出ない（読取のみ）。
- **テスト**＝backend `tests/info` **115 passed**＋`test_tabs.py` 15（N-TC-335〜349）／cross-domain（strategy/concepts/evaluations）**151 passed**／`npm run build` ✓ Compiled／vitest `info-input` 7 passed／**TC トレーサビリティ ✅ 1126**。D6 は `tests/core` SEC-TC-050〜053＋jasper `_secrets` V-TC-212/213・回帰 billing/me/admin/core 178 passed（D6 セッション時点）。
- **未検証**＝**e2e `N-TC-350〜352`（D4 frontend）は未実装・未実行**／フル `tests/` 全体は未実行（変更は info/config/jasper に限定して確認）。
- backend/jasper/frontend は `--build` 済みで稼働中。

## 5. 詰まっている点 / 未確認
- **e2e N-TC-350〜352 未実装**＝md に TC 行はあるがコード無し（traceability は code→md 片方向なので ✅ のまま）。実装時は Playwright spec が要る。
- **D4 の一括移動 UI 未実装**＝backend EP（`POST /info-items/move-tab`）とフロント API（`moveInfoItemsTabApi`）はあるが、DataTable の複数選択連携が未。ドラッグ並べ替えも `sort_order` 更新 EP はあるが UI 未。
- ~~**並行セッションの未処理引継が2件ある**（§9）。中身の裏取り・台帳起票は未実施。~~ → **2026-10-10 に裏取り→起票済み**（`D8` プロジェクト管理拡張＝引継1／`F12` クエスト WC seed 空＝引継2／Phase C は既存 `F4` に集約）。両引継は実コードと一致を確認済み。**残＝各項目の実装（未消化）**。

## 6. 決定事項と根拠（本セッション）
- **D4「すべて」＝特殊タブ（表示で tab_id フィルタを外す）**＝1情報=1タブ（NOT NULL）を壊さず全件ビューを得る。NULL 化仮想ビュー案は不採用（§9-D）。
- **tab_id 未指定の BEFORE INSERT トリガで「すべて」補完**＝他ドメインの incidental な info 作成/既存テスト（直 `InfoItem(...)`）を壊さないため（NOT NULL + 外部キーを満たす安全網）。
- **タブ操作 UI＝テーブルと同じ RowMenu**（ユーザー指摘で自前 ⋮ から変更）／**追加・編集ダイアログは §4.7**（保存は常に押せる・空は検証エラー・無変更は info「変更はありません」）＝デザイン標準 line147/§4.7。
- **D6＝案1 デプロイ時復号・案2 鍵非常駐**（セキュリティ優先＝age マスター鍵を runtime に置かない・T4 blast radius 最小）。file>env 反転が核心（env は常在のため）。

## 7. 次にやること（優先順・ファイル/関数レベル）
> 着手前に実コードで裏取り。**残作業の正本＝`doc/バックログ/未実装・ギャップ一覧.md`**。
1. ~~並行セッション引継2件の裏取り→起票~~ → **2026-10-10 完了（起票のみ）**。台帳に `D8`（プロジェクト管理拡張）・`F12`（クエスト WC seed 空）を起票済み／Phase C は既存 `F4` に集約。**次は実装**＝(a) `F12` は小さい seed バグ（`bootstrap.py seed_demo_discovery` に idea トークン seed＋再発防止テスト・未確定=backfill migration 要否）で着手容易／(b) `D8` Phase A（カンバン＋`GET /me/tasks`・DDL 不要）は実用価値が高い。いずれも着手時に台帳記載の**未確定点をユーザー確認**。
2. **D4 残 follow-up**（台帳 D4 の「残」）＝(1) 一括選択移動 UI（`InfoListView` の DataTable multi-select→`moveInfoItemsTabApi`）／(2) タブのドラッグ並べ替え UI（`updateInfoTabApi({sort_order})`）／(3) e2e `N-TC-350〜352`（`impl/frontend/e2e` に spec・`tests/info/test_tabs.py` 相当のフロント版）。
3. **D6 (B)**＝AES-GCM DB 暗号ラッパー（§4-B/§6）＝消費者 D3 カメリオ実装時に併せて（現状ブロック）／秘密の完全棚卸し。
4. **（候補・高優先）ISO ギャップ G2 ポートフォリオ / G3 指標ダッシュボード**（台帳 §2・優先度高・設計ドラフト未作成＝design-first が要る）。
5. **（候補）D2 AI 駆動型アイデア生成 / D3 カメリオ / F6 AI 再評価ボタン表示条件 / F7 concepts レガシー掃除**。
6. 完了時＝`impl/README.md` 現況更新・台帳から完了行削除・handoff 全文更新。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`・帳票 `impl/jasper`）。compose＝`impl/compose.yaml`・本番秘密オーバーレイ `impl/compose.secrets.yaml`。Docker Compose プロジェクト＝`impl`（コンテナ `impl-backend-1` 等）。
- 起動：`cd impl && docker compose up -d`（dev＝env・jasper も既定 up）。backend=`:8000`・frontend=`:3000`・MailHog=`:8025`・MinIO=`:9000/:9001`・db=`:5432`・redis=`:6379`。
- 反映（ソースベイク・volumes 無）：`cd impl && docker compose up -d --build backend|frontend|jasper`。型再生成＝`cd impl/frontend && npm run codegen`（backend 再ビルド後）。
- テスト：
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト・新 migration 反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - jasper `_secrets`＝`cd impl && docker compose run --rm -T -e PYTHONPATH=/jasper -w /jasper -v "$(pwd)/jasper:/jasper" --entrypoint pytest backend tests -q`。
  - frontend `cd impl/frontend && npm run build`（必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium）を作り**使い終わったら削除**。ログインは hydration 待ち必須（`#company_code`/`#login_id`/`#password` を fill 前に ~1.3s）。モック目視は `file://` で `doc/画面設計/mocks/*.html`（shared.css 相対）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`／会社管理 `ACME-01`/`kanri@acme.example`（company_account_admin＝タブ管理可）／OPS `admin@ops.example`（system_admin）。
- **DB/テストデータ注意**＝共有 dev DB は非冪等。**フル e2e は会社DBを DROP→bootstrap する破壊的操作**＝セッション終了目的で実行しない（本セッションも未実行）。tab/UI 目視で一時的に作った `info_tabs`（kind=user）は検証後に `delete from info_tabs where kind='user'` で掃除済み。
- **他セッションとの分離**＝本セッションは `impl` スタック・main 直push で運用。並行セッションが同 main に積む運用のため、push 前に `git log`/`git status` で競合を確認（本セッションは競合なく push 済み）。

## 9. 残作業・並行開発への参照
- 残作業の正本＝**`doc/バックログ/未実装・ギャップ一覧.md`**（本セッションで D4 を「大部分実装」に更新・summary 行更新）。次回確認＝**D4 残 follow-up・D6(B)・ISO G2/G3・D2/D3・F6/F7** 等。
- 並行開発＝`doc/セッション調整/並行開発の取り決め.md`（main 統合順・ブランチ/worktree・Docker/DB 分離）。※記載のブランチ名（`e2e/*`・`feature/*`）が現在も有効かは実行時に確認。
- **引継（別セッション由来）**＝`doc/セッション調整/引継/2026-10-09_プロジェクト管理機能拡張.md`（設計＋引継・コミット `6dcbc4c7`→台帳 `D8`＋`F4`・**未消化のため保持**）。※`2026-10-09_ワードクラウド-クエスト議論の主題がseedで空.md`（→台帳 `F12`）は **2026-10-10 に実装完了で F12 削除・引継も消化削除**。
- その他の既存引継＝`2026-10-09_リッチテキスト2系統統一-tiptap移行.md`（F7 出典）。※`2026-10-09_ai評価-有効化と再評価ボタン.md` は F6 完了（自動評価 OFF 時の手動実行を実装）につき削除済み。
