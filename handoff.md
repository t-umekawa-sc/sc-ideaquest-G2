# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`、**残作業の正本は `doc/バックログ/未実装・ギャップ一覧.md`**。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-09（セッション末）。
- ブランチ: `main`（main 直 push が慣習・毎コミット push 済み）。
- 最新コミット: 本 handoff＋バックログ台帳更新（この直前＝`ef4511ab` モック／`6ed3fab0` テンプレ backend＋設計＋テスト）。working tree は push 後 clean の想定。
- alembic heads: company=**`0060_info_templates`（今セッションで追加）**／control=`0020_signup_challenges`（変更なし）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘の消化＋仕様確定済み未実装機能の処理。

## 3. 今回やったこと（新しい順・理由つき）
1. **D5 情報インプット テンプレート機能の設計反映＋backend＋テスト＋モックを完了**（commit `6ed3fab0`＝backend/設計/テスト、`ef4511ab`＝モック）。
   - 設計反映（正本）＝FR-41 に ⑩内部情報テンプレートを追記（`doc/要件定義/README.md`）／データモデル `§5.37b info_templates`＋`info_items.source_template_id`（`doc/データモデル.md`）／API `N.5b`（7 EP・`doc/API設計/N_情報インプット.md`）／画面 SC-51 `§6b` ピッカー＋**新規 SC-55 テンプレート管理**（`doc/画面設計/screens/SC-50_情報インプット.md`・新規 `SC-55_情報テンプレート管理.md`）＋画面遷移図／テスト md `N-TC-300〜326`（`doc/テスト/N_情報インプット.md`）。
   - backend（既存 `impl/backend/app/tenant/info/` に4層追加）＝migration `migrations/company/versions/0060_info_templates.py`（`info_templates` 表＋`info_items.source_template_id`・部分一意 `UNIQUE(name) WHERE deleted_at IS NULL`）／`orm.py`（`InfoTemplate`＋`InfoItem.source_template_id`）／`schemas.py`（検証用 enum frozenset 群＋`TEMPLATE_DEFAULT_SCALARS`＋テンプレ DTO 群）／`repository.py`（`create_template`/`get_template`/`template_name_exists`/`list_active_templates`/`list_templates_admin`/`soft_delete_template`＋`create_info_item` に `source_template_id`）／`application.py`（`_validate_template_defaults`・`list_templates_for_picker`/`get_template_detail`/`list_templates_admin`/`create_template`/`update_template`/`set_template_active`/`delete_template`・nh3 サニタイズは `derive.sanitize_html`）／`router.py`（7 EP＝ピッカー/詳細=`require_me`・`admin=1`/書込=`require_company_account_admin`＋CSRF/Origin）。
   - テスト＝`tests/info/test_templates.py` 19件（repository/application/API）。red-green 実測済（`_validate_template_defaults` を一時バイパスで N-TC-311/312/313 を赤→復元で緑）。
   - モック（フロント実装フロー規約＝モック先行）＝`doc/画面設計/mocks/SC-55_情報テンプレート管理.html`（新規・DataTable＋登録/編集モーダル）／`SC-50_情報インプット.html`（§6b ピッカー追記＝新規時のみ表示・{{today}}展開・上書き確認）。headless Chromium で JSエラー0＋適用動作を確認済み。
2. **セッション末にリッチテキスト統一（TipTap 移行）を確認し、D5 frontend の進め方を転換**（コードはまだ無し・**決定のみ**）。引継＝`doc/セッション調整/引継/2026-10-09_リッチテキスト2系統統一-tiptap移行.md`／設計＝`doc/設計ドラフト/リッチテキスト2系統統一(TipTap移行)_設計.md`。バックログ台帳に `1-b. TipTap 移行（TT0〜TT5）` を出典付きで起票し、D5 行を「設計+backend+テスト済／frontend は TipTap 待ち」へ更新。

