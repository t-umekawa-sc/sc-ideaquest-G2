# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-25**（セッション終了時・時刻は概算）。
- ブランチ: `main`。**作業ツリーはクリーン**（本 handoff コミット前時点で未コミットなし）。
- 最新コミット（本 handoff コミット前）: **`22fd272`** `feat(H/SC-02): 通知一覧のフロント接続`。**push 状況＝本 handoff コミットで origin/main へ push 予定**（handoff 更新直前の実測＝ローカルが origin/main より 2 先行＝`33a2273`/`22fd272` が未 push だった）。再開時は `git status -sb` で ahead=0 を確認。
- 本セッションの主なコミット（新しい順）: `22fd272`(通知H frontend SC-02)／`33a2273`(通知H backend＋発火8フック結線)／`c45edd6`(実績 SC-40 frontend)。
- **直近の履歴（参考・本セッション前）**: `91315ad`(実績 backend)／`5982621`(ランキング SC-41)／`9ab3054`(ショップ/アバター SC-30/31)。それ以前に E チャット・F 評価・魔法 SC-32 も接続済み（詳細は git log と `impl/README.md`）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（dev モード起動）、バック＝FastAPI 4層（router/application/repository/infra）、DB＝PostgreSQL/Redis/MinIO/MailHog/Docker。開発は**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)＝アカウント→クエスト(C)→アイデア(D)→評価(F)→その他。**現況の正＝[`impl/README.md`](impl/README.md)**（画面別/EP別の済・未・追随更新）。

## 3. 今回やったこと（変更ファイルと理由）

### 3-A. 通知ドメイン H の backend 新設（`33a2273`）— スコープ＝「テナント発火系フル」（ユーザー選択 2026-08-25）
- **新ドメイン `impl/backend/app/tenant/notifications/`**＝`orm.py`(Notification)・`repository.py`(add/get_for_recipient/list_for_recipient〔カーソル〕/unread_count/mark_all_read・全て recipient スコープ)・`catalog.py`(取得時レンダリング §8-⑳・ja・種別→body/context/tag/icon/meta を ref 解決＋params 差し込み)・`service.py`(`notify`＝**宛先重複排除**〔1イベント×1宛先＝最具体1件・`TYPE_PRIORITY`〕＋`dispatch`＝post-commit best-effort・at-most-once＋`_publish`＝**L=WS まで no-op**)・`application.py`(get_notifications/get_unread_count/mark_read/mark_unread/mark_all_read)・`schemas.py`・`router.py`。
- **migration `impl/backend/migrations/company/versions/0017_company_notifications.py`**＝`notifications`（`params jsonb`・`body` NULL 可・`ref_idea_id/ref_chat_message_id/ref_idea_revision_id/ref_achievement_id/ref_quest_id`・`is_read`・`created_at`・index `(recipient_id,is_read,created_at)`）。
- **API 5 EP**（`app/main.py` に `notifications_router` 登録）＝`GET /api/v1/notifications`（state=all/unread・type 複数・limit/cursor §1.8・unread_count 同梱）／`GET /notifications/unread-count`／`POST /notifications/{id}/read`／`/unread`／`/read-all`（body `{type?}`）。**自分宛スコープ＝他人宛は 404（IDOR）**・変更系 Origin/CSRF。
- **発火8フックを no-op から実結線**（各ドメイン application）＝
  - `app/tenant/chat/application.py`：`_notify_message_posted`（mention/idea_comment/follow_comment・post-commit dispatch・投稿者除外）／`_notify_reaction`（magic_reaction・投稿者宛・reactor 除外・spell 識別子凍結）。
  - `app/tenant/ideas/application.py`：`_notify_idea_updated`（版追加時・**投票者∪フォロワー − 編集者**・in-session）。
  - `app/tenant/evaluations/application.py`：`_notify_follow_evaluation`／`_notify_follow_selection`（フォロワー − 操作者・in-session）。
  - `app/tenant/achievements/engine.py`：`_notify_achievement`（実績解放時・本人宛・**台帳フックの同一 UoW で in-session**）。
  - `app/tenant/quests/application.py`：`_notify_party_invited`（publish/即公開・追加パーティー員〔owner 除く〕・post-commit dispatch・owner 表示名を params 凍結）。
  - 宛先解決ヘルパを `app/tenant/ideas/repository.py` に追加＝`list_follower_ids`・`list_voter_ids`。
