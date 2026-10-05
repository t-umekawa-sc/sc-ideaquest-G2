# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-05 18:43 JST（セッション末）
- ブランチ: `main`（main 直 push が本プロジェクトの慣習・本セッションは都度 push 済）
- 最新コミット: `e2908032 feat(dashboard): Zone E に「参加リクエスト中」パネル追加（クエスト申請中＋コンテスト承認待ち）`
- working tree: **clean（全てコミット済・push 済／`git status` 確認済み）**
- alembic heads: control=`0019_company_access_mode`（本セッション変更なし）／company=`0054_announcements`（本セッションで追加）。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別 DB・ゲーミフィケーション付き）。直近は**ダッシュボード再設計（5ゾーン D→E→B→C→A）＋お知らせ機能（FR-49）＋アイデアコンテスト参加運用（FR-46）＋詳細画面UI統一**を実装。

## 3. 今回やったこと（コミット順・各 push 済・理由付き）
1. `00c3df50` ダッシュボード再設計 増分2/3＝ゾーン順 **D→E→B→C→A**。`impl/frontend/src/features/dashboard/components/DashboardView.tsx` を再編、`GET /dashboard`（`impl/backend/app/tenant/dashboard/application.py get_dashboard`）に `open_contests`/`joined_contests`/`recommended_quests` を合成（I.3 殻）。自分のクエストは `QuestListView.tsx` の絞り込みスイッチ（純ロジック `impl/frontend/src/features/quests/questFilter.ts`）へ移設。理由＝パネル過多の情報整理。TC＝I-TC-164/165/166・C-TC-306。
2. `989e85e7`/`2a65dece` ダッシュボードのフォローは**星マークのみ（枠なし）**＝共有 `.follow-star`（`impl/frontend/src/styles/components.css`）。ON=金★/OFF=白抜き☆。見出し★は `dashboard.css .dash-star-y`。理由＝ユーザー要望（詳細画面は枠付き `.follow-toggle` のまま）。
3. `07f0b0b7`/`1ebcc031` **詳細ヘッダー操作の横断統一（デザイン標準 §4.14 新設）**＝クエスト/アイデア/コンテスト/プロジェクト/コンセプトの5詳細を `.detail-head__actions`（一次アクション→編集(権限時)→⋮(削除danger)）に統一。コンテスト詳細は編集導線が無かったので `impl/frontend/src/features/contests/components/ContestFormModal.tsx` を `ContestListView.tsx` から抽出し一覧/詳細で共用（DRY）。理由＝「編集ボタンが有ったり無かったり」の是正。
4. `b4b33487` **コンテスト参加前タブ非表示/参加後表示＋参加⇄退席トグル（確認ダイアログ）**（`ContestDetailView.tsx`）。自己退席 `DELETE /contests/{id}/participation`＝status `left`（decided_by=本人）、管理者排除は従来 `rejected`＝**主体を区別**。`ContestDetail.my_status` 追加。一覧 SC-53 に「参加方式」列。TC＝T-TC-202/203。
5. `62e7ac66`/`8b84e2c0`/`d3621e48`/`74816682` **お知らせ機能 Phase2（FR-49・新ドメイン U）**＝§4 参照。
6. `651c0dc5`/`c0f81935`/`31c08f20` **お知らせ一覧の仕上げ**＝SC-95 を標準 DataTable 化（カード/リスト・列＝タイトル/公開日/ピン/状態/既読日時・本文列は除外）／SC-96 にカード表示追加／タイトル先頭📌はダッシュボード Zone D のみ（SC-95/96 の title 先頭📌は除去・ピンは列/メタで表現）／SC-95 詳細の戻るを文脈で出し分け（`lib/nav.markAnnouncementFromList`＝ダッシュボード経由→「← ダッシュボードへ戻る」(/)、一覧経由→「← お知らせ一覧へ戻る」）／SC-95 に すべて/未読/既読 スイッチ。いずれもユーザー要望。
7. `e2908032` **ダッシュボード Zone E に「✋ 参加リクエスト中」パネル**（クエスト申請中=`join_requests`／コンテスト承認待ち=新規 `requested_contests`）。`get_dashboard` に `requested_contests` 合成。TC＝I-TC-167。理由＝参加中とは別に申請中が分かるパネルが欲しいとの要望。

