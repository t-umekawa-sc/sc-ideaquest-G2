# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/バックログ/未実装・ギャップ一覧.md`（未実装/ISOギャップ/follow-up の台帳）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-28（本セッション末）
- ブランチ: `main`（作業ツリー clean）
- push: 本セッションのコミットを **origin/main へ push 済み**（下記コミット群）。
- 本セッションのコミット（新しい順）:
  - `docs(handoff)` 本ファイル全文更新（このコミット）
  - `233e21ba` docs(guide): 画面で見る機能ガイド（操作順×ISO56001対応＋将来機能）
  - `c17f673c` docs(handoff): 前回セッション末の全文更新
  - `fe7db938` feat(list): server一覧(info/quest-catalog)の固定行(ピン)をサーバー解決に対応
  - `02cd9a3b` feat(datatable): 操作列を先頭・左端固定の縦⋮に統一＋一覧のピン留めを有効化
  - `9e9489b3` feat(dialogs): 登録系ダイアログは作成後に閉じて呼び元へ戻る標準に統一
- 直前セッション末＝`bcdecd36`（自動関連付け双方向・列設定はみ出し修正・ISO再チェック・entity_tokens 設計）。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。本セッションは**ユーザー受入で出た UI 不具合の連続改修**（登録ダイアログの遷移・一覧操作列の位置・ピン留め）＋**プレゼン資料（機能ガイド）作成**。

## 3. 今回やったこと（変更ファイルと理由）
すべて実機検証済み。

### A. 登録系ダイアログの閉じ標準（`9e9489b3`）
- 理由＝作成のたびに詳細画面へ飛ばされ、連続作成や呼び元コンテキスト（情報詳細ダイアログ等）を失う受入不具合。
- 標準を `doc/画面設計/デザイン標準.md` §4.1 に明文化＝**作成後は詳細へ遷移せず、閉じて呼び元へ戻る**（指示なき限り）。
- 是正は2箇所のみ（他の作成は元から準拠）＝`impl/frontend/src/features/projects/components/ProjectForm.tsx`（`save()` の作成分岐で `onDone()`・型を `() => void` に締める）と `.../info-input/components/QuestFromInfoPanel.tsx`（`create()` の `onDone()`）。ラッパ `ProjectFormModal.tsx`/`ProjectFormPanel.tsx`/`QuestFromInfoModal.tsx` も呼び元復帰へ。`ProjectListView.tsx` の**複製**も一覧に留めた。
- 回帰＝`impl/frontend/e2e/sc-70-project-create-close.spec.ts`（Q-TC-140・新規）・`sc-50-info-to-quest-draft.spec.ts`（N-TC-226/227・実動線に更新）。台帳＝`doc/テスト/Q_ソリューション開発.md`。

### B. 一覧の操作列を「先頭・左端固定の縦⋮」に統一（`02cd9a3b`）
- 理由＝操作列(⋯)が右端配置だと列幅を広げた時にデータから離れて右端へ浮き、テーブルごとに位置がばらつく受入不具合（DPR1.5・サイドバー非ピンで container≈1120・圧縮状態で再現）。
- `impl/frontend/src/components/ui/DataTable.tsx`＝`visibleCols` で `actionsCol` を**先頭**へ／`widthStyleFor()` で操作列は固定幅・データ列は%按分／`actionW` は上限44px／ピン(📍)は主列（`visibleDataCols[0]`）に添える。`impl/frontend/src/components/ui/RowMenu.tsx`＝トリガを ⋯→**⋮**。`impl/frontend/src/styles/design-system.css`＝`.col-actions` を sticky-left・区切り影右・`text-align:center`・横スクロール重なり z-index／`.rowmenu__trigger.btn-outline` を枠なし太字＋ホバー primary 塗り＋下パディングで上下余白調整。
- client一覧のピン有効化＝`ProjectListView.tsx`・`concepts/components/ConceptTab.tsx`（候補/検証プールの `pins={false}` 削除）。
- 操作列が先頭化したため admin e2e の「先頭セルクリックで会社詳細へ」を名称セル `nth(1)` へ追随＝`sc-92b-accounts.spec.ts`/`sc-92b2-account-edit.spec.ts`/`sc-92c-quest-groups.spec.ts`/`sc-92d-email-verify.spec.ts`。標準＝デザイン標準 §4.1（操作列）/§4.5。