- **テスト**＝`doc/テスト/H_通知.md`（H-TC-101〜143 api＋§1e H-TC-208 e2e）新設。`impl/backend/tests/notifications/test_api.py`（15 件）。`tests/conftest.py`・`tests/chat/test_api.py`・`tests/quests/test_sc11_api.py` の teardown に**通知行の掃除**を追加（notifications が users/ideas/quests/messages を FK 参照するため参照先削除の前に消す）。`doc/テスト/red確認台帳.md` に H の red 証跡。

### 3-B. SC-02 通知一覧のフロント接続（`22fd272`）
- `impl/frontend/src/features/notifications/api.ts` 新設＝`getNotifications`/`getUnreadCount`/`markRead`/`markUnread`/`markAllRead`。
- `impl/frontend/src/features/notifications/components/NotificationsView.tsx` をデモ fixtures から実接続へ書換＝未読数・行・**サーバー取得時レンダリング済み body**・context/tag/`meta.coin` を描画。状態/種別（**9カテゴリー**＝mention/comment/eval/select/update/achievement/magic/quest/security をサーバー `type[]` 絞り込みへマップ）・日付グループ（today/yesterday/earlier をクライアント算出）・行クリックで既読化＋`ref` から遷移（chat/idea/achievements/quest）・楽観更新＋サーバー権威・すべて既読。
- `impl/frontend/src/lib/api/schema.d.ts` を codegen で再生成（NotificationDTO 等）。
- e2e `impl/frontend/e2e/sc-02-notifications.spec.ts` を旧デモ回帰から実データ照合（H-TC-208）へ置換。

