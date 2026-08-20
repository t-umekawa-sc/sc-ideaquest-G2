# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-20 JST**
- ブランチ: **main**（作業も main に直接コミット）。**push は都度ユーザー承認制**。最新は **ローカル未push あり**の可能性（要確認 `git status -sb`）。
- 最新コミット: **`c0f30ed` feat(SC-91/92): 会社アバター画像アップロードを接続（P1 MinIO 基盤流用・B.1）**（＋直後に本 handoff の docs コミット）。
- 直近の並び（新しい順）＝会社アバター画像 `c0f30ed` ／ RowMenu viewport 修正（sc-92c B-TC-116 解消・push済 `47d7cef`+`33a8543`）／ `1539ad1` handoff ／ `08922f3` tooltip統一 ／ `5b5cd14` DataTableボタン不透明化 ／ `a5250a1` ヘッダーアバター即反映 ／ `7cb1b96` SC-03画像 frontend ／ `529f6af` MinIO基盤。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/**MinIO**/MailHog/Docker。設計は完了済み。
- 現フェーズ＝**画面移植は完了**。**backend 接続フェーズ**を **1画面単位ループ**（フロー規約 §1.1）で回している。**実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)**（アカウント登録→クエスト→アイデア→評価→その他／アップロードは後回し禁止）。

## 3. 今回やったこと（変更ファイルと理由）
本セッション＝**(1) `sc-92c B-TC-116` 修整（§3-α）**＋**(2) 会社アバター画像アップロード実装（§3-β）**＋会社作成フォームのプレースホルダ変更（会社名「例: システムコンシェルジュ」/DB識別子「例: db_sc」）。フェーズ2（C ドメイン）は未着手。前セッション分（フェーズ1 ユーザー画像）は §3-0 に退避。

### 3-β. 会社アバター画像アップロード（SC-91/92・B.1・P1 MinIO 基盤流用）
- 従来 UI は「画像を選ぶ」がローカルプレビューのみ（送信しない仮実装）＝反映されなかった。K.4（`/me/avatar-image`）と同流儀の**専用 multipart EP**に接続。
- **backend**: `admin/router.py` に `PUT/DELETE /admin/companies/{id}/icon-image`（multipart・Origin/CSRF）。`company_application.py` に `set_company_icon`/`delete_company_icon`＋`_icon_url`（署名URL解決）。管理DB `companies.icon_image_path`（列は既存・migration 0008）を直接更新＝会社DB 未整備の suspended でも設定可。**一覧/詳細応答に `icon_image_url`（署名URL）を追加**＝生キー直返し廃止（従来 `icon_image_path` 生キーを QuestIcon に渡しており表示は元々壊れていた）。
- **DRY**: 画像バリデーションを `infra/storage.py` の `validate_image_upload` に集約し me も委譲（旧 `me/application._validate_image` は撤去）。
- **frontend**: `features/companies/api.ts` に `setCompanyIcon`/`deleteCompanyIcon`。作成フォームは「作成→アイコン PUT」の2段（会社は先に実在が必要・`iconFile` 保持）。詳細（`CompanyDetailView`）は選択で即保存/クリアで削除＋`getServerMe` 不要。一覧/詳細/バナーの `QuestIcon` を `icon_image_url` に切替。`schema.d.ts` 再生成。
- **設計**: API設計 B.1 に icon-image EP＋署名URL 方針（§1.10）を追記。
- **test**: `tests/admin/test_admin_company_icon.py`（Fake storage・red→green・5件）。backend **221 passed**。実 MinIO の company-icons 署名URL はホストから **HTTP 200＋有効 PNG** を確認。

### 3-0. 前セッション（フェーズ1 完了・要約）
MinIO 画像基盤＋アバター/背景画像アップロード（backend `529f6af`／frontend `7cb1b96`・ヘッダー即反映 `a5250a1`）＋UI 修正（DataTable ボタン不透明化 `5b5cd14`／ツールチップ統一 `08922f3`）。詳細は git 履歴と本 §3-1〜3-3 参照（下記は前回記述を保持）。

