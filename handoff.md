# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`、**残作業の正本は `doc/バックログ/未実装・ギャップ一覧.md`**。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-09（リッチテキスト TipTap 移行セッション）。
- ブランチ: `main`（main 直 push が慣習・毎コミット push 済み）。
- 最新コミット: リッチテキスト TipTap 移行＝サニタイズ中核（`1f95aae9`）＋お知らせ縦スライス（TT1/TT2・`7cc72c03`）＋情報インプット縦スライス（TT0b-items/TT3・本コミット群）。working tree は push 後 clean の想定。
- alembic heads: company=**`0062_info_items_pm_json`（今セッションで追加＝情報本文 PM-JSON 化／`0061`＝お知らせ）**／control=`0020_signup_challenges`（変更なし）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘の消化＋仕様確定済み未実装機能の処理。

## 3. 今回やったこと（新しい順・理由つき）
0b. **リッチテキスト TipTap 移行＝情報インプット縦スライス（TT0b-items/TT3）を完了**（お知らせと同型）。
   - backend＝migration **0062**（`info_items.body` jsonb 正本・`body_html`/`body_text` は `pm_to_html`/`pm_to_text` 派生）＋`InfoCreate/Update/DetailDTO` を `body` 授受へ＋`create_info_item`/`update_info_item` を `sanitize_pm`→派生へ＋`repository.create_info_item(body=...)`＋`derive.py` 再エクスポート。**版管理は無改修**（スナップショットは派生 `body_html` 保持＝`changed_fields=["body_html"]` 不変）。**自動リンク/全文検索も不変**（`body_text` 経由）。**info_templates は未変更**（TT4 で SC-55 と一体）。
   - frontend＝`InfoFormPanel.tsx`/`InfoDetailView.tsx` の独自 contentEditable を共有 `RichTextEditor`（PM-JSON）へ＋word cloud/要約は `wordcloud.pmText`（client 版 PM→平文）＋手書き型 `InfoInput`/`InfoPatch`/`InfoDetail` を `body` へ（info は codegen 非依存の手書き型）。
   - 検証＝`tests/info` **99**・回帰 **166 passed**・build/vitest green・情報登録フォームで TipTap＋word cloud を Playwright 目視（エラー0）。
0. **リッチテキスト TipTap 移行＝セキュリティ中核＋共有エディタ＋お知らせ縦スライス（TT-sec/TT1/TT2）を完了**（§6 の決定に基づく・security-first で保存境界から着手）。
   - **(TT-sec) 保存境界サニタイズ中核**＝`app/core/richtext.py` に `sanitize_pm`（PM-JSON 許可リスト検証→canonical・冪等）/`pm_to_html`（決定的直列化・内部で必ず sanitize＝多層防御）/`pm_to_text`（平文＝全文検索）。TC＝新ドメイン `doc/テスト/W_リッチテキスト.md` **W-TC-001〜015**（test-first・red15→green15・commit `1f95aae9`）。
   - **(TT1) 共有 TipTap エディタ**＝`components/richtext/RichTextEditorImpl.tsx`（TipTap v3・StarterKit〔underline無効/link設定〕＋Image＋TableKit・`preset:document|chat`・value=PM-JSON）＋`RichTextEditor.tsx`＝**`next/dynamic` ssr:false ラッパ（§4-4=A）**＋`richtext.css`（ProseMirror）。`RichTextView` は server-sanitized HTML 描画のまま（SSR 可・無改修）。deps＝`@tiptap/react|starter-kit|pm|extension-image|extension-table`（package.json・lock は gitignore）。
   - **(TT2) お知らせ縦スライス**＝migration **0061**（`announcements.body` jsonb 正本・`body_html`/`body_text` は派生へ）＋orm/schemas/application/router を PM-JSON 授受へ＋`AnnouncementAdminView` を PM-JSON 化＋codegen。U-TC-106 を悪性 PM-JSON 無害化へ改訂。
   - 検証＝回帰 announcements/core/info/dashboard/search **166 passed**・build green・vitest **258**・トレーサビリティ **✅1097**・お知らせ作成モーダルで TipTap 描画を Playwright 目視（エラー0）。
