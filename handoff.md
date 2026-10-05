# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-05（セッション末）
- ブランチ: `main`（main 直 push が本プロジェクトの慣習・本セッションは都度 push 済）
- 最新コミット: `d3621e48 docs: お知らせ Phase2＋ダッシュボード再設計の実装現況/遷移図を追随更新`
- working tree: clean（全てコミット済み）
- alembic heads: control=`0019_company_access_mode` / company=**`0054_announcements`（本セッション追加）**。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別 DB・ゲーミフィケーション付き）。
直近フェーズ＝**ダッシュボード再設計（5ゾーン D→E→B→C→A）＋お知らせ機能（FR-49）＋アイデアコンテスト統合/参加運用（FR-46）＋詳細UI統一**。

## 3. 今回やったこと（コミット順・いずれも main push 済）
1. `00c3df50` ダッシュボード再設計 Phase1 増分2/3＝ゾーン順 **D→E→B→C→A**＋Zone D（お知らせ/募集中コンテスト/おすすめクエスト）・Zone E（参加中=クエスト+コンテスト/フォロー中=アイデア+クエスト）構築。`GET /dashboard` に `open_contests`/`joined_contests`/`recommended_quests` 合成（I.3）。自分のクエストは SC-10 スイッチ（すべて/所有者/参加中/参加リクエスト中/フォロー中）へ移設。TC＝I-TC-164/165/166・C-TC-306（red→green）。
2. `989e85e7`/`2a65dece` ダッシュボードのフォローは**星マークのみ（枠なし）**＝`.follow-star`（ON=金★/OFF=白抜き☆）・フォロー中見出しの★も金色。
3. `07f0b0b7` **詳細ヘッダー操作の横断統一（デザイン標準 §4.14 新設）**＝クエスト/アイデア/コンテスト/プロジェクトの4詳細で `.detail-head__actions`＝一次アクション→編集(権限時)→⋮(削除danger)。コンテスト詳細に編集ボタン新設（`ContestFormModal` を ContestListView から抽出し一覧/詳細で共用・DRY）。アイデア/プロジェクトは⋮に削除新設。
4. `1ebcc031` 同統一を**コンセプト詳細**へ横展開（計5詳細）。
5. `b4b33487` **コンテスト参加前はタブ非表示/参加後表示**＋ヘッダーで**参加⇄退席トグル（確認ダイアログ）**。自己退席 `DELETE /contests/{id}/participation`＝status `left`（decided_by=本人）／管理者排除 `rejected`（主体区別）。`ContestDetail.my_status` 追加。一覧 SC-53 に「参加方式」列（誰でも参加/承認制）。TC＝T-TC-202/203。
6. `62e7ac66`（backend）＋`8b84e2c0`（frontend）＋`d3621e48`（docs）**お知らせ機能 Phase2（FR-49・新ドメイン U）**＝下記 §4。

## 4. お知らせ機能（FR-49・ドメイン U）の要点
- **設計正本**＝`doc/設計ドラフト/ダッシュボード再設計・お知らせ_設計.md` §4。採番＝FR-49（要件定義）／データモデル §5.65 `announcements`・§5.66 `announcement_reads`／API `doc/API設計/U_お知らせ.md`／テスト `doc/テスト/U_お知らせ.md`（U-TC-101〜109）。
- **backend**＝`app/tenant/announcements/`（ORM/repository/application/schemas/router）＋migration `0054_announcements`＋`app/core/richtext.py`（info/derive から sanitize_html/to_plain_text を抽出・info は再エクスポートで後方互換）。閲覧=全ユーザー（`GET /announcements`・`GET /{id}`・`POST /{id}/read` 冪等）／管理=管理者のみ（`/admin/announcements` POST/PATCH/DELETE・403二重防御）。body_html は保存時サニタイズ＋body_text 派生。論理削除・掲載期間・ピン・既読。`get_dashboard` に `announcements`（§4.3a 選別＝ピン優先→未読→既読非ピン除外・最大3）＋`announcements_unread_count` 合成。
- **frontend**＝共有 `components/richtext/`（`RichTextView`＝サニタイズ済HTML表示／`RichTextEditor`＝ツールバー contentEditable／`richtext.css`）。ダッシュボード Zone D 📢パネル実データ。SC-95 `/announcements`（一覧＋`/[announcementId]` 詳細・開くと既読化）。SC-96 `/admin/announcements`（DataTable＋RowMenu 📌トグル/編集/削除＋作成/編集モーダル）。ナビに「お知らせ」(全員)・「お知らせ管理」(管理者)。
- **検証済**＝U-TC-101〜109 red→green（router未登録で404のred確認）／info richtext 無破壊／build/vitest/tsc green／traceability 992／end-to-end DOM（作成201→管理一覧→Zone D〔📌/抜粋〕→SC-95一覧〔未読〕→詳細〔strong描画・script除去・既読化〕・API `/dashboard` announcements 2件）。
- **残（follow-up）**＝(a) お知らせ本文の**画像再ホスト**は info 専用APIに依存＝共有 Editor では未対応。(b) **公開会社(access_mode=public)の外周403許可リストに announcements read を追加**（FR-48 連動・中央実装が未確立のため未対応／private 会社は一般も閲覧可）。(c) `doc/画面設計/screens/SC-95_*.md`・`SC-96_*.md` の画面設計書は未作成（遷移図には追加済み）。