### 3-α. RowMenu ドロップダウンの viewport 収まり修整（sc-92c B-TC-116 解消）
- **`components/ui/RowMenu.tsx`**＝`position:fixed` のドロップダウンが常にトリガー直下に開き、行が画面下端近くだと menuitem が viewport 外に出て click 不可だった（`force:true` でも `Element is outside of the viewport`）。
  - `computePos(r, listH)` 新設＝トリガー直下を基本に、**下に収まらなければ上へフリップ**＋左右上下を **viewport 内へクランプ**（`VP_MARGIN=8`）。
  - 配置を `useEffect`→**`useLayoutEffect`** 化＋`listRef.offsetHeight`（実高さ）測定でペイント前に最終座標確定＝再配置ジッタ解消。`toggleOpen` 初回も概算高さ（`EST_ITEM_H=40`×項目数）で上フリップを効かせる。
- **`e2e/sc-92c-quest-groups.spec.ts`**＝メニューが常に画面内で安定するため、リネーム/削除の `click({force:true})` を素直な `click()` に戻し（安定性チェックを実効化）、コメント更新。
- red-green＝修整前に spec 実行で `outside of the viewport` を目視（red）→修整＋frontend 再ビルドで green。回帰確認＝RowMenu 使用の sc-91/sc-92/sc-92b2 の 11 件も全 passed。