## 4. お知らせ機能（FR-49・ドメイン U）メモ
- 設計正本＝`doc/設計ドラフト/ダッシュボード再設計・お知らせ_設計.md` §4。採番＝FR-49（`doc/要件定義/README.md`）／データモデル §5.65 `announcements`・§5.66 `announcement_reads`／API `doc/API設計/U_お知らせ.md`／テスト `doc/テスト/U_お知らせ.md`（U-TC-101〜109）。
- backend＝`impl/backend/app/tenant/announcements/`（orm/repository/application/schemas/router）＋migration `0054_announcements`＋`impl/backend/app/core/richtext.py`（`info/derive.py` から `sanitize_html`/`to_plain_text` を抽出・info は再エクスポートで後方互換）。閲覧=全ユーザー（`GET /announcements`・`/{id}`・`POST /{id}/read` 冪等）／管理=管理者のみ（`/admin/announcements` POST/PATCH/DELETE・403二重防御）。body_html は保存時サニタイズ＋body_text 派生。論理削除・掲載期間・ピン・既読（read_at）。`get_dashboard` に `announcements`（§4.3a 選別＝ピン優先→未読→既読非ピン除外・最大3・純関数 `announcements/application.pick_dashboard_announcements`）＋`announcements_unread_count` 合成。
- frontend＝共有 `impl/frontend/src/components/richtext/`（`RichTextView`/`RichTextEditor`/`richtext.css`）。`features/announcements/`（api.ts＋`AnnouncementsListView`/`AnnouncementDetailView`/`AnnouncementAdminView`）。ルート `app/(app)/announcements/`（一覧＋`[announcementId]` 詳細）・`app/(app)/admin/announcements/`。ナビ `components/layout/AppNav.tsx` に「お知らせ」(全員)・「お知らせ管理」(管理者)。ダッシュボード Zone D 📢パネル実データ。

## 5. 詰まっている点（試して失敗/注意）
- **画像の目視取り込みが不可**＝本セッションは会話の画像枚数が上限に達し、スクショ（`Read` 画像）が API 側で弾かれた（縮小しても同様）。→ 検証は **Playwright の使い捨て `_chk.mjs` で DOM/計算スタイル**（locator count・innerText・getComputedStyle）に切替＝有効に機能した。次回も画像不可なら同手法。ローカルに PIL/convert 無し・frontend に `sharp` あり（縮小は可だが読み込み不可）。
- **pytest フルの既知失敗＝`tests/info` 4件**（`test_n_tc_002/003/004`・`test_n_tc_105`）＝**共有 dev DB 非冪等**（info 検索/フィルタが蓄積データを拾う）。**変更を stash しても同一失敗＝コードではなく DB 状態が原因**と確認済（本セッションの変更と無関係）。メモリ `e2e-full-not-idempotent-shared-db` 参照。
- **pytest をパイプ（`| grep | tail`）で流すと exit code が最後のコマンドのものになり失敗をマスク**＝フルは `pytest -q > /tmp/log 2>&1; echo $?` で直接 exit を取る。
- **backend/frontend はソースをベイク（volumes 無）**＝反映は `cd impl && docker compose up -d --build backend|frontend`。pytest で未コミット編集を反映するには `-v "$(pwd)/backend:/app"` マウント（§8）。
- **新 migration を既存会社DBへ適用**が必要（bootstrap と同経路）＝§8 のワンライナー。

## 6. 決定事項と根拠（不採用案も）
- **ゾーン順 D→E→B→C→A**＝参加機会/告知(D)とマイ(E)を上、要対応(B)/キャッチアップ(C)を中、ゲーム(A)を最下段（情報設計・ユーザー決定）。
- **フォロー表現は2系統を使い分け**＝ダッシュボード=星のみ `.follow-star`（枠なし）／詳細画面=枠付き `.follow-toggle`（★ フォロー中/☆ フォロー）。不採用＝全箇所 toggle（ダッシュボードが重く見える・ユーザー指摘）。
- **タイトル先頭📌はダッシュボードのみ**＝一覧/詳細は列・メタで表現（ユーザー要望）。
- **コンテスト退席の主体区別**＝自主=`left`（decided_by 本人）／管理者排除=`rejected`（decided_by 管理者）。status と decided_by の両方で判別可能（新フィールドを足さず既存 enum で区別・ユーザー要望）。
- **お知らせ本文サニタイズは `app/core/richtext`（info から抽出）**＝info 専用にせず中立化（DRY §2.3）。info は再エクスポートで無改修。
- **詳細ヘッダー統一の対象外**＝会社詳細（SC-92 管理系 DataTable）・情報詳細（ダイアログ）は別パターンのため §4.14 対象外（デザイン標準に明記）。
- **`/dashboard` は response_model 無しの dict**＝frontend `DashboardData` 型は**手書き**（`features/dashboard/api.ts`・codegen 対象外）。U ドメイン（announcements）の型は codegen で `schema.d.ts` に入る。