### 3-C. 直前セッションの SC-40 実績 frontend（`c45edd6`）
- `features/achievements/api.ts`＋`AchievementsView.tsx` を `getAchievements` に接続（収集サマリー実データ・シークレット伏せ・DataTable）。e2e G-TC-207。※backend `91315ad` は前セッション。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. backend（pytest）
- **本セッション末に `pytest tests/`（backend 全体）＝422 passed（0 failed）を確認**（407→+15＝通知 H 15 件）。
- 登録ルータ＝auth/admin/me（control_plane）・quests/ideas/evaluations/chat/gamification/shop/achievements/**notifications**（tenant）。EP 別の詳細は `impl/README.md`「backend API 進捗」。
- 会社DB migration は **0017 が head**。**適用は `scripts.bootstrap` が冪等に `alembic upgrade head`**（`docker compose ... run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`）。本セッションで ACME-01 等に 0017 適用済みを確認。
### 4-2. frontend（tsc・e2e）
- **tsc＝既知1件のみ**（本セッション確認）＝`impl/frontend/src/components/ui/Snackbar.tsx:122`（既存デモ）。※前 handoff の ShopView.tsx:98 は G 接続時に解消済み。今回の変更はクリーン。
- **接続済み画面**（`impl/README.md` 画面テーブルが正）＝SC-00／SC-01(部分＝ヒーロー残高のみ)／SC-03,K／SC-10／SC-11／SC-12(部分)／SC-21／SC-22／SC-24／SC-25／SC-30／SC-31／SC-32／SC-40／SC-41／**SC-02**／SC-90/91／SC-92/93。
- **まだモック/部分**＝SC-02 の security_* 種別（未結線）／SC-01 のダッシュボード集約(I)／SC-12 の週間ランキング列・全文検索(J)／リアルタイム(L)。
- **e2e**＝本セッションで green を実測したのは `sc-02-notifications`(H-TC-208・1) のみ。他 spec（sc-24/25/30/32/40/41/22/21/92d 等）は**前セッションで green・今回は未再実行**（`impl/README.md` 進捗行に一覧）。
- **注＝dev の `next dev` はコールドコンパイルで各 spec の最初の login が稀にタイムアウト→ウォームで再実行すれば green**（継続観測）。
### 4-3. テスト運用
- **TC-ID トレーサビリティ ✅（code 354・本セッション末に確認）**。`python3 scripts/check_tc_traceability.py`。新規 EP は test-first／後追い・ガードは反転手技を `doc/テスト/red確認台帳.md` へ（テスト規約 §5.1）。
- 本セッションの red-green 証跡＝(backend) `service.notify()` に `return []` を一時差込→H api 15 件中 13 件 red→撤去で green。(e2e) 接続前デモ「4 件の未読」が実 API unread_count と不一致で red→再ビルドで green。

## 5. 詰まっている点（試した/注意）
- **notifications の FK と teardown**＝`notifications` は `users`/`ideas`/`quests`/`chat_messages`/`idea_revisions`/`achievements` を参照。発火を伴うテスト（chat mention・quest publish）の teardown で参照先を消す前に通知行を消す必要があった（`recipient_id` or `ref_quest_id` で削除）。**新たに発火を伴うテストを足すときは同様の掃除を忘れると teardown で IntegrityError**。factory 経由の throwaway ユーザーは `tests/conftest.py` が `Notification` を掃除済み。
- **`notify()` の dedup はイベント単位**＝同一 `notify()` 呼び出し内で同一宛先の複数種別は最具体1件に畳まれる。**テストで「同一ユーザーに複数通知」を作るには別イベント（別 `notify()` 呼び出し）にする**（`tests/notifications/test_api.py` の `_seed` vs `_seed_each` 参照）。
- **frontend はソース非マウント**（`impl/compose.yaml` に volume 無し）＝コード反映に `up -d --build frontend` 必須。接続前バンドルで e2e の red を目視できる（本セッションの red-green もこの方式）。
- **backend ソースは pytest 時のみマウント**（`run --rm -T -v "$PWD/backend:/app"`）＝test は再ビルド不要。**実アプリ/openapi へ反映するには `up -d --build backend`**（本セッションで実施＝codegen と e2e が新 EP を叩けるようにした）。
- **backend テスト/コマンドの cwd 罠**＝`-v "$PWD/backend:/app"` は **cwd=`impl` 前提**。必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl`。
- **既存フラキー**＝`tests/mail_outbox` の `test_a_tc_095` 等・A-TC-038/040/063/068 系は全体実行の順序依存で稀に落ちるが**単独 green**・本セッション変更と無関係。
- **共有 control DB 汚染（継続注意）**＝dev 永続 `ideaquest_control` に手動追加の `t-umekawa`（非 OPS の active system_admin）が居る。last_system_admin 保護は OPS スコープに限定済み（前セッション `5cc05e8`）なので現状 422 passed で無害だが、OPS が無効化される汚染に再遭遇したら §8 の psql で復元。

## 6. 決定事項と根拠
- **通知 H スコープ＝テナント発火系フル＋security_*/L 後回し**（ユーザー選択 2026-08-25）＝mention/idea_comment/follow_comment/magic_reaction/idea_updated/follow_evaluation/follow_selection/achievement/quest_party_invited を結線。`security_new_device`/`security_password_changed` は**コントロールプレーン auth 由来で会社DB へ書く cross-plane 結線**が要るため follow-up。Redis publish（`notifications:{user_id}`）は WS トランスポート（ドメイン L）とセットなので `service._publish` を no-op（TODO(L) 明記）。
- **生成の in-session と post-commit の使い分け**＝実績(achievement)/idea_updated/follow_* は**すでに開いている書込 UoW 内で `notify(session, entries)`**（取りこぼしゼロ・トランザクショナル）。chat 投稿/魔法・quest publish は**本体 commit 後に `dispatch(company_id, builder)`**（別セッション・best-effort・at-most-once＝二重生成しないが取りこぼしうる＝H.1 の意味論）。`expire_on_commit=False`（`app/db/tenant.py`）なので post-commit の id アクセスは安全。
- **本文＝取得時レンダリング**（§8-⑳）＝`body` を発火時に確定せず `GET` 時に受信者ロケール（現状 ja のみ実装）でテンプレ＋`params`＋`ref_*` から組む。ref から辿れる値（idea/quest/実績/魔法名）は都度解決、辿れない/可変値（actor_name・revision・tier・coin・spell 識別子）は `params` に凍結。
- **重複排除＝1イベント×1宛先＝最具体1件**（`TYPE_PRIORITY`・mention>magic_reaction>idea_comment>follow_comment>…）。
- **SC-02 の「すべて既読」は絞り込みに関わらず全既読**（一般的 UX・H.3 は type 省略で全件）。
- **enum は String 列**（プロジェクト方針・notification_type も String(40)）。
- （継続）テスト運用＝md 先行＋TC-ID トレーサビリティ＋red確認台帳。会社プロビジョニングは MVP 手動。ブラウザ受入は後日バッチ（§7.5）。

