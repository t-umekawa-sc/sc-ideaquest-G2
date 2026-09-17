# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-17 JST**（FR-40 発見カタログ SC-13 の設計正規化＋申請者側スライス実装を行ったセッション。手前で [B]①〜⑤・[C]①②・一覧規約化も完了）
- ブランチ: **main**（受入/レビュー反映＝main 直コミット。`feature/game-feel` は今回未使用）
- 最新コミット: **afc61f2** `feat(quests): SC-13 カタログにメタ詳細ダイアログ＋リスト RowMenu を追加`（この後の handoff コミットが実 HEAD）
- **push 済み・未 push 0**（`main...origin/main` 同期・確認済み）
- 本セッションの主なコミット（古い順・すべて push 済み）＝
  `9aaeec9`([B]② GET /quests sort)→`3944c16`(一覧状態復元テスト M-TC-016/017)→`a57da50`([C]① 無変更ガード)→`a25d1b3`([C]② メンション整合)→`894a3fb`([B]③ ダッシュボード純テスト)→`78fb955`(list_query→app/core 移動)→`002f0d8`/`0870d53`/`d3b2de3`([B]⑤ shop 完全サーバー委譲 B2+)→`3bb7c73`(一覧規約化)→`3542e9c`([B]① 認証監査ログ)→`ec95ca7`([B]④ realtime テスト)→`3d10969`/`b6f5d67`(FR-40 設計正規化)→`0bdf1a8`/`7cad686`/`afc61f2`(FR-40 SC-13 実装)。

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションするマルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`・会社ごと物理分離DB）。全画面 backend 接続済みで、現在は**新機能の縦スライス実装フェーズ**（FR-40 クエスト発見/フォロー/参加リクエスト）。

## 3. 今回やったこと（変更ファイルと理由）

### 0. FR-40「クエスト発見/フォロー/参加リクエスト」＝設計正規化 → SC-13 申請者側スライス実装（今セッションの主軸・**再開の起点**）
- **設計正規化（`3d10969`/`b6f5d67`）**＝`doc/設計ドラフト/クエスト発見_フォロー_参加リクエスト_設計.md` を各正本へ展開。未確定2点をユーザー決定＝**発見カタログは新規画面 SC-13**／**却下後は作成者側の再承諾のみ**（`rejected→approved`・申請者の再申請は当面不可）。反映先＝要件定義 FR-40／データモデル（`quests.discoverable`・`quest_join_requests`§5.8b・`quest_follows`§5.8c・enum `join_request_status`・`notification_type` に3種）／API設計 C.9（門番 `can_discover_quest`＋発見/フォロー/参加リクエスト EP）／H（通知3種）／画面 `SC-13_発見カタログ.md` 新設＋SC-01 §4.6b/c・SC-12 §4.3・画面遷移図。ドラフトは「正規化済み」に更新。
- **backend 実装（`0bdf1a8`・申請者側スライス）**：
  - migration **`0027_quest_discovery.py`**（`migrations/company/versions/`）＝`quests.discoverable` 列＋`quest_join_requests`/`quest_follows` テーブル。ORM＝`app/tenant/quests/orm.py`（`Quest.discoverable`・`QuestJoinRequest`・`QuestFollow`）。
  - `app/tenant/quests/repository.py`＝`can_discover_quest`（discoverable ∧ 部署交差／0件=全社・status∈{recruiting,in_progress,evaluating}・中身門番 `can_access_quest` と別のメタ専用）・`build_catalog_query`（list_query の sort ホワイトリスト・offset）・my_state 用の一括参照（`member_quest_ids`/`followed_quest_ids`/`join_request_status_map`）・follow/join-request プリミティブ・`list_owner_and_admin_ids`（通知先）。
  - `app/tenant/quests/application.py`＝`get_quest_catalog`（DataTable サーバー契約・`my_state`＝member/pending/rejected/following/none・メタのみ）・`get_catalog_detail`・`follow_quest`/`unfollow_quest`・`request_join`/`withdraw_join_request`＋`_notify_join_request_received`。
  - `app/tenant/quests/router.py`＝`GET /quest-catalog`・`GET /quests/{id}/catalog-detail`・`POST/DELETE /quests/{id}/follow`・`POST/DELETE /quests/{id}/join-request`。schemas＝`app/tenant/quests/schemas.py`（`QuestCatalogCardDTO`/`QuestCatalogResponse`/`FollowResponse`/`JoinRequestBody`/`JoinRequestResponse`）。通知テンプレ＝`app/tenant/notifications/catalog.py` に `join_request_received`。
  - テスト＝`tests/quests/test_catalog.py`（**C-TC-260〜264**・門番/my_state/フォロー/参加リクエスト＋通知/409/404/sort422/番号ページャ）。台帳＝`doc/テスト/C_クエスト.md` §7。
- **frontend 実装（`7cad686`＋`afc61f2`）**：ルート `impl/frontend/src/app/(app)/quest-catalog/page.tsx`・`src/features/quests/components/QuestCatalogView.tsx`（DataTable **サーバーモード**＝一覧規約 §4.1／`refreshToken` でアクション後再取得／`my_state` バッジ／★フォロー／参加をリクエスト）。**カードクリック→詳細ダイアログ `CatalogDialog`**（作成者/締切/参加人数/アイデア数/カテゴリー/参加部署/テーマ全文＋アクション・中身は参加後の旨明示）＋**リスト表示の RowMenu**（`menuItems`）。api＝`src/features/quests/api.ts`（`catalogQueryParams`/`fetchQuestCatalog`/`getCatalogDetail`/`followQuest`/`unfollowQuest`/`requestJoinQuest`/`withdrawJoinQuest`）。ナビ導線＝`src/components/layout/AppNav.tsx` に「🔎 クエストを探す」。

### 1. 手前で完了した backlog（`doc/テスト/カバレッジギャップ.md` 参照）
- **[B] 実装ギャップ**＝ ①認証イベント監査ログ（`3542e9c`・A-TC-111〜115）②`GET /quests` sort（`9aaeec9`）③ダッシュボード populated 純テスト（`894a3fb`・I-TC-107/108/122/131/141〜143）④リアルタイム L-TC-103/131（`ec95ca7`）⑤`GET /items` 完全サーバー委譲 B2+（shop 一覧を DataTable サーバーモード化・`d3b2de3` ほか）＝**すべて完了**。残は⑥`chat_preview`（将来）のみ。
- **[C] 設計乖離**＝ ①無変更保存ガード（`a57da50`・D-TC-229）②メンション整合（`a25d1b3`・E-TC-228）＝**残なし**。
- **一覧サーバー委譲の規約化**（`3bb7c73`）＝作り直し防止。`list_query` を `app/core` へ移動。恒久メモリ `list-server-delegation-standard`。

## 4. 現在の状態（動作/テスト）
- **動いているもの**＝SC-13 発見カタログ（申請者側＝カタログ閲覧・詳細ダイアログ・フォロー・参加リクエスト作成/取消）が backend＋frontend で通し動作（実機スモークで確認済み・下記 §5 の落とし穴は解決済み）。
- **テスト通過状況**＝**backend 全体スイート `627 passed`**（最後に確認したのは `7cad686`〔`lq` 修正後〕。最新 `afc61f2` は frontend のみの変更＝backend 未変更のため 627 のまま・**再確認は未実施**）。`tests/quests/test_catalog.py` = **catalog 5 passed**（個別確認済み）。フロント `npm run build`（tsc＋ESLint＋Next lint）通過。**pytest 全体実行時は `worker`＋`mail-worker` 両方を止める**（`docker compose stop worker mail-worker`）＝稼働のままだと outbox 系（`test_b_tc_005`）がリトライ競合でまれに落ちる（フレーク・単独 green・§8）。
- **トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` = **✅ code 614 件すべて md 記載**（catalog 追加後に確認）。
- **受入デモ**＝ACME-01 の seed 会社DBに**発見デモの discoverable クエストを1件 seed 済み**（「【発見デモ】部署横断アイデア募集」・owner=別ユーザー・seed ユーザーは非メンバー＝`/quest-catalog` に `my_state=none` で表示）。seed ユーザーの follow/join は**リセット済み（クリーン）**。※DB リセットで消える一時データ。
- **コンテナ**＝本セッション末時点でフル起動中（frontend/backend は本 slice のコードで再ビルド済み・codegen 済み）。次セッションでは落ちている想定＝§8 で再起動。
- **壊れているもの**＝認識している範囲では無し。

