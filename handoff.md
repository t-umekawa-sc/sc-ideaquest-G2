# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-20 21:13 JST**
- ブランチ: **main**（作業も main に直接コミット）。**push は都度ユーザー承認制**。
- 最新コミット（本 handoff コミット前）: **`550aeff` docs(handoff)** ／ その前 **`17bee87` feat(ui/DataTable): 一覧状態を URL クエリ同期**。本 handoff コミット後に push する。
- 直近の並び（新しい順）＝`550aeff` handoff ／ `17bee87` DataTable URL同期 ／ `0f35e96` handoff ／ `c0f30ed` 会社アバター画像（SC-91/92）／ `33a8543` handoff ／ `47d7cef` RowMenu viewport 修正（sc-92c B-TC-116 解消）／ `1539ad1` handoff ／ `08922f3` tooltip統一。
- **push 済みの境界**＝`47d7cef`+`33a8543`（RowMenu）まで origin/main。**`c0f30ed`/`0f35e96`/`17bee87`/`550aeff`＋本 handoff はローカル先行**（push 要）。再開時は `git status -sb` で確認。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/**MinIO**/MailHog/Docker。設計は完了済み。
- 現フェーズ＝**画面移植は完了**、**backend 接続を 1画面単位ループ**（フロー規約 §1.1）で実施中。**実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)**（アカウント登録→クエスト→アイデア→評価→その他／アップロードは後回し禁止）。**次はフェーズ2「クエスト管理（C ドメイン）」未着手**。

## 3. 今回やったこと（変更ファイルと理由）
本セッション＝ユーザーの手動確認（登録アカウントでログインまで）に付随して発生した 4 件。フェーズ2（C）は未着手。前セッション分（フェーズ1 ユーザー画像）は §3-0 に退避。

### 3-0. 前セッション（フェーズ1 完了・要約）
MinIO 画像基盤＋ユーザーのアバター/背景画像アップロード（backend `529f6af`／frontend `7cb1b96`・ヘッダー即反映 `a5250a1`）＋UI 修正（DataTable ボタン不透明化 `5b5cd14`／ツールチップ統一 `08922f3`）。詳細は git 履歴参照。

### 3-α. RowMenu ドロップダウンの viewport 収まり修整（sc-92c B-TC-116 解消・`47d7cef`）
- **`impl/frontend/src/components/ui/RowMenu.tsx`**＝`position:fixed` のメニューが常にトリガー直下に開き、行が画面下端近くだと menuitem が viewport 外に出て click 不可（`force:true` でも `outside of the viewport`）だった。
  - `computePos(r, listH)` 新設＝下に収まらなければ**上へフリップ**＋左右上下を **viewport 内クランプ**（`VP_MARGIN=8`）。配置を `useEffect`→**`useLayoutEffect`**＋`listRef.offsetHeight` 実測でペイント前確定（再配置ジッタ解消）。
- **`impl/frontend/e2e/sc-92c-quest-groups.spec.ts`**＝`click({force:true})` を素の `click()` に戻し安定性チェックを実効化。
- red→green 観測済み。

### 3-β. 会社アバター画像アップロード（SC-91/92・B.1・P1 MinIO 基盤流用・`c0f30ed`）
- 従来 UI は「画像を選ぶ」がローカルプレビューのみ（送信されず反映されない仮実装）。K.4（`/me/avatar-image`）と同流儀の**専用 multipart EP**に接続。
- **backend**:
  - `impl/backend/app/control_plane/admin/router.py`＝`PUT/DELETE /admin/companies/{id}/icon-image`（multipart・Origin/CSRF・system_admin）。
  - `impl/backend/app/control_plane/admin/company_application.py`＝`set_company_icon`/`delete_company_icon`＋`_icon_url`（署名URL解決）。管理DB `companies.icon_image_path`（列は既存・migration `0008`）を直接更新＝会社DB 未整備の suspended でも可。**一覧/詳細応答に `icon_image_url`（署名URL）を追加**＝生キー直返し廃止（従来 `icon_image_path` 生キーを QuestIcon に渡しており表示は元々壊れていた）。
  - `impl/backend/app/control_plane/admin/schemas.py`＝`CompanyListItem`/`CompanyDetail` に `icon_image_url` 追加。
  - **DRY**: 画像バリデーションを `impl/backend/app/infra/storage.py` の `validate_image_upload` に集約し `me/application.py` も委譲（旧 `me/application._validate_image` は撤去）。
- **frontend**:
  - `impl/frontend/src/features/companies/api.ts`＝`setCompanyIcon`/`deleteCompanyIcon`。
  - `CompanyCreateForm.tsx`＝「作成→アイコン PUT」の2段（会社は先に実在が必要・`iconFile` 保持）。
  - `CompanyDetailView.tsx`＝選択で即保存/クリアで削除。一覧/詳細/バナーの `QuestIcon` を `icon_image_url` に切替。
  - `CompanyList.tsx`＝`imageUrl` を `icon_image_url` に。`lib/api/schema.d.ts` 再生成。
