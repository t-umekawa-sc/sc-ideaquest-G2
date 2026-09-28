# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/バックログ/未実装・ギャップ一覧.md`（未実装/ISOギャップ/follow-up の台帳）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-28（本セッション末）
- ブランチ: `main`（作業ツリー clean・本セッションのコミットは未 push）
- 本セッションの主なコミット（新しい順）:
  - `docs(handoff)` 本ファイル全文更新（このコミット）
  - `fe7db938` feat(list): server一覧(info/quest-catalog)の固定行(ピン)をサーバー解決に対応
  - `02cd9a3b` feat(datatable): 操作列を先頭・左端固定の縦⋮に統一＋一覧のピン留めを有効化
  - `9e9489b3` feat(dialogs): 登録系ダイアログは作成後に閉じて呼び元へ戻る標準に統一
- 前セッション末＝`bcdecd36`（自動関連付け双方向・列設定はみ出し修正・ISO再チェック・entity_tokens 設計）。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。本セッションは**ユーザー受入で出た UI 不具合の連続改修**（登録ダイアログの遷移・一覧操作列の位置・ピン留め）。

## 3. 今回やったこと（3コミット・すべて実機検証済み）
すべて設計書ファースト＋テスト同梱（テスト規約 §5）。

### A. 登録系ダイアログの閉じ標準（`9e9489b3`）＝デザイン標準 §4.1 に明文化
- **登録系（作成）ダイアログは指示なき限り作成後に詳細へ遷移せず、閉じて呼び元へ戻る**（一覧から開いたら一覧・情報詳細ダイアログから開いたらその詳細へ）。作成結果はトースト＋一覧再取得で伝える。
- 是正箇所は2つだけ（他の Concept/Idea/Info/Task/Quest 作成は元から準拠）＝`ProjectForm`（作成→`/projects`）・`QuestFromInfoPanel`（作成→呼び元の情報詳細ダイアログ）。`ProjectListView` の**複製**も一覧に留めた。`ProjectForm.onDone` の型を `() => void` に締めて誤用（詳細URL渡し）を構造的に防止。
- 回帰＝**Q-TC-140**（新規 `e2e/sc-70-project-create-close.spec.ts`）・**N-TC-226/227**（実動線＝一覧→情報詳細ダイアログ→新クエスト→情報詳細ダイアログに戻る、へ更新）。

### B. 一覧の操作列を「先頭・左端固定の縦⋮」に統一（`02cd9a3b`）＝デザイン標準 §4.1（操作列）/§4.5
- **背景**＝操作列(⋯)が右端配置だと、列幅を広げた時にデータから離れて右端へ浮き、テーブルごとに位置がばらつく不具合（ユーザー受入・DPR1.5/サイドバー非ピンで container≈1120・圧縮状態で再現）。
- **対応**＝`DataTable` が `actions:true` 列を**自動的に先頭へ配置**（各一覧の列定義は末尾のままでよい）・**sticky-left・固定幅(≤44px)・縦⋮**（`RowMenu` の ⋯→⋮）・枠なし太字中央・**ホバー/フォーカス/展開中は primary 塗り＋白⋮**・横スクロールでデータの上に重なる z-index（⋮メニューは createPortal で埋もれない）。行固定ピン(📍)は操作列ではなく主列に添える。
- 操作列が先頭化したため **admin e2e の「先頭セルクリックで会社詳細へ」を名称セル `nth(1)` へ追随**（`sc-92b/b2/c/d`）。
- 撤回＝当初試した flex-primary（主列が余白吸収）は、container が 1120 にキャップされ projects の自然幅合計 1216>1120＝**圧縮状態で余白が無い**ため効かず、ユーザー提案の左端⋮に転換（`git log` 参照）。

### C. 一覧のピン留め（`02cd9a3b` client＋`fe7db938` server）
- **client モード**（`data=`）＝`pins={false}` を解除し有効化＝**プロジェクト一覧・コンセプト（候補）・検証プール（前提）**。DataTable がクライアント側で固定。
- **server モード**（`server=`）＝ピンはサーバーが `pin_ids` を解決して `pinned[]` を返す契約。`GET /info-items`・`GET /quest-catalog` に **`pin_ids` 対応を新規実装**（管理系 `list_query.parse_pin_ids` パターン踏襲）。repository に `exclude_ids`/`include_ids`、application で pin 解決（絞込/ページ無関係・pin 順）。**quest-catalog は発見門番を維持**（非discoverable は pin でも返さない＝漏洩防止）。frontend＝`infoListParams`/`catalogQueryParams` に pin_ids 送出・`serverQuery` が `res.pinned` 返却・OpenAPI 型を `npm run codegen` で再生成。
- テスト＝**N-TC-125/126**（info・md 先行→実装）・**C-TC-266/267**（catalog）。

## 4. 現在の状態（検証済み）
- テスト（本セッションで実行）:
  - backend `pytest tests/info tests/quests/test_catalog.py` = **101 passed**（pin 含む・回帰なし・`-v`マウント実行）。
  - backend `pytest tests/info/test_api.py tests/quests/test_catalog.py -k "pin or catalog"` = 26 passed。
  - セッション冒頭の照合＝`pytest tests/info tests/ideas tests/concepts` = **236 passed**。
  - e2e＝`sc-70`/`sc-50-info-to-quest-draft`/`sc-92b/b2/c/d`/`sc-10-list-state`/`sc-90/91/92/93`/`sc-50-info-list` を通過（39+ spec）。info・quest-catalog のピン動作を実測（クリック→固定行1件）。
  - `python3 scripts/check_tc_traceability.py` = ✅（874件）。frontend 本番ビルド（型・lint）通過。