## 5. 詰まっている点（試して失敗したアプローチ＝次回の近道用）
FR-40 SC-13 実装中に嵌った点（すべて解決済み）:
- **alembic「Multiple heads」**＝新 migration の `down_revision` を `0024` にしたら、既存 `0025_quest_outcomes`→`0026_chat_message_pin` と分岐して head が2つに。→ **現 head（`0026_chat_message_pin`）の後に繋ぐ**＝`0027_quest_discovery`（revision チェーンは `grep -h "revision" migrations/company/versions/*.py` で確認する）。
- **`GET /quest-catalog?page&per_page` が 500（NameError: lq）**＝`get_quest_catalog` の offset 分岐で `list_query` 未 import。テストは page 未指定分岐しか叩かず見逃した。→ `app/tenant/quests/application.py` に `from app.core import list_query as lq` を追加。**教訓＝offset ページャの EP は「page/per_page 指定あり」のケースも必ずテストする**（`test_catalog.py` C-TC-264 に追加済み）。
- **成功ログイン系テストで `database "ideaquest_test_XXXX" does not exist`**＝`factory.make_company()` はテナントDBを**プロビジョニングしない**ため、成功ログイン（`_issue_session` がテナント user を解決）が落ちる。→ **成功ログイン/カタログ系テストは seed 会社アカウント**（`factory.make_seed_company_account()`＝ACME-01／`make_seed_mfa_account()`＝ACME-02）を使う。失敗/未セッション系は make_company で可。
- **受入デモの状態リセットが効かない**＝`delete where user_id==me` で消えず（seed user id の解決差異？未確定）。→ **デモ会社DBの `quest_join_requests`/`quest_follows` を全削除**して確実にリセット（下記 §8 のスニペット）。
- **Modal/QuestIcon の `size="md"` は型エラー**＝`Size` は `xs|sm|lg` のみ（"md" 不可）。→ `lg` を使う。