## 7. 次にやること（優先順・ファイル/関数レベル）
1. **お知らせ follow-up（未着手）**：
   - 画面設計書 `doc/画面設計/screens/SC-95_*.md`・`SC-96_*.md` が**未作成**（画面遷移図には追加済み）。
   - **公開会社(access_mode=public)の外周403許可リストに announcements read を追加**（FR-48 連動）＝現状 read EP は `require_me` のみ（private 会社は一般も閲覧可）。追加箇所は FR-48 のアクセス制御実装点（**未確認＝中央の許可リスト実装が存在するか要調査**。`grep -rn access_mode impl/backend/app` から辿る）。
   - お知らせ本文の**画像再ホスト**＝共有 `RichTextEditor`（`components/richtext/RichTextEditor.tsx`）は画像未対応。情報インプットの `uploadInfoImageApi`（`features/info-input`）相当の お知らせ用アップロードEPが必要。
2. **info ドメインのフルスイート4失敗の解消（既存不具合）**＝`impl/backend/tests/info/test_repository.py`（`test_n_tc_002_status_filter`・`003`・`004`）/`test_api.py`（`test_n_tc_105_full_text_search`）。原因＝`info_env` フィクスチャの user スコープ漏れ or 共有DB蓄積。フル前に acme/acme2 を drop→bootstrap するか、フィクスチャを自ユーザー限定に修正。②とは独立。
3. **デモデータ後始末**＝本セッションで目視用に acme DB へ投入（ユーザー了承で残置）。マーカー/内容＝`【DEMO-ZB】`（アイデア/クエスト/コンテスト参加・`/tmp/dashshot/_seed_zone_b.py` は冪等再利用可）、`【検証】` お知らせ2件、user@acme の follow/コンテスト参加(approved,requested=4a942bf5)/クエスト owner,quest_admin 権限（b3fe13cc・c9dafa96）、quest_join_request pending（619f6d3e）。不要になったら削除。
4. 要望ベースで UI 継続・他機能（FR-43 ソリューション開発／FR-42 コンセプト深掘り 等）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`、frontend `impl/frontend`、backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`（backend/frontend/db/redis/mailhog/minio 等）。backend=`http://localhost:8000`、frontend=`http://localhost:3000`、openapi=`http://localhost:8000/openapi.json`。
- 反映（ソースベイク）：`cd impl && docker compose up -d --build backend|frontend`。型再生成は backend 再ビルド後 `cd impl/frontend && npm run codegen`。
- テスト：
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。未コミット反映は `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。フルは `... pytest -q > /tmp/log 2>&1; echo $?`（exit を直接取る）。
  - frontend `cd impl/frontend && npm run build`／`npx vitest run <path>`／`npx tsc --noEmit`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（993 件 OK を本セッション末に確認）。
- 新 migration の既存会社DB適用（bootstrap 同経路・mount で未コミット反映）：
  `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend python -c "from alembic import command; from alembic.config import Config; from app.core.config import get_settings; s=get_settings(); [ (lambda c:(c.set_main_option('sqlalchemy.url', s.server_dsn(db)), command.upgrade(c,'head')))(Config('alembic_company.ini')) for db in ['ideaquest_company_acme','ideaquest_company_acme2'] ]"`
- ログイン（会社 `ACME-01`）：一般 `user@acme.example`／管理 `kanri@acme.example`（company_account_admin）／OPS `admin@ops`（system_admin）。いずれも `Passw0rd!`。会社DB＝`ideaquest_company_acme`（psql: `docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme`）。
- 目視検証の型（画像不可時）：`impl/frontend` に使い捨て `_chk.mjs` を書き `node _chk.mjs`（Playwright chromium・ログイン→goto→`locator().count()/innerText()/evaluate(getComputedStyle)` を console.log）。長時間化する時は run_in_background＋Monitor で `until grep -q <marker> <outfile>` 待ち。
- e2e：`cd impl/frontend` で Playwright。フル e2e は共有dev DB 非冪等＝前に acme/acme2 drop→bootstrap。