- 壊れているもの＝無し。

## 5. 詰まっている点 / 注意（試して失敗した/落とし穴）
- **e2e は共有 dev DB（`ideaquest_company_acme`）を叩く**ため、当セッションで溜まったテストデータ（`採否情報_`/`PROBE`/`逆方向スモーク` の info_items 9件）が古い seed 項目を後ろのページへ押し出し、`N-TC-203`（見出し追従）が一時 fail→**物理削除で解消**（psql で `info_item_categories`/`info_item_revisions`/`info_attachments`/`info_links`/`info_tokens`→`info_items` の順に削除）。以後も共有DB汚染に注意。
- **`--profile workers` を起動中**（`sc-90` のディレクトリ参加＝account_sync worker 依存の e2e 確認のため）。**次に backend pytest を回す時は mail-worker を止める**（mail 競合で mail 系 TC がフレーク化＝`compose.yaml` 冒頭の注意）。停止＝`docker compose stop worker mail-worker`。
- flex-primary（主列吸収）は圧縮環境では無効＝§3B の通り左端⋮へ転換済み。

## 6. 決定事項と根拠
- **登録ダイアログ標準（§3A）**＝作成後は詳細へ遷移せず閉じて呼び元へ（連続作成・呼び元コンテキスト保持）。例外＝「作成後すぐ詳細で本設定する」動線のみコメント付きで遷移可。実装＝RouteModal は `close()`（router.back）／フルページは呼び元へ push。
- **操作列は先頭・左端固定の縦⋮（§3B）**＝位置を列幅/画面幅に依存させない（右端は浮く）。全一覧の操作列は例外なく `RowMenu`(⋮) のみと確認済み（単一リンクは無い）ため一律で狭くして安全。
- **server ピンは発見門番を壊さない（§3C）**＝quest-catalog は `include_ids` で対象IDへ絞りつつ `_discoverable_conds` を維持（可視でないクエストは pin でも返さない）。

## 7. 次にやること（優先順）
1. **ユーザーの最終ブラウザ受入**（本コミット群の見た目・挙動）。指摘があれば微調整。
2. **push 判断**（現状 main にコミット済み・未 push）。
3. **残ピン（任意）**＝server 一覧のうち **ショップ（`ShopView`・server）** はピン未対応（必要なら §3C と同パターン）。会社/アカウント一覧（admin）は対応済み。project detail の WBS タスク（tree）は `pins={false}` 据置（ツリーとピンの相性・要検討）。
4. **entity_tokens 基盤の実装**（前セッションからの継続・`doc/データモデル.md` §5.36b・経営資料整合フェーズの土台）＝migration `0044_entity_tokens`／`info_tokens`→`entity_tokens(owner_type)` 移送／自動関連付けの情報保存側候補都度抽出を撤廃。company head=`0043_project_groups`。
5. **経営資料整合 Phase1**（entity_tokens 後）＝正＝`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`。
6. **回帰**＝着手前に backend フル pytest（`-v`マウント・mail-worker 停止）と Playwright e2e フルを通す（本セッションはドメイン単位のみ実行）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（このシェルは cd が持続しない）。
- フル起動＝`cd impl && docker compose up -d --build`。フロント反映＝`up -d --build frontend`／backend 反映＝`up -d --build backend`。**server 一覧の型は backend 変更後に `cd impl/frontend && npm run codegen`（`http://localhost:8000/openapi.json`→`src/lib/api/schema.d.ts`）で再生成**してから frontend ビルド。
- 非同期 e2e（sc-90 のディレクトリ・sc-00 の mail）＝`docker compose --profile workers up -d`（既定 up では worker 非起動）。**pytest 時は mail-worker 停止**。
- backend pytest（未コミット編集反映＝`-v`マウント・cwd=impl）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/info -q`。
- frontend 検証＝`cd impl/frontend && npm run build`（tsc/lint 兼）。e2e＝`npx playwright test <spec> --project=chromium`（storageState 認証・auth.setup 先行）。**ユーザー環境再現＝`deviceScaleFactor:1.5`（Win150%）＋サイドバー非ピン（`localStorage.iq_nav_pinned="0"`）**。列設定/操作列はリスト表示で出現。
- TC トレーサビリティ＝リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート）。
- ポート＝frontend `:3000`／backend `:8000`／MailHog `:8025`。ログイン（ACME）＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者＝`kanri@acme`(company_account_admin)・`admin@ops`(system_admin)。
- DB 直確認＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。info_items を参照する子表＝`info_item_categories`/`info_item_revisions`/`info_attachments`/`info_links`/`info_tokens`。
- Playwright 検証の使い捨て spec は `impl/frontend/e2e/tmp-*.spec.ts` で作り、確認後に削除（本セッションで多用・すべて削除済み）。スクショ出力先 `impl/frontend/tmp_shots/`（.gitignore 済）。