## 6. 決定事項と根拠（採用しなかった案も）
1. **発見カタログは新規画面 SC-13**（SC-10 タブ追加ではない）＝可視範囲（`can_discover_quest` vs `can_access_quest`）と責務が別のため分ける（ユーザー決定）。
2. **却下は非終端だが再申請は作成者側の再承認のみ**（`rejected→approved`・`rejected→pending` 不可）＝仕様単純・スパム防止（ユーザー決定）。`withdrawn`（自己取消）からの再申請は許可。
3. **一覧は最初からサーバー委譲契約で作る**（`list_query`＋DataTable サーバーモード・列 flags=backend ホワイトリスト一致）＝client→server の作り直し回避。正＝フロントエンド実装フロー規約 §4.1・恒久メモリ `list-server-delegation-standard`。SC-13 一覧もこれに準拠（cursor でなく offset＝shop/companies と同型）。
4. **発見はメタのみ**（件数・作成者・締切・カテゴリ・参加部署まで）＝中身〔アイデア本文/チャット/評価〕は参加後（`can_access_quest` は現状維持）。フォロー通知も「新着は件数のみ」。
5. **【要決定・未決】活発度スパークライン**＝ユーザーから「ダイアログに活動の活発さをグラフで／それをクエスト画面に流用できるか」と相談があり、**「共有 UI 部品＋クエスト単位の同一形状データで作れば SC-12/SC-22 に流用可」**と回答済み。進め方 A（共有 `ActivitySpark` 部品を抽出＋既存 SC-22 の inline 活発度バーも置換＋クエスト単位活動集計を `catalog-detail` に追加＋SC-13 にグラフ）／B（まず数値＋ラベルのみ・グラフは後）を提示したが、**ユーザーの選択は未回答のままセッション終了**（§7-2 参照）。