## 7. 次にやること（優先順・具体的に）
1. **通知 H 後半＝security_*（cross-plane）**＝ログイン成功時の新端末検知（`app/control_plane/auth/application.py` のログイン成功パス）と PW 変更完了（`auth` の初回設定/再設定＋`app/control_plane/me/application.py` の自己 PW 変更）から、ログインで確定した `company_id`（PW 変更は token→account→company_id）でテナント DB へ `notify()`（`security_new_device`/`security_password_changed`・`params` に device/ip/at）。`security_password_changed` はメールも（A 経路）。catalog に本文テンプレは実装済み（未結線なだけ）。SC-02 の種別フィルタ「セキュリティ」も実データで出るようになる。テスト＝`doc/テスト/H_通知.md` に §（security）を追加し API設計 H.0 表と A.9-⑧ を根拠に。
2. **リアルタイム L（WS `notifications:{user_id}`）**＝`app/tenant/notifications/service.py` の `_publish` を実装（行 INSERT 後に Redis publish）＋WS トランスポート（購読/転送）を新設。ヘッダーベルの未読バッジ即時更新。`doc/API設計/L_リアルタイム配信.md`・§1.12。
3. **ダッシュボード集約 I（SC-01）**＝`doc/API設計/I_ダッシュボード集約.md`＋`doc/画面設計/screens/SC-01`。週間ランキング/下書き/未投票/参加中等を集約 EP で。SC-01 は現状ヒーロー残高（`/me`）のみ接続。
4. **全文検索 J（SC-12/SC-22）**＝`doc/API設計/J_全文検索.md`。
- いずれも着手前に `impl/README.md` の現況と該当 API/画面/データモデル正本を開く。**未着手の H/I/J/L に着手する前にユーザーへスコープ確認**（本セッションの H と同様、発火元/cross-plane の範囲で判断が要る）。

## 7.5 ブラウザ受入待ち（バッチ）
- **運用（ユーザー確認 2026-08-25）**＝各画面のブラウザ受入は**その場では行わず後日まとめて**実施（e2e green でクローズ扱い・次へ進む）。**受入待ちの一覧は現況の正 [`impl/README.md`](impl/README.md)「ブラウザ受入状況」節に集約**（受入用デモデータ・dev ログイン・確認ポイント付き）。SC-02 通知（H-TC-208）も追記済み。ここには置かない（重複回避）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。セッション終了時点で**全サービス Up**（backend/frontend は本セッションで再ビルド済み）。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **反映**＝frontend `docker compose -f impl/compose.yaml up -d --build frontend`／backend `... up -d --build backend worker mail-worker`。**frontend 再ビルド後は playwright を再インストール**（`exec -T -u root frontend npx playwright install-deps chromium` ＋ `exec -T frontend npx playwright install chromium`）。
- **会社DB migration 適用**（新 migration 追加時）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`（冪等・全会社DB＋シード）。
- **frontend tsc**＝`cd impl/frontend && npx tsc --noEmit`（既知1件＝Snackbar.tsx:122）。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。範囲限定＝`tests/notifications` `tests/chat` `tests/quests` `tests/ideas` `tests/evaluations` 等。
- **e2e**＝(1)deps/browser 再インストール（上記）(2)`CID=$(docker compose -f impl/compose.yaml ps -q frontend); docker cp <spec> "$CID":/app/e2e/`(3)`docker compose -f impl/compose.yaml exec -T redis redis-cli FLUSHALL`(4)`docker compose -f impl/compose.yaml exec -T frontend npx playwright test e2e/<spec> --workers=1 --reporter=line`。**1ファイルずつ・login コールドコンパイルで初回落ちたらウォームで再実行**。
- **openapi 型再生成**（backend 再ビルド後・localhost:8000 が新 EP を出す状態で）＝`cd impl/frontend && npm run codegen`（既定 `http://localhost:8000/openapi.json` → `src/lib/api/schema.d.ts`）。
- **TC-ID 検査**＝`python3 scripts/check_tc_traceability.py`。コミット前ゲート。
- **DB 直接確認**（control DB）＝`docker compose -f impl/compose.yaml exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d ideaquest_control -c "..."'`。OPS 汚染復元＝`... -c "update accounts set status='active' where login_id='admin@ops.example';"`。会社DB は `-d ideaquest_company_acme`（ACME-01）等。
- **dev ログイン（PW 全て `Passw0rd!`）**＝一般 `ACME-01`/`user@acme.example`（MFA OFF・「テスト 太郎」・デモグループ所属）／`ACME-02`/`mfa@acme2.example`（MFA ON）／system_admin `OPS`/`admin@ops.example`。手動追加 `SYSCON`/`t-umekawa`（非 OPS system_admin＝§5 注意）。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`（各種規約＋設計正本のパス参照）。**現況の正＝`impl/README.md`**。UI 標準＝`doc/画面設計/デザイン標準.md`。API＝`doc/API設計/{A..L}_*.md`＋`README.md`。データモデル＝`doc/データモデル.md`（notifications＝§5.24）。テスト＝`doc/テスト/*.md`＋`red確認台帳.md`。