- **設計**: `doc/API設計/B_会社・アカウント・所属.md` B.1 に icon-image EP と署名URL方針を追記。
- **プレースホルダ変更**（同コミットに同梱）＝`CompanyCreateForm.tsx` 会社名「例: システムコンシェルジュ」/DB識別子「例: db_sc」。
- **test**: `impl/backend/tests/admin/test_admin_company_icon.py`（Fake storage・red→green・5件）。

### 3-γ. DataTable の一覧状態を URL クエリ同期（全 DataTable 画面・`17bee87`）
- 一覧→詳細→一覧の往復で検索/絞込/ソート/ページが消える問題（DataTable のセッション state はルート遷移で破棄・設計上も「セッション内」で復元未仕様）を **URL クエリ同期**で解消（ユーザー選択・推奨案）。
- **`impl/frontend/src/components/ui/DataTable.tsx`**＝検索/ソート/絞込/ページを **`<storageKey>.q/.sort/.f/.page`**（storageKey 名前空間＝1画面に複数テーブルでも衝突しない・既定値は URL に載せない）に同期。マウント時に URL から初期化（`decodeUrlState`・lazy init via `urlInitRef`）、変更時は `router.replace`（現在エントリに畳み込み＝履歴汚さない・**searchParams は effect 依存に入れずループ回避**、基点は `window.location.search`）。ソートは `key`/`-key` カンマ連結、絞込は `FilterCond` を JSON。localStorage 側（列/密度/ビュー/ピン/perPage）は従来どおり別レイヤ。
- **`CompanyDetailView.tsx`**＝「← 会社一覧へ戻る」を `<Link>`→`router.back()`（`backToList()`・履歴なし＝素の一覧へフォールバック）に変更＝絞込付き一覧 URL に復帰。
- **設計**: `doc/画面設計/デザイン標準.md` §4.5⑨・`doc/API設計/README.md` §1.8.1 を「URL クエリ同期」に改定（2026-08-20）。

## 4. 現在の状態（動く / 壊れている / テスト）
### 4-1. フロント
- 画面移植は全完了。**backend 接続済み**＝認証 SC-00／プロフィール SC-03/K／管理 SC-90/91/92/93／SC-01 一部。
- **会社アバター画像**（SC-91 作成・SC-92 詳細）＝実 MinIO 接続で動作（署名URL 表示・削除で頭文字戻し）。
- **一覧（DataTable）状態は URL 同期**＝ドリルイン→戻る/再読込/共有で検索・絞込・ソート・ページが復元。
- **デモ fixtures（未接続）**＝SC-02/10（クエスト一覧・mock）/11/12/21/22/24/25/30/31/32/40/41、SC-01 の週間ランキング/下書き/未投票/参加中クエスト/フォロー中/チームアクティビティ。

### 4-2. backend
- 登録ルータ＝**auth/admin/me の3つ**。`me` に画像EP（K.4）＋`GET /me/activities`（G.6）。`admin` に**会社アイコン EP**（`PUT/DELETE /admin/companies/{id}/icon-image`・B.1）を追加。
- 実装済み＝`control_plane/{auth,admin,me,account_sync,audit,mail_outbox}`・`tenant/{profile,quest_group,gamification}`・`infra/storage`（MinIO）。
- **未実装ドメイン**＝C クエスト・パーティー・権限（**次フェーズ**）／D アイデア・添付／E チャット／F 評価／G 残り（ショップ/装備/魔法/実績/ランキング・spend系・フィード集約）／H 通知／I 集約／J 検索／L WS。API 設計は全ドメイン確定（`doc/API設計/{A..L}_*.md`）。

### 4-3. テスト
- **backend pytest＝221 passed**（会社アイコン +5・本セッションでフル実行確認・`-v "$PWD/backend:/app"` マウント＝即反映・MinIO は Fake で非依存）。
- **frontend e2e**（本セッションで green 確認・各 spec 単独＋FLUSHALL）＝`sc-91`(8) ／ `sc-92-company-detail`(2) ／ `sc-92b-accounts`(2) ／ `sc-93-own-accounts`(4) ／ `sc-90-quest-group-admin`(3) ／ `sc-92c-quest-groups`(1) ／ `sc-92b2-account-edit`(1)。**DataTable URL 同期・会社アバター・RowMenu 修整に回帰なし**。
- 会社アイコンの実 MinIO 署名URL（prefix `company-icons/`）はホストから **HTTP 200＋有効 PNG** を確認（`curl`）。
- **既知の壊れ/フレーク**＝(1) backend `test_a_tc_040` が pytest-randomly のランダム順で稀に IndexError（単独/別シードで green・既存）。(2) frontend TS の既存エラー2件＝`Snackbar.tsx:57`・`ShopView.tsx:98`（**今回変更と無関係のデモ画面**・`npx tsc --noEmit` で顕在）。(3) e2e で複数の OPS ログイン spec を連続実行するとログインのレート制限でフレーク＝**1ファイルずつ＋各前に `redis-cli FLUSHALL`** で切り分ける。