## 7. 次にやること（優先順・具体的に）
1. **SC-13 の再受入待ち**＝カードクリック→詳細ダイアログ＋リスト RowMenu を実装済み（`QuestCatalogView.tsx`）。ユーザーのブラウザ受入（OK/NG）が未回答。再開時にまず受入可否を確認する。
2. **【未回答の質問】活発度スパークラインの進め方 A/B**（§6-5）＝再開時にユーザーに A（共有部品＋グラフ・SC-22 も共有化）か B（数値＋ラベルのみ）を確認してから着手。既存資産＝backend `GET /ideas/{id}/chat-activity`（`app/tenant/chat/application.py get_chat_activity`・`ChatActivityResponse{daily:[{date,message_count}],...}`・**アイデア単位**）／frontend は `src/features/ideas/components/IdeaDetailView.tsx` が「活発度バー」を **inline** で描画（`sparkBars`・未部品化）。A の場合＝①`components/ui` に共有 `ActivitySpark`（`daily:[{date,count}]`＋任意マーカー）を抽出し IdeaDetailView を置換 ②backend に**クエスト単位活動集計**（そのクエストの公開アイデア群の日次件数を横断集計・chat repo 流用）を `catalog-detail` 応答に追加（メタ限定・+TC）③SC-13 ダイアログに数値+ラベル+スパークライン。**メタ限定＝本文は出さない**は共通前提。
3. **FR-40 残スライス（受信側・作成者/quest_admin）＝未実装**：`GET /quests/{id}/join-requests`・`POST /quests/{id}/join-requests/{uid}/approve`・`.../reject`（C.9.1 に仕様あり）。承認で `quest_members` 追加＋通知 `join_request_decided`（`app/tenant/notifications/catalog.py` にテンプレ追加要）。repo に `list_join_requests`・`list_owner_and_admin_ids` は用意済み。UI＝SC-12 パーティータブ（`QuestPartyPanel`／`QuestPartyModal`）に pending 上位・rejected 下部・行クリックでプロフィールダイアログ→承諾/拒否（SC-12 §4.3）。
4. **FR-40 残スライス（作成者が discoverable を立てる）＝未実装**：SC-11 に discoverable トグル。backend＝C.2 の create/update（`application.py create_quest_flow`/`update_quest` ＋ `QuestCreateRequest`/`QuestUpdateRequest` schema に `discoverable`）／frontend＝`QuestForm.tsx` にトグル。※現状は seed か直 DB でしか立てられない。
5. **FR-40 残スライス（フォロー通知 `quest_watch_update`）＝未実装**：クエストのステータス変化/締切/新着件数でフォロワーへ post-commit 通知（メタ級）。発火点＝クエスト状態遷移（C.5）・締切変更・アイデア公開。catalog テンプレ追加要。
6. **FR-40 残スライス（ダッシュボード SC-01）＝未結線**：§4.6b フォロー中クエスト・§4.6c 参加リクエスト状況の frontend 結線（backend は `quest_follows`／`my_state` あり・集約 EP は要検討）。
7. **推奨：まとまった変更の前に backend 全体スイートを一度回す**（`afc61f2` 後の再確認は未実施＝§4）。