### 3-1. MinIO 画像/ファイル基盤 ＋ アバター/背景アップロード backend（`529f6af`・K.4/§1.10）
- **新規 `impl/backend/app/infra/storage.py`**＝`ObjectStorage` 抽象（`MinioStorage`/`FakeStorage`・`set_storage`/`get_storage` で差替＝`infra/mail.py` と同流儀）。非公開バケット＋**短TTL 署名URL**（`presigned_get`）・物理名ハッシュ（`hashed_key`）・MIME allowlist（`ALLOWED_IMAGE_MIME`）＋サイズ上限（`MAX_IMAGE_BYTES`=5MB）。
- **compose.yaml**＝`minio` サービス（:9000 S3 API / :9001 コンソール）＋`&backend_env` に `MINIO_*`＋`minio_data` ボリューム＋backend の depends_on。**deps に `minio`/`python-multipart` を追加**（`pyproject.toml`＋Dockerfile フォールバック）。
- **config.py**＝`MINIO_*` 設定（`minio_endpoint`=内部`minio:9000`／`minio_public_endpoint`=公開`localhost:9000`／bucket/secure/url_ttl/**region**）。
- **migration `0008_company_users_bg_image`**＝`users.background_image_path` 追加（`avatar_image_path` は既存）。ORM `tenant/profile/orm.py` に列追加。
- **me（K.4）**＝`me/router.py` に `PUT/DELETE /me/avatar-image`・`PUT/DELETE /me/background-image`（multipart・Origin/CSRF）。`me/application.py` に `set_avatar_image`/`delete_avatar_image`/`set_background_image`/`delete_background_image`＋`_set_user_image`/`_delete_user_image`/`_validate_image`。`_me()` は `_image_url()` で画像を署名URL に解決（パス直返し禁止）。`me/schemas.py` に `AvatarImageResponse`/`BackgroundImageResponse`。
- test＝`tests/me/test_me_images.py`（Fake storage・MinIO 非依存）／`conftest.py` に `storage` フィクスチャ。red＝router 退避で 404 観測→green。

### 3-2. SC-03 画像アップロード frontend（`7cb1b96`）＋ヘッダー即反映（`a5250a1`）
- `lib/api/client.ts`＝FormData は Content-Type をブラウザに任せる（multipart）。
- `features/profile/api.ts`＝`setAvatarImage`/`deleteAvatarImage`/`setBackgroundImage`/`deleteBackgroundImage`。
- `ProfileForm.tsx`＝アイコン欄を実 `PUT/DELETE /me/avatar-image` に接続（署名URL の img 表示・削除で頭文字・422 エラー表示）。ローカルプレビュー廃止。
- 新規 `features/profile/components/BackgroundImageMenuItem.tsx`（client）＝ヘッダーのユーザーメニュー「背景画像を変更／リセット」→ `PUT/DELETE /me/background-image`＋`useSnackbar`。
- `app/(app)/layout.tsx`＝`.app-bg` に `background_image_url`（署名URL）を適用（`is-set`・全認証画面に反映）＋メニューに `BackgroundImageMenuItem`。**ヘッダーの user（アイコン/表示名）を `getServerMe`(=/me) 由来に変更**（session.user スナップショットだとアバター変更が反映されない不具合を修正・`router.refresh()` で即反映）。
- `lib/api/schema.d.ts` 再生成。e2e `sc-03-images.spec.ts`（アバター設定/署名URL/削除・背景設定/全画面反映/リセット・ヘッダー反映）。

### 3-3. UI 修正（`5b5cd14`＋`08922f3`）
- **DataTable ツールバー**（`components/ui/DataTable.tsx`）＝背景画像上でボタン位置が不明瞭だったため `.btn-outline` を透過→`surface`（不透明）に（**design-system.css と components.css の二重定義を両方修正**・prof-panel の暗面上書きは維持）。グローバルフィルタのプレースホルダを定型文「検索…」に短縮（文字切れ解消）。
- **ツールチップ統一**＝ダッシュボードの XP バー由来 pixel 風ツールチップを**汎用 `.has-tip[data-tip]`** に一般化（`design-system.css`）。DataTable 検索アイコンはネイティブ `title` を廃止し `.has-tip[data-tip]` に。XP バー（DashboardView/ProfileHero）も `data-xp`→`data-tip`＋`has-tip`。`mocks/shared.css` に同一 `.has-tip` 追加・`style-guide.html §16「ツールチップ」`新設。
- （前セッション分で本セッション着手前に既 push＝プロフィール レイアウト刷新/獲得履歴/フィード設計追記など。§4 参照）

## 4. 現在の状態（動く/壊れている/テスト）
### 4-1. フロント
- 画面移植は全完了。`features/` は 17+（profile に ProfileHero/ActivityHistory/BackgroundImageMenuItem 追加）。
- **backend 接続済み**＝認証 SC-00／プロフィール SC-03/K（**表示名・言語・PW・メール・残高・獲得履歴・アバター/背景画像アップロード**）／管理 SC-90/91/92/93／SC-01 ヒーロー残高＋共通ヘッダー通貨＋**ヘッダーアバター（/me）**。
- 背景画像＝全認証画面に反映。ツールチップは全画面 `.has-tip[data-tip]` 統一。DataTable ボタンは不透明。
- **デモ fixtures（未接続）**＝SC-02/10（クエスト一覧・mock）/11/12/21/22/24/25/30/31/32/40/41、SC-01 の週間ランキング/下書き/未投票/参加中クエスト/フォロー中/チームアクティビティ。

### 4-2. backend
- 登録ルータ＝**auth/admin/me の3つ**。`me` に画像EP（K.4）と `GET /me/activities`（G.6）を含む。`admin` に**会社アイコン EP**（`PUT/DELETE /admin/companies/{id}/icon-image`・B.1）を追加。
- 実装済み＝`control_plane/{auth,admin,me,account_sync,audit,mail_outbox}`・`tenant/{profile,quest_group,gamification}`・**`infra/storage`（MinIO）**。
- **未実装ドメイン**＝C クエスト・パーティー・権限（**次フェーズ**）／D アイデア・添付／E チャット／F 評価／G 残り（ショップ/装備/魔法/実績/ランキング・spend系・フィード集約）／H 通知／I 集約／J 検索／L WS。API 設計は全ドメイン確定（`doc/API設計/{A..L}_*.md`）。

### 4-3. テスト
- **backend pytest＝221 passed**（会社アイコン +5・最後にフル実行で確認・`-v "$PWD/backend:/app"` マウント＝即反映・MinIO は Fake で非依存）。
- **frontend e2e**＝本セッションで green 確認＝`sc-01-dashboard`／`sc-03-images`（2）／`sc-03-activities`／`k-profile`（3）／`sc-91`／`sc-92b`／`sc-93`。フルは並列ログインのレート制限フレーク（直列＋FLUSHALL で切り分け）。
- **既知の壊れ**＝`sc-92c B-TC-116` は本セッションで**解消**（§3-α）。残＝backend `test_a_tc_040` が pytest-randomly のランダム順で稀に IndexError（単独/別シードで green）。

## 5. 詰まっている点（試して失敗した/注意）
- **MinIO 署名URL の docker ホスト問題**＝backend は内部 `minio:9000` で put/remove、ブラウザは公開 `localhost:9000` で GET。署名は host を含むため2クライアント（`MinioStorage._ops`/`_url`）に分離。**`presigned_get_object` は region 未指定だと GetBucketLocation の HTTP を打ち公開ホストへ到達できず 500**＝**`region` を明示**してオフライン署名化（`config.minio_region`・`storage.py` で両クライアントに `region=` を渡す）。ここでハマった。
- **Alembic の revision id は 32文字以内**（`alembic_version` が `varchar(32)`）。最初 `0008_company_users_background_image`(35字) で `StringDataRightTruncation`＝短縮 `0008_company_users_bg_image` に。トランザクションでロールバックされ DB は無傷だった。
- **CSS 二重定義**＝`.btn-outline` は `design-system.css` と `components.css` の両方にあり、**globals.css の import 順で後者（components.css）が勝つ**。片方だけ直しても効かない（背景色変更で発覚）。同様に usermenu も二重定義（layout.css / design-system.css）。
- **next/image は `images.unoptimized:true`**（next.config）＝素の img 描画のため署名URL の remote host 許可設定は不要（短TTL 署名URL のキャッシュ問題も回避）。
- **署名URL 画像は e2e（コンテナ内ブラウザ）では実ロードできない**＝署名 host は公開 `localhost:9000`（＝ホストに公開された MinIO）だが、Playwright のブラウザは frontend コンテナ内で動くため `localhost:9000` に到達不可＝`naturalWidth` は 0 のまま。**e2e は img の `src` 属性（`/avatars/`・`/company-icons/` を含むか）だけで検証する**（既存 `sc-03-images` と同方針）。実ロード可否はホストから `curl` で確認する（実ユーザーのブラウザはホスト上＝到達する）。
- **背景/アバター/ツールチップ改修時の落とし穴**＝(1) `overflow:hidden` の要素に `::after` ツールチップは切れる→ラッパー（`.has-tip` ホストは位置文脈＝position≠static）に出す。(2) `.usermenu__list li > *` の `background:none` が区切り線を透明化（高特異度で打消し・既知）。
- **frontend 再ビルドで Playwright chromium/依存が消える**＝毎回 `install-deps chromium`(root)＋`install chromium`。**`docker compose cp` した使い捨て spec/png も再ビルドで消える**＝rebuild 後に再 cp。
- **稼働 backend/frontend はソース焼き込み**＝反映は再ビルド。**openapi 変更時は `schema.d.ts` を codegen 再生成**（§8）。
- **background の Bash は cwd 非継承・foreground sleep は不可**＝compose は絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml`、待機は直接 `curl` 判定で。

## 6. 決定事項と根拠
- **実装順＝アカウント登録→クエスト管理→アイデア→評価→その他**（`doc/実装計画.md`・2026-08-19 ユーザー選択）。C（クエスト/パーティー/権限）が D/E/F/フィードの門番なのでアイデア前に置く。
- **アップロードは後回しにしない**＝MinIO 共通基盤をフェーズ1で確立し、アバター/背景（P1）・クエストアイコン（P2）・アイデア添付（P3）・チャット添付（P5）で再利用。
- **MinIO テストは Fake storage で非依存**（`set_storage`＝mail と同流儀）。採用理由＝pytest を MinIO 起動に縛らない。
- **画像は会社DB `users` 直接更新（identity でない＝outbox 経由しない）＋短TTL 署名URL・恒久公開URL 禁止**（K.4/§1.10）。
- **ツールチップは単一の `.has-tip[data-tip]` に統一**（ネイティブ `title` は使わない）＝デザイン統一・DRY。ダッシュボード様式を採用（ユーザー選択）。
- **ヘッダーのアイコン/表示名は `/me` 由来**（session スナップショットだと変更が反映されないため）。
- 時系列アクティビティフィード＝`activities` の絞り込み表示で実現（新テーブル不要・データモデル §8-㉑・API設計 G.5.1・SC-12/SC-01 は C 依存）。
- **会社アバターは専用 multipart EP（`.../icon-image`）で実装**（K.4 と同流儀）。当初 B.1 は create/patch ボディの `icon_image_path?`（既存キー直指定）を想定していたが、画像を実アップロードして key を得る手段が無く読取も生キーだった＝不完全。K.4 の実績パターンに合わせ設計（B.1）も更新。作成は「作成→アイコン PUT」の2段（会社の実在が前提）。`icon_image_path?` ボディは補助手段として残置。

## 7. 次にやること（優先順・具体的に）
1. **フェーズ2「クエスト管理（C ドメイン）」着手**（実装計画 §2 フェーズ2）。
   - 着手前に **`doc/API設計/C_クエスト・パーティー・権限.md`** と画面 **`doc/画面設計/screens/SC-10/SC-11/SC-12`**＋mocks を精読。既存4層テンプレ＝`control_plane/me`・`control_plane/admin`・`tenant/{profile,quest_group,gamification}`。
   - 会社DB に **quests/quest_members（パーティー）/権限** のテーブル（migration `migrations/company/versions/000x_*`・**revision id は 32字以内**）＋ORM＋repository＋application＋router（テナントAPI・`get_tenant_session`・門番 C.0＝パーティー所属）。
   - 画面接続＝SC-10 一覧（DataTable・`searchFields` は既に定型文プレースホルダ化済み）／SC-11 作成モーダル／SC-12 詳細。**クエストアイコン画像**は `infra/storage`（P1 基盤）で同時実装（FR-20）。
   - G 連動は C 完了後の D/E/F で `tenant/gamification/ledger.grant` を発火。
   - §1.1 の1画面ループ＋**受入ゲート（ユーザー動作確認）で必ず止める**。
2. **時系列フィード（SC-12→SC-01）**＝C 実装の周回で `GET /quests/{id}/activities`→`GET /me/feed`（API設計 G.5.1・門番 C.0・公開種別のみ）。リンク付き表示は D/E 後。
   - （`sc-92c B-TC-116` の修整は本セッションで完了＝§3-α。次の別件は無し。）

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／**minio :9000（API）/:9001（コンソール）**／mailhog UI :8025。**e2e は `--profile workers` 必須**。※現在は全サービス稼働中。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend**＝`build frontend`→`up -d frontend`。
- **openapi 型再生成**＝backend 再ビルド後、`docker compose exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose cp frontend:/app/src/lib/api/schema.d.ts <host>`。
- **backend テスト**（cwd=`impl`）＝先に `docker compose stop worker mail-worker`→ `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（マウント即反映・migration 適用・MinIO 不要）。e2e に戻すとき `--profile workers up -d worker mail-worker`。
- **frontend e2e**（Docker）: (1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium` (3)`exec -T redis redis-cli FLUSHALL` (4)`exec -T frontend npx playwright test e2e/<spec> --reporter=line`（疑わしい失敗は `--workers=1`）。spec 差替＝`cp impl/frontend/e2e/x.spec.ts frontend:/app/e2e/x.spec.ts`（再ビルドで消える＝再 cp）。
- **MinIO env（既定・dev）**＝`MINIO_ACCESS_KEY=ideaquest`/`MINIO_SECRET_KEY=ideaquest-secret`/`MINIO_BUCKET=ideaquest`。バケットは `MinioStorage._ensure_bucket()` が初回に作成。コンソール `http://localhost:9001`。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。※**ログインで +10 XP/JST日**（G.6）。※ACME-01 に獲得履歴デモを十数件シード済み（`ledger.grant` 手動投入・不要なら削除可）。MailHog＝`http://localhost:8025`。
- 規約＝`CLAUDE.md` から辿る。**実装順の正＝`doc/実装計画.md`**。デザインの正＝`doc/画面設計/mocks/*.html`（style-guide.html §16 にツールチップ）＋`screens/*.md`＋`デザイン標準.md`。API 設計＝`doc/API設計/{A..L}_*.md`。データモデル＝`doc/データモデル.md`（残高/台帳 §5.27・§7、画像列 §5.3、フィード §8-㉑）。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に必ず削除。