1. **D5 情報インプット テンプレート機能の設計反映＋backend＋テスト＋モックを完了**（commit `6ed3fab0`＝backend/設計/テスト、`ef4511ab`＝モック）。
   - 設計反映（正本）＝FR-41 に ⑩内部情報テンプレートを追記（`doc/要件定義/README.md`）／データモデル `§5.37b info_templates`＋`info_items.source_template_id`（`doc/データモデル.md`）／API `N.5b`（7 EP・`doc/API設計/N_情報インプット.md`）／画面 SC-51 `§6b` ピッカー＋**新規 SC-55 テンプレート管理**（`doc/画面設計/screens/SC-50_情報インプット.md`・新規 `SC-55_情報テンプレート管理.md`）＋画面遷移図／テスト md `N-TC-300〜326`（`doc/テスト/N_情報インプット.md`）。
   - backend（既存 `impl/backend/app/tenant/info/` に4層追加）＝migration `migrations/company/versions/0060_info_templates.py`（`info_templates` 表＋`info_items.source_template_id`・部分一意 `UNIQUE(name) WHERE deleted_at IS NULL`）／`orm.py`（`InfoTemplate`＋`InfoItem.source_template_id`）／`schemas.py`（検証用 enum frozenset 群＋`TEMPLATE_DEFAULT_SCALARS`＋テンプレ DTO 群）／`repository.py`（`create_template`/`get_template`/`template_name_exists`/`list_active_templates`/`list_templates_admin`/`soft_delete_template`＋`create_info_item` に `source_template_id`）／`application.py`（`_validate_template_defaults`・`list_templates_for_picker`/`get_template_detail`/`list_templates_admin`/`create_template`/`update_template`/`set_template_active`/`delete_template`・nh3 サニタイズは `derive.sanitize_html`）／`router.py`（7 EP＝ピッカー/詳細=`require_me`・`admin=1`/書込=`require_company_account_admin`＋CSRF/Origin）。
   - テスト＝`tests/info/test_templates.py` 19件（repository/application/API）。red-green 実測済（`_validate_template_defaults` を一時バイパスで N-TC-311/312/313 を赤→復元で緑）。
   - モック（フロント実装フロー規約＝モック先行）＝`doc/画面設計/mocks/SC-55_情報テンプレート管理.html`（新規・DataTable＋登録/編集モーダル）／`SC-50_情報インプット.html`（§6b ピッカー追記＝新規時のみ表示・{{today}}展開・上書き確認）。headless Chromium で JSエラー0＋適用動作を確認済み。
2. **セッション末にリッチテキスト統一（TipTap 移行）を確認し、D5 frontend の進め方を転換**（コードはまだ無し・**決定のみ**）。引継＝`doc/セッション調整/引継/2026-10-09_リッチテキスト2系統統一-tiptap移行.md`／設計＝`doc/設計ドラフト/リッチテキスト2系統統一(TipTap移行)_設計.md`。バックログ台帳に `1-b. TipTap 移行（TT0〜TT5）` を出典付きで起票し、D5 行を「設計+backend+テスト済／frontend は TipTap 待ち」へ更新。

## 4. 現在の状態（動作 / テスト）
- **backend/frontend とも今セッションで `up -d --build` 済み＝新コード稼働中**（お知らせ PM-JSON EP・TipTap エディタとも提供中）。お知らせ作成モーダルで TipTap を Playwright 目視済み（エラー0）。
- 今セッションで green を確認＝`tests/core/test_richtext_pm.py` 15件・`tests/announcements` 14件・`tests/info` 99件・回帰 info/announcements/core/dashboard/search **166 passed**・frontend build green・vitest **258 passed**。**フル `tests/` 全体は未実行＝未確認**。
- migration `0061`（お知らせ `body`）・`0062`（情報 `body`）は company DB（acme/acme2/demo）に `up -d --build` の bootstrap で適用済み。
- **TC トレーサビリティ ✅ 1097**（`python3 scripts/check_tc_traceability.py`・リポジトリルート）。
- **D5 SC-55 frontend（`impl/frontend/src/features/info-templates`）は未着手**（TT4・共有エディタは利用可能に）。**info_templates の PM-JSON 化も未**（TT4 で SC-55 と一体）。**チャット（TT5）も未**＝plain のまま。お知らせ・情報インプットは移行済。