## 5. 現在の状態（動く/テスト）
- **動く**＝backend/frontend とも再ビルド済・全サービス稼働中。お知らせ/ダッシュボード/コンテストを end-to-end でブラウザ(DOM)確認済み。
- **テスト**＝対象 backend（announcements 9・dashboard 15・contests 37）green／frontend build(41ページ)＋vitest green／tsc 変更分0／traceability ✅(992)。
- **⚠ backend フルスイートの既知失敗＝`tests/info` 4件**（`test_n_tc_002/003/004`・`test_n_tc_105`）＝**共有 dev DB 非冪等**（info 検索/フィルタが蓄積データを拾う・**私の変更を stash しても同一失敗＝無関係**と確認済）。メモリ `e2e-full-not-idempotent-shared-db` 参照。
- **画像目視の制約**＝本会話は画像枚数が上限に達し、スクショの目視取り込みが API 側で弾かれる。検証は **DOM/計算スタイル**（Playwright で locator count・innerText・computed style）に切替済み＝有効。

## 6. 詰まっている点（注意）
- **backend/frontend はソースをベイク（volumes 無）**＝反映は `cd impl && docker compose up -d --build backend|frontend`。pytest で未コミット編集を反映するには `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path>`。
- **新 migration を既存会社DBへ適用**＝`docker compose run --rm -T -v "$(pwd)/backend:/app" backend python -c "from alembic import command; from alembic.config import Config; from app.core.config import get_settings; s=get_settings(); [ (lambda c: (c.set_main_option('sqlalchemy.url', s.server_dsn(db)), command.upgrade(c,'head')))(Config('alembic_company.ini')) for db in ['ideaquest_company_acme','ideaquest_company_acme2'] ]"`（bootstrap と同経路）。
- **pytest をパイプ（`| grep | tail`）で流すと exit code が最後のコマンドのものになり失敗をマスク**＝フルは `pytest -q > /tmp/log 2>&1; echo $?` で直接 exit を取る。
- **`/dashboard` は response_model 無しの dict**＝frontend `DashboardData` 型は**手書き**（codegen 対象外）。U ドメイン（announcements）の型は codegen で `schema.d.ts` に入る。
- **詳細ヘッダー統一の共有CSS**＝`components.css .detail-head__actions`／フォロー星＝`components.css .follow-star`/`.follow-toggle`（ダッシュボードは star-only、詳細画面は toggle）。

## 7. 次にやること（候補・優先順）
1. **お知らせ follow-up**（§4 残）＝SC-95/96 の画面設計書 md 作成／公開会社 read 許可リスト（FR-48 連動）／画像再ホスト。
2. **info ドメインのフルスイート4失敗の解消**＝共有DB非冪等（info_env フィクスチャの user スコープ漏れ or フル前 drop→bootstrap）。②とは独立の衛生作業。
3. **デモデータ後始末**＝本セッションで目視用に acme DB へ投入したデモ（`【DEMO-ZB】` マーカーのアイデア/クエスト/コンテスト参加・`【検証】` お知らせ2件・user@acme の follow/コンテスト参加/クエスト owner,quest_admin 権限付与）。ユーザー了承で残置中。不要なら削除（`/tmp/dashshot/_seed_zone_b.py` は冪等再利用可）。
4. 要望ベースで UI 統一の継続・他機能（FR-43 ソリューション開発／FR-42 コンセプト の深掘り 等）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`、frontend `impl/frontend`、backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`http://localhost:8000`、frontend=`http://localhost:3000`、openapi=`http://localhost:8000/openapi.json`。
- 反映：`cd impl && docker compose up -d --build backend|frontend`。型再生成は backend 再ビルド後 `cd impl/frontend && npm run codegen`。
- テスト：backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`／未コミット反映は上記 `run --rm -v` マウント。frontend `cd impl/frontend && npm run build`／`npx vitest run <path>`／`npx tsc --noEmit`。TC トレーサビリティ `cd <repo root> && python3 scripts/check_tc_traceability.py`。
- 目視：画像取り込みが不可の間は Playwright の使い捨て `_chk.mjs`（ログイン→goto→locator count/innerText/computed style を console.log）で DOM 検証。ログイン＝会社 `ACME-01`／一般 `user@acme.example`／管理 `kanri@acme.example`（company_account_admin）・いずれも `Passw0rd!`。
- e2e：`cd impl/frontend` で Playwright。フル e2e は共有dev DB 非冪等＝前に acme/acme2 drop→bootstrap（メモリ `e2e-full-not-idempotent-shared-db`）。