### C. server 一覧のピン（info/quest-catalog）をサーバー解決に対応（`fe7db938`）
- 理由＝server 駆動一覧はピンをサーバーが解決する契約だが、info/quest-catalog の一覧APIが `pin_ids` 未対応で「効かない」受入不具合。管理系(会社/アカウント)は対応済みだった。
- backend info＝`impl/backend/app/tenant/info/repository.py`（`build_info_list_query(exclude_ids=)`・`info_items_by_ids()`）／`application.py`（`get_info_items` で `parse_pin_ids`→固定行解決→pinned 返却）／`router.py`（`pin_ids` 追加）／`schemas.py`（`InfoListResponse.pinned`）。
- backend quest-catalog＝`impl/backend/app/tenant/quests/repository.py`（`build_catalog_query(exclude_ids=, include_ids=)`）／`application.py`（`get_quest_catalog` で pin 解決・**発見門番維持**）／`router.py`／`schemas.py`（`QuestCatalogResponse.pinned`）。
- frontend＝`info-input/api.ts`（`infoListParams` に `pin_ids`）・`InfoListView.tsx`（`serverQuery` が `res.pinned` 返却）・`info-input/types.ts`／`quests/api.ts`（`catalogQueryParams`）・`QuestCatalogView.tsx`。OpenAPI 型は `impl/frontend/src/lib/api/schema.d.ts` を **`npm run codegen`** で再生成。
- テスト＝`impl/backend/tests/info/test_api.py`（N-TC-125/126）・`tests/quests/test_catalog.py`（C-TC-266/267）。台帳＝`doc/テスト/N_情報インプット.md`・`doc/テスト/C_クエスト.md`。

### D. プレゼン資料「機能ガイド」（`233e21ba`）
- `doc/機能ガイド/ideaquest_機能ガイド.md`＝**操作の流れ順に主要10機能**（クエスト→情報インプット→アイデア→評価→コンセプト/検証→開発→意思決定→ゲーム感→版管理/権限→組織運用）を説明し、各機能に **ISO 56001 対応条項**（8.3の5プロセス中心）を併記。末尾に**将来機能**（LLM連携・経営資料整合・ポートフォリオ(6.4)・指標(9.1)・レビュー(9.3)・IP/目標）。ISO 対応の裏取り＝`doc/ISO56001/ISO56001_準拠状況_再チェック_2026-09-28.md`。
- `doc/機能ガイド/_build_pdf.py`＝md→参照PDF風HTML→chromium で PDF 生成。出力 PDF は `.gitignore` 追跡外。参照体裁＝ユーザー提供の `AI人事異動システム_画面で見る機能ガイド.pdf`。