## 5. 詰まっている点（試して失敗・回避策）
- **TipTap v3＝StarterKit が link/underline を内包**（v2 と違う）。document プリセットで追加が要るのは Image と `TableKit`（`@tiptap/extension-table` の `TableKit` が table/row/header/cell を一括）。underline は backend 許可リスト外なので `StarterKit.configure({ underline:false })` で無効化し整合させる。
- **TipTap の link `HTMLAttributes` 等を `as const` にすると型エラー**＝`protocols` が readonly 配列になり `Partial<LinkOptions>` に不一致。`as const` を外す。
- **PM-JSON の `body_text`（平文）はユーザーが文字入力した `<` を残す**＝正しい挙動（タグではない）。XSS ではない（抜粋は React が `{excerpt}` でエスケープ描画）。テストで `"<" not in text` と書くと誤判定＝構造タグ（`<strong>`/`<p>`）の非在で検証する。
- **frontend の `package-lock.json` は gitignore**＝TipTap 依存は `package.json` のみ commit（コンテナ build 時に resolve）。
- **info-input feature は手書き型**（`api.ts` の `InfoInput`/`InfoPatch`・`types.ts` の `InfoDetail`）＝codegen 非依存。PM-JSON 化では手で `body` へ直す（announcements は生成型 schema.d.ts で codegen だけで済む・対照的）。
- **版管理（`info_item_revisions`）は PM-JSON 化でも無改修**＝スナップショット `_content_snapshot` が派生 `body_html` を保持し、`INFO_REVISION_FIELDS` も `body_html` のまま＝`changed_fields` は `body_html` を報告し続ける（版は表示用 HTML 履歴ゆえ正しい）。content 変更検知は `_CONTENT_FIELDS` を `body` に変えるだけ。
- **`AppError` の属性は `.status`**（`.status_code` ではない）＝テストで一度踏んだ（`app/core/errors.py:71`）。
- **テンプレテストの teardown FK 順序**＝`info_items` を消す前に `info_item_revisions`/`entity_tokens(owner_type='info')`/`info_links`/`info_item_categories` を消す（`create_info_item` が版/トークン/auto リンクを作るため）。さらに **factory 由来の管理者アカウント（`tpl_admin`）の会社DB users を消す前に、その管理者が作った `info_templates` を消す**必要があり、API テストは fixture 引数順を `(client, tpl_admin, tpl_ctx)` にして teardown 順（tpl_ctx が先）を担保した。
- **`defaults` のカテゴリキー名**＝設計ドラフトは `category_ids[]` だが、実装は `info_items` と同じ `categories`（`info_category` enum コード配列）に統一。データモデル/API/テスト md も `categories` に修正済み（ドラフトのみ旧名が残置＝歴史）。
- **共有 dev DB のノイズ**（継続）＝テンプレ名は毎回一意化（uuid 接尾）し、作成した template/info_item は teardown で物理削除。

## 6. 決定事項と根拠
- **SC-55 採番**＝情報ファミリ（SC-50/51/52）に隣接する空き番号。会社マスタだが情報機能の一部のため 5x 系。
- **`info_templates` と `info_items` は疎結合**＝登録後の情報はテンプレを参照せず不変。由来のみ `source_template_id`（NULL 許容 FK）に記録。存在しない id は NULL 無視、論理削除済み id は行が残るので記録（`create_info_item` で `get_template(include_deleted=True)` で解決）。
- **テンプレ管理＝会社管理者**（`require_company_account_admin`＝`company_account_admin`/`system_admin`）、**閲覧/適用＝会社内 active 全員**（`require_me`）。`admin=1` 一覧は1ルートでロール再検証。
- **【重要・方針転換 2026-10-09】リッチテキストは TipTap に全面移行してから D5 frontend を実装**。
  - 範囲＝**全部（TT1〜TT5）やり切る**（ユーザー決定）。
  - **保存形式＝PM-JSON（設計 §4-2 の選択肢2）**。§4 既定案（HTML 据え置き）は**不採用**。理由＝richtext は死活要件で将来拡張（表/画像/協調 Yjs）・直列化の決定性・サニタイズ相性で PM-JSON が優位。最大の難点だった「既存 `body_html` のデータ移行コスト」は**既存データ全削除可（全てテストデータ・ユーザー言明）**で消えるため、PM-JSON が妥当。→ ユーザーの問い「より良い対応は2で良い？」への回答＝**Yes（2=PM-JSON を推奨・採用）**。
  - document プリセットの拡張＝**基本（見出し/リスト/強調/リンク/引用）＋画像(MinIO 再ホスト)＋表＋コードブロック**。チャットは軽量プリセット。
  - チャット（TT5）は最後＝当面 plain 据え置き、メンション契約 E-TC-211/229 を移植してからノード化。
  - **§4-4 バンドル/SSR＝決定済（A・ユーザー 2026-10-09）＝実装済**＝`RichTextEditor` は `next/dynamic` の `ssr:false` で TipTap 本体（`RichTextEditorImpl`）を遅延ロード／`RichTextView` は SSR 可（server-sanitized HTML 描画）。初期バンドルはエディタ搭載画面に局所化（build 済・お知らせ管理で確認）。