## 5. 詰まっている点（試して失敗した / 注意）
- **署名URL 画像は e2e（コンテナ内ブラウザ）では実ロード不可**＝署名 host は公開 `localhost:9000`（＝ホストに公開の MinIO）だが Playwright のブラウザは frontend コンテナ内で動くため到達できず `naturalWidth=0`。**e2e は img の `src` 属性（`/avatars/`・`/company-icons/` を含むか）だけで検証**（既存 `sc-03-images` と同方針）。実ロード可否はホストから `curl`。実ユーザーのブラウザはホスト上＝到達する。
- **MinIO 署名URL の docker ホスト問題**＝backend は内部 `minio:9000` で put/remove、ブラウザは公開 `localhost:9000` で GET。`storage.py` は2クライアント（`_ops`/`_url`）に分離し、**両方に `region=` を明示**（`presigned_get_object` が region 未指定だと GetBucketLocation の HTTP を打ち 500）。
- **Alembic の revision id は 32文字以内**（`alembic_version` が `varchar(32)`）。会社系 migration は `migrations/control/versions/`（最新 `0010_accounts_pending_email`）。会社DB系は `migrations/company/versions/`。
- **CSS 二重定義**＝`.btn-outline` は `design-system.css` と `components.css` の両方にあり import 順で後者が勝つ（片方だけ直しても効かない）。usermenu も二重定義。
- **next/image は `images.unoptimized:true`**（next.config）＝素の img 描画のため署名URL の remote host 許可設定は不要。
- **DataTable URL 同期のループ回避**＝書き戻し effect の依存に `searchParams` を入れない（基点は `window.location.search`）。入れると replace→searchParams 変化→再発火の無限ループになる。
- **frontend 再ビルドで Playwright chromium/依存が消える**＝毎回 `install-deps chromium`(root)＋`install chromium`。`docker compose cp` した使い捨て spec/png も再ビルドで消える＝rebuild 後に再 cp。
- **frontend は `next dev`**（Dockerfile は source コピーのみ＝`build` で型チェックは走らない）。型は `docker compose exec -T frontend npx tsc --noEmit` で明示チェック。
- **稼働 backend はソース焼き込み**＝反映は再ビルド（`up -d --build backend`）。**openapi 変更時は `schema.d.ts` を codegen 再生成**（§8）。
- **background の Bash は cwd 非継承・foreground sleep 不可**＝compose は絶対パス、待機は `curl`/`pg_isready` ループで判定。

## 6. 決定事項と根拠
- **実装順＝アカウント登録→クエスト管理→アイデア→評価→その他**（`doc/実装計画.md`・2026-08-19 ユーザー選択）。C が D/E/F/フィードの門番。
- **アップロードは後回しにしない**＝MinIO 共通基盤で アバター/背景（P1・完了）→クエストアイコン（P2）→アイデア添付（P3）→チャット添付（P5）を再利用。**会社アバターも P1 基盤を流用して本セッションで実装**（管理系の付随機能）。
- **会社アバターは専用 multipart EP（`.../icon-image`）で実装**（K.4 と同流儀）。当初 B.1 は create/patch ボディの `icon_image_path?`（既存キー直指定）想定だったが、画像を実アップロードして key を得る手段が無く読取も生キー＝不完全。K.4 の実績パターンに合わせ設計（B.1）も更新。作成は「作成→アイコン PUT」の2段。`icon_image_path?` ボディは補助手段として残置。
- **一覧状態（検索/ソート/絞込/ページ）は URL クエリ同期**（2026-08-20 ユーザー選択・推奨案）。理由＝ドリルイン→戻るで条件が消えるのは不便／URL が SoT なら再読込・共有・ブラウザ戻るも自然に成立。**採用しなかった案**＝(A)「詳細からの戻りのみ復元」＝軽量だがブラウザ戻る/再読込は非対応で中途半端。(B)「現状維持」＝仕様どおりだが UX 不便。表示状態（列/密度/ビュー）は従来どおり localStorage（サーバーに送らない原則は不変）。
- **画像は会社DB `users`/管理DB `companies` 直接更新（identity でない＝outbox 経由しない）＋短TTL 署名URL・恒久公開URL 禁止**（K.4/B.1・§1.10）。
- **MinIO テストは Fake storage で非依存**（`set_storage`＝mail と同流儀）。
- **ツールチップは単一 `.has-tip[data-tip]` に統一**（ネイティブ `title` 不使用）。
- **ヘッダーのアイコン/表示名は `/me` 由来**（session スナップショットだと変更が反映されない）。