## 4. 現在の状態（動作 / テスト）
- **backend テンプレ機能＝コード完了・テスト green**。ただし**稼働中 backend コンテナは未再ビルド＝新 EP は未提供**（image は旧コードをベイク／テストは `docker compose run --rm -v` のマウント実行で green を確認）。新 EP を実際に叩くには `docker compose up -d --build backend` が必要。
- 今セッションで実行し green を確認＝`tests/info/test_templates.py` 19件／`tests/info` 全体 99件（`source_template_id` 追加の回帰なし）。**フル `tests/` 全体は未実行＝未確認**。
- migration `0060` は company DB（acme）に**テスト起動時の bootstrap で適用済み**（run 実行の entrypoint）。他会社 DB への適用は未確認。
- **TC トレーサビリティ ✅ 1082**（`python3 scripts/check_tc_traceability.py`・リポジトリルート）。
- コンテナ＝今セッションで `db`/`redis`/`minio` のみ `up -d` した（`backend`/`frontend` は未起動・旧イメージ）。
- **frontend production はまだ着手していない**（モックのみ）。SC-55 feature（`impl/frontend/src/features/info-templates`）は未作成。

## 5. 詰まっている点（試して失敗・回避策）
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
  - **未確定（実装時に要判断）**＝設計 §4-4 バンドル/SSR（Next App Router の client component 化・動的 import・初期バンドル許容ライン）。

## 7. 次にやること（優先順・ファイル/関数レベル）
> 着手前に実コードで裏取り。残作業の正本＝`doc/バックログ/未実装・ギャップ一覧.md`（`1-b` の TT0〜TT5＋D5 行）。

1. **TT1 TipTap 共有基盤（最優先・TC 先出し）**＝`impl/frontend/src/components/richtext/RichTextEditor.tsx`・`RichTextView.tsx`・`richtext.css` を TipTap(ProseMirror) ラッパへ置換。props＝`preset:"document"|"chat"`・`value`(PM-JSON)・`onChange`・`mentionSource?`・`uploadImage?`。document 拡張＝見出し/リスト/強調/リンク/引用/画像/表/コードブロック。TipTap 依存を `impl/frontend/package.json` に追加（`@tiptap/react`・`@tiptap/starter-kit`・table/image/codeblock 拡張）。**TC 先出し**＝サニタイズ（XSS）・直列化決定性（PM-JSON→許可タグ）を該当 md に `根拠` 列付きで追加（テスト規約 §5）。**着手前にユーザー判断が要る未確定点＝設計 §4-4 バンドル/SSR**（Next App Router の client component 化・動的 import・初期バンドル影響の許容ライン）＝台帳 `1-b` にも記載。
2. **TT0 保存形式 PM-JSON 化（backend）**＝`app/core/richtext.py` のサニタイズを「PM-JSON→直列化 HTML の許可リスト一致」に。document 系の `*_html` 列（`announcements`・`info_items.body_html`・`info_templates.body_html` 等）を **PM-JSON 列へ作り直す migration**（既存データ全削除可）。**D5 の `info_templates`/`info_items` もこの時に PM-JSON へ移行**（現状 HTML で実装済みのため列/サニタイズを合わせる）。
3. **TT2 お知らせ差替**＝`features/announcements/components/AnnouncementAdminView.tsx`・`AnnouncementDetailView.tsx`（既に共有部品使用＝影響局所）。
4. **TT3 情報インプット移行**＝`features/info-input/components/InfoFormPanel.tsx`・`InfoDetailView.tsx`・`growableResize.ts`・`info-input.css` の独自 contentEditable を撤去し共有部品へ。
5. **TT4＝D5 frontend 本実装**＝新共有部品の上で `features/info-templates`（新規・SC-55）＝一覧（`GET /info-templates?admin=1` の DataTable サーバー委譲）＋URL 付きモーダル（登録/編集・本文ひな形は共有 RichTextEditor・属性既定セレクト＋カテゴリ）＋有効無効/複製/論理削除。SC-51 ピッカー結線＝`features/info-input/components/InfoFormPanel.tsx` に「テンプレートから作成」（`GET /info-templates`＋適用は `GET /info-templates/{id}`・{{today}} クライアント展開・上書き確認）。モック＝`doc/画面設計/mocks/SC-55_情報テンプレート管理.html`・`SC-50_情報インプット.html`。`cd impl/frontend && npm run codegen`（backend 再ビルド後）で型再生成。受入ゲート＝ユーザー動作確認。
6. **TT5 チャット（最後・別EP）**＝`features/chat/components/IdeaChatView.tsx`・`features/chat/render.ts`＋`render.test.ts`（E-TC-211/229 契約移植）。ideas/concepts へ波及注意（memory `chat-thread-independence`）。
7. 完了時＝`impl/README.md` 現況更新・バックログ台帳から完了行削除・handoff 全文更新。

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