## 7. 次にやること（優先順・ファイル/関数レベル）
> 着手前に実コードで裏取り。残作業の正本＝`doc/バックログ/未実装・ギャップ一覧.md`（`1-b` の TT4/TT5）。**TT-sec/TT1/TT2/TT0b-items/TT3 は完了済み**（§3-0b/0）。パターンは縦スライス（migration で `body` jsonb 追加＝正本・`body_html`/`body_text` は `pm_to_html`/`pm_to_text` 派生・書込経路で `sanitize_pm`・frontend は共有 `RichTextEditor`〔PM-JSON〕）。announcements（0061）・info_items（0062）が参照実装。

1. **TT4＝D5 frontend 本実装＋info_templates の PM-JSON 化（一体）**＝(a) backend＝`info_templates.body_html` に `body` jsonb を追加する migration（0062 と同型）＋`create_template`/`update_template`（`application.py:1375/1419`）を `sanitize_pm`→`pm_to_html` 派生へ＋テンプレ DTO に `body`。(b) frontend＝共有エディタの上で `features/info-templates`（新規・SC-55）＝一覧（`GET /info-templates?admin=1` DataTable サーバー委譲）＋URL 付きモーダル（登録/編集・本文ひな形＝共有 `RichTextEditor`・属性既定＋カテゴリ）＋有効無効/複製/論理削除。SC-51 ピッカー結線＝`InfoFormPanel.tsx` に「テンプレートから作成」（テンプレ `body`〔PM-JSON〕を適用＋{{today}} クライアント展開）。モック＝`doc/画面設計/mocks/SC-55_*.html`・`SC-50_*.html`。受入ゲート＝ユーザー動作確認。
2. **TT5 チャット（最後・別EP）**＝`features/chat/components/IdeaChatView.tsx`・`features/chat/render.ts`＋`render.test.ts`。chat プリセット（実装済）へ置換＋**メンション拡張を追加**（`@tiptap/extension-mention`・`sanitize_pm` の mention ノードと整合済）＋E-TC-211/229 契約移植。ideas/concepts へ波及注意（memory `chat-thread-independence`）。
3. 完了時＝`impl/README.md` 現況更新・バックログ台帳から完了行削除・handoff 全文更新。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。compose は `impl/compose.yaml`。
- 起動：`cd impl && docker compose up -d`。backend=`:8000`・frontend=`:3000`・openapi=`:8000/openapi.json`・MailHog=`:8025`・MinIO=`:9000`/コンソール`:9001`。
- **反映（ソースベイク・volumes 無）**：`cd impl && docker compose up -d --build backend|frontend`。env だけ変えた時は `docker compose up -d backend`（再ビルド不要）。型再生成＝`cd impl/frontend && npm run codegen`（backend 再ビルド後）。
- テスト：
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`（entrypoint が bootstrap=migrate+seed→pytest）。今セッションのテンプレテストはこの方式で green。
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium）を作り**使い終わったら削除**。モックの目視は `file:///.../doc/画面設計/mocks/SC-xx_*.html` を chromium で開く（shared.js の DataTable/iqSnack/iqConfirm が動く）。