## 7. 次にやること（優先順・具体的に）
1. **（ユーザー確認中）登録アカウントでログインまで**＝system_admin で会社作成→会社DB プロビジョニング（MVP 手動・§8-⑫＝`status=active` 化）→アカウント発行→初回PW設定リンク（MailHog）→ログイン。**suspended のままだと一般ユーザーのテナント API は 503**（§1.5）＝ログイン検証には `active` 化が要る点に注意。プロビジョニング/`active` 化の手順は未確認（要調査＝`scripts/bootstrap.py` や compose の seed、`companies.status` 更新方法）。
2. **フェーズ2「クエスト管理（C ドメイン）」着手**（実装計画 §2 フェーズ2）。
   - 着手前に **`doc/API設計/C_クエスト・パーティー・権限.md`** と画面 **`doc/画面設計/screens/SC-10/SC-11/SC-12`**＋mocks を精読。既存4層テンプレ＝`control_plane/{me,admin}`・`tenant/{profile,quest_group,gamification}`。
   - 会社DB に **quests/quest_members（パーティー）/権限** テーブル（`migrations/company/versions/000x_*`・**revision id 32字以内**）＋ORM＋repository＋application＋router（テナントAPI・`get_tenant_session`・門番 C.0＝パーティー所属）。
   - 画面接続＝SC-10 一覧（DataTable・**URL 同期は §3-γ で全 DataTable に効く**）／SC-11 作成モーダル／SC-12 詳細。**クエストアイコン画像**は `infra/storage`（P1 基盤・`validate_image_upload` 流用）で同時実装（FR-20）。
   - §1.1 の1画面ループ＋**受入ゲート（ユーザー動作確認）で必ず止める**。
3. **時系列フィード（SC-12→SC-01）**＝C の周回で `GET /quests/{id}/activities`→`GET /me/feed`（API設計 G.5.1・門番 C.0・公開種別のみ）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**。
- **現在の稼働状態＝全サービス起動中**（本セッションで `--profile workers up -d --build` 済み）。停止していたら下記で起動。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000（`/healthz`）／db :5432／redis :6379／minio :9000(API)/:9001(コンソール)／mailhog UI :8025。**e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend**＝`build frontend`→`up -d frontend`。
- **openapi 型再生成**＝backend 再ビルド後 `docker compose -f impl/compose.yaml exec -T -e OPENAPI_URL=http://backend:8000/openapi.json frontend npm run codegen` → `docker compose -f impl/compose.yaml cp frontend:/app/src/lib/api/schema.d.ts impl/frontend/src/lib/api/schema.d.ts`。
- **backend テスト**（cwd=`impl`）＝`docker compose -f impl/compose.yaml run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（マウント即反映・migration 適用・MinIO 不要）。※db が起動直後は `pg_isready` を待つ。
- **frontend 型チェック**＝`docker compose -f impl/compose.yaml exec -T frontend npx tsc --noEmit`（既存エラー2件は §4-3(2)）。
- **frontend e2e**（Docker）＝(1)`exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2)`exec -T frontend npx playwright install chromium` (3)`exec -T redis redis-cli FLUSHALL`（各 spec 前）(4)`exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**複数 spec は1ファイルずつ**（連続 OPS ログインのレート制限フレーク回避）。spec 差替＝`cp impl/frontend/e2e/x.spec.ts frontend:/app/e2e/x.spec.ts`（再ビルドで消える＝再 cp）。
- **MinIO env（既定・dev）**＝`MINIO_ACCESS_KEY=ideaquest`/`MINIO_SECRET_KEY=ideaquest-secret`/`MINIO_BUCKET=ideaquest`。バケットは `MinioStorage._ensure_bucket()` が初回作成。コンソール `http://localhost:9001`。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。※ログインで +10 XP/JST日（G.6）。ACME-01 に獲得履歴デモをシード済み。MailHog＝`http://localhost:8025`。
- 規約＝`CLAUDE.md` から辿る。**実装順の正＝`doc/実装計画.md`**。デザインの正＝`doc/画面設計/mocks/*.html`（style-guide.html §16 ツールチップ）＋`screens/*.md`＋`デザイン標準.md`（§4.5⑨＝一覧状態 URL 同期）。API 設計＝`doc/API設計/{A..L}_*.md`＋`README.md`（§1.8.1 DataTable 契約・URL 同期）。データモデル＝`doc/データモデル.md`（残高/台帳 §5.27・§7、画像列 §5.3・会社 icon §4.1、フィード §8-㉑）。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に必ず削除。