## 8. 再開に必要な環境情報
- **作業ディレクトリ**＝リポジトリルート `/home/t-umekawa/sc-ideaquest-G2`。docker 操作は必ず **`impl/`** から。
- **コンテナ起動（フル・受入用）**＝`cd impl && docker compose --profile workers up -d`。ポート＝frontend **3000**・backend **8000**・MailHog UI **8025**・MinIO **9000**。
- **backend 改修の反映**＝`cd impl && docker compose build backend && docker compose up -d backend`（source 無マウントのためベイク＝再ビルド必須）。**OpenAPI 変更時は frontend の型再生成**＝`cd impl/frontend && npm run codegen`（稼働 backend:8000 の openapi.json を引く＝先に backend を再ビルド起動しておく）。
- **frontend 改修の反映**＝`cd impl && docker compose build frontend && docker compose up -d frontend`（**ブラウザは DevTools「Disable cache」でリロード**しないと古い JS/CSS が残る）。
- **frontend ビルドゲート**＝`cd impl/frontend && npm run build`（tsc＋ESLint＋Next lint）。frontend e2e＝`npx playwright test <spec> --project=chromium --reporter=line`（要 frontend:3000）。
- **backend pytest（最新 source 反映）**＝`cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend python -m pytest <path> -k "<expr>" -q`。**`-v` マウント必須**。**全体実行時は先に `docker compose stop worker mail-worker`**（§4 のフレーク回避）。新 migration は本コマンド起動時の bootstrap で seed 会社DBに適用される。
- **トレーサビリティゲート**＝リポジトリルートで `python3 scripts/check_tc_traceability.py`（コミット前に ✅ 必須）。
- **seed ログイン**＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`（MFA 会社は `ACME-02`）。
- **発見カタログ確認**＝ログイン→左ドロワー「🔎 クエストを探す」（`/quest-catalog`）。デモ discoverable クエストが1件出る。
- **受入デモの状態リセット（follow/join を消してクリーンに）**＝`cd impl && docker compose run --rm -T backend python -c "from app.control_plane.auth.orm import Company; from app.db.control import control_session; from app.db.tenant import get_tenant_session; from app.tenant.quests.orm import QuestFollow, QuestJoinRequest; from app.tenant.notifications.orm import Notification; \nwith control_session() as s: db=s.query(Company).filter_by(company_code='ACME-01').one().db_identifier\nwith get_tenant_session(db) as ts: ts.execute(QuestJoinRequest.__table__.delete()); ts.execute(QuestFollow.__table__.delete()); ts.execute(Notification.__table__.delete().where(Notification.type=='join_request_received')); ts.commit()"`（複数行のため実行時は python スクリプト化推奨）。
- **discoverable 発見デモの再 seed**（DB リセット後）＝`app/tenant/quests/repository.py create_quest`＋`create_group_links`＋`add_member` で他ユーザー owner の recruiting クエストを作り、`Quest.discoverable=True` を立て、seed ユーザーの所属グループ（`qg_repo.list_active_group_ids_for_user`）に link する（会話の seed スクリプト参照・本文は貼らない）。
- **コミット規約**＝末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。受入/レビュー反映は main 直コミット可。
- **正本の場所**＝実装現況 `impl/README.md`／実装順 `doc/実装計画.md`／規約 `doc/規約/*`（一覧サーバー委譲＝フロントエンド実装フロー規約 §4.1）／設計ドラフト `doc/設計ドラフト/*`／テスト台帳 `doc/テスト/*`（backlog＝`カバレッジギャップ.md`）／横断UI標準 `doc/画面設計/デザイン標準.md`。FR-40 の正＝FR-40／データモデル §5.6/§5.8b/§5.8c／API設計 C.9／H／`SC-13_発見カタログ.md`。

---
### 自己チェック（これだけで再開できるか）
- ✅ 最新コミット `afc61f2`・push 状態・ブランチ・本セッションのコミット列を明記。
- ✅ 再開の起点＝FR-40 SC-13（申請者側 backend＋frontend 実装済み・受信側/discoverable トグル/フォロー通知/ダッシュボード結線は未実装）を §3/§7 にファイル・関数レベルで明記。
- ✅ **未回答の質問**（スパークライン A/B・SC-13 再受入）を §6-5/§7-1/§7-2 に明記＝再開時にまずユーザーへ確認。
- ✅ テスト状況＝backend 627 passed（`afc61f2` 後は未再確認）・catalog 5 passed・traceability ✅(614)・build 通過を明記。
- ✅ 詰まった点（alembic head/lq 未import/make_company のテナントDB無/リセット/Modal size）と近道を §5 に記録。
- ✅ 起動/再ビルド/codegen/pytest（worker 停止）・受入デモの seed/リセット・seed 認証を §8 に明記。
- ⚠️ 未確認事項＝(1) `afc61f2`（frontend のみ）後の backend 全体スイート再実行（未実施・627 のはず）(2) 受入デモのリセットが `user_id` 絞りで効かなかった根本原因（全削除で回避済み・未究明）。