## 4. 現在の状態
- 動いている（本セッションで確認済み）:
  - 登録ダイアログ＝作成後に一覧/情報詳細ダイアログへ戻る（e2e 実測）。
  - 操作列＝全一覧で先頭・左端固定・縦⋮・狭幅・ホバー強調（実測スクショ）。
  - ピン＝client（プロジェクト/コンセプト/検証プール）と server（情報インプット/クエストを探す）でクリック→固定行を実測。
  - 機能ガイド PDF＝5ページ生成を確認（`doc/機能ガイド/ideaquest_機能ガイド.pdf`・`C:\Users\t-umekawa\Downloads\` にもコピー）。
- テスト通過状況（本セッションで実行したもの）:
  - backend `pytest tests/info tests/quests/test_catalog.py` = **101 passed**（pin 含む・`-v`マウント）。
  - backend pin 抜粋（N-TC-125/126・C-TC-266/267）= 26 passed。
  - セッション冒頭の照合＝`pytest tests/info tests/ideas tests/concepts` = **236 passed**。
  - e2e＝`sc-70`/`sc-50-info-to-quest-draft`/`sc-92b/b2/c/d`/`sc-10-list-state`/`sc-90/91/92/93`/`sc-50-info-list` を通過（39+ spec）。server ピンは tmp spec で実測（削除済み）。
  - `python3 scripts/check_tc_traceability.py` = ✅（874件）。frontend 本番ビルド（型・lint）通過。
- 壊れているもの＝**確認範囲では無し**。
- 未確認＝**backend フル pytest** と **Playwright e2e フルスイート**（本セッションはドメイン/画面単位のみ）。

## 5. 詰まっている点（試して失敗した/落とし穴）
- **flex-primary（主列が余白吸収）は圧縮環境で無効**＝container が 1120 にキャップされ projects の自然幅合計 1216>1120＝余白が無いため効かず。ユーザー提案の**左端⋮**へ転換（採用せず＝§6）。
- **server ピンの standalone 二重エッジ**＝情報詳細を**直リロード後に soft-nav**で新クエストを作ると URL が `/new-quest` に留まる現象。実動線（一覧→情報詳細ダイアログ→新クエスト）と直リンクは正常＝まれな二重エッジのみ（許容・未修正）。
- **PDF 生成**＝chromium の `page-break-inside: avoid` が「1機能=1ページ」を強制し11ページ化→**外して5ページ**に。既定のヘッダー(日付)/フッター(URL)は `chromium --headless=new --no-pdf-header-footer` で除去。snap chromium の dbus/mount 警告は無害。
- **e2e は共有 dev DB（`ideaquest_company_acme`）を叩く**ため、当セッションで溜まったテストデータ（`採否情報_`/`PROBE`/`逆方向スモーク` の info_items 9件）が古い seed 項目を後ろページへ押し出し `N-TC-203`（見出し追従）が一時 fail→psql で子表（`info_item_categories`/`info_item_revisions`/`info_attachments`/`info_links`/`info_tokens`）→`info_items` の順に物理削除で解消。以後も共有DB汚染に注意。

## 6. 決定事項と根拠
- **登録ダイアログは閉じて呼び元へ**（§3A）＝連続作成・呼び元コンテキスト保持。例外＝「作成後すぐ詳細で本設定」動線のみコメント付きで遷移可。
- **操作列は先頭・左端固定・縦⋮**（§3B）＝位置を列幅/画面幅に依存させない。全一覧の操作列は例外なく `RowMenu`(⋮) のみと確認済み（単一リンク無し）ため一律で狭くして安全。
- **server ピンは発見門番を壊さない**（§3C）＝quest-catalog は `include_ids` で対象IDへ絞りつつ `_discoverable_conds` を維持（可視でないクエストは pin でも返さない）。
- **機能ガイドは md を正・chromium で PDF・PDF は追跡外**。
- **不採用**＝flex-primary（圧縮環境で無効・§5）。当初の flex-primary 実装は §3B のコミットで撤回済み。

## 7. 次にやること（優先順・具体的に）
1. **残ピン（任意）**＝**`impl/frontend/src/features/shop/components/ShopView.tsx`（server）はピン未対応**。必要なら §3C と同パターンで shop 系の application/repository/router/schema（backend）＋ `shop` の api params/serverQuery（frontend）に `pin_ids` を通す。`ProjectDetailView.tsx` の WBS タスク（tree）は `pins={false}` 据置（ツリーとピンの相性・要検討）。
2. **entity_tokens 基盤の実装**（前セッションからの継続・経営資料整合フェーズの土台）＝migration `impl/backend/migrations/company/versions/0044_entity_tokens.py`（`entity_tokens` 作成＋既存 `info_tokens` を `owner_type='info'` で移送。company head は現在 `0043_project_groups`）／ORM `EntityToken`／repo 汎用化（`replace_tokens`/`tokens_for`/`all_tokens_by_type`）／info 側 token 参照（`app/tenant/info/repository.py` の word cloud/`all_info_tokens`）を `entity_tokens` 経由へ／idea 公開・concept 作成更新で token 永続化／自動関連付け（`app/tenant/info/application.py` の `_recompute_auto_links`/`recompute_auto_links_for_target`）を entity_tokens 読取へ＝**情報保存側の候補都度抽出を撤廃**。正＝`doc/データモデル.md` §5.36b。
3. **経営資料整合 Phase1**（entity_tokens 後）＝経営資料エンティティ（ISO構造化入力）→整合率→コイン→機会/脅威率→AI用Markdownエクスポート。正＝`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`。
4. **LLM（生成AI）連携**（将来・機能ガイドに記載）＝経営資料整合 Phase2 の整合率セマンティック算出・アイデア/コンセプト要約/発想支援・機会/脅威判定補助。オンプレ無料LLM既定・クラウド任意。
5. **ISO ギャップ（任意・価値高）**＝6.4 ポートフォリオ・9.1 指標ダッシュボード・9.3 マネジメントレビュー。正＝`doc/ISO56001/ISO56001_準拠状況_再チェック_2026-09-28.md` §3。
6. **回帰**＝着手前に backend フル pytest（`-v`マウント・mail-worker 停止）と Playwright e2e フルを通す（本セッション未実行）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（このシェルは cd が持続しない）。
- フル起動＝`cd impl && docker compose up -d --build`。フロント反映＝`up -d --build frontend`／backend 反映＝`up -d --build backend`。**server 一覧の型は backend 変更後に `cd impl/frontend && npm run codegen`（`http://localhost:8000/openapi.json`→`src/lib/api/schema.d.ts`）で再生成**してから frontend ビルド。
- 非同期 e2e（sc-90 のディレクトリ・sc-00 の mail）＝`docker compose --profile workers up -d`（既定 up では worker 非起動）。**pytest 時は mail 競合回避に `docker compose stop worker mail-worker`**。※本セッション末は `--profile workers` を起動したまま。
- backend pytest（未コミット編集反映＝`-v`マウント・cwd=impl）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/info -q`（対象を絞る）。
- frontend 検証＝`cd impl/frontend && npm run build`（tsc/lint 兼）。e2e＝`npx playwright test <spec> --project=chromium`（storageState 認証・auth.setup 先行）。**ユーザー環境再現＝`deviceScaleFactor:1.5`（Win150%）＋サイドバー非ピン（`localStorage.iq_nav_pinned="0"`）**。列設定/操作列はリスト表示で出現。
- TC トレーサビリティ＝リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート）。
- ポート＝frontend `:3000`／backend `:8000`／MailHog `:8025`。ログイン（ACME）＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者＝`kanri@acme`(company_account_admin)・`admin@ops`(system_admin)。
- DB 直確認＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。info_items 子表＝`info_item_categories`/`info_item_revisions`/`info_attachments`/`info_links`/`info_tokens`。
- **機能ガイド PDF の再生成**＝`cd doc/機能ガイド && python3 _build_pdf.py && chromium --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf="ideaquest_機能ガイド.pdf" "ideaquest_機能ガイド.html"`（中間 HTML は生成後に削除可）。md が正・PDF は追跡外。
- Playwright の使い捨て spec は `impl/frontend/e2e/tmp-*.spec.ts` で作り確認後に削除（本セッションで多用・すべて削除済み）。スクショ出力先 `impl/frontend/tmp_shots/`（.gitignore 済）。
