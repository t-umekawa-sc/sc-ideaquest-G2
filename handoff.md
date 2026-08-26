# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-26**（セッション終了時・時刻は概算）。
- ブランチ: `main`。**本セッションでは 2 スライスを実装**＝(A) 通知 H `security_*`（コミット/push 済み `6daa68d`+`58e7b73`）／(B) **リアルタイム L（WS 配信）＝コミット状況は §末尾参照**。
- セッション開始時の最新コミット: `e55ddc1`。security_* コミット後＝`58e7b73`。L の差分は本 handoff コミット直前の作業ツリー（コミット可否はユーザー指示）。
- **L 実装＝フル（通知＋chat）を backend＋frontend で end-to-end**（ユーザー選択 2026-08-26）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router、バック＝FastAPI 4層。開発は**1画面単位で backend 接続ループ**。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)。**現況の正＝[`impl/README.md`](impl/README.md)**。

## 3. 今回やったこと

### 3-A. 通知 H `security_*`（cross-plane・コミット済み `6daa68d`）
- new_device（login/mfa verify）・password_changed（password-setup complete/自己PW変更）を in-app＋メール＋監査で発火。`mail_outbox.params`（migration **0012**）／`auth/security_events.py`／`notifications.notify_account`。詳細は git log と `impl/README.md`。

### 3-B. リアルタイム L（WS 配信ハブ）＝本セッションのメイン
- **新ドメイン `app/tenant/realtime/`**＝
  - `events.py`＝**publish は sync**（`get_redis().publish`）。`publish_event(topic,type,data,company_id)`／`publish_revoke(...)`／`notifications_topic`/`chat_topic`／`REVOKE_CHANNEL="realtime:revoke"`。封筒＝`{topic,type,data,id,company_id}`。
  - `hub.py`＝**プロセス毎シングルトン Hub**（`get_hub()`）。`redis.asyncio` で `PSUBSCRIBE notifications:* / chat:*` ＋ `SUBSCRIBE realtime:revoke`（背景タスク）。購読テーブル `dict[topic→set[Connection]]`。転送は購読集合＋**`company_id` フィルタ**（cross-tenant 遮断・最後の砦）。`_handle_revoke` で L.4 ドロップ。`start/stop` は lifespan から（`stop` はループ跨ぎに堅牢化済み）。
  - `gate.py`＝`can_subscribe_chat`＝REST と同一門番（`chat.application._resolve_chat_idea` を再利用＝公開アイデア＋パーティー参加）。存在秘匿で bool。
  - `router.py`＝**`GET /api/v1/realtime`**（Cookie セッション認証＝`read_session`・Origin 検証・未認証は accept せずクローズ）。接続を account/user/company にバインドし `notifications:{user_id}` **自動購読**。受信ループは `{op:subscribe|unsubscribe,topic}` の**購読制御のみ**（receive-only）。chat 購読は門番（threadpool で同期 gate）。
- **`app/main.py`**＝`realtime_router` 登録＋lifespan で `get_hub().start()/stop()`。
- **発行の結線**＝
  - **H**（`notifications/service.py`）＝`_publish` no-op を撤廃し、**post-commit publish**（SQLAlchemy `after_commit` フックに保留をためて commit 後に発行・rollback で破棄）。`notification.created`（catalog レンダリング済み表現＋unread_count）／既読操作で `notification.unread_count`（application の `_set_read`/`mark_all_read` から `publish_unread_count`）。**封筒 company_id はセッションの bind（db 名）→company_id を lru_cache で解決**（呼出側の company_id スレッディング不要）。
  - **E**（`chat/application.py`）＝post-commit で `chat.message.created/updated/deleted`・`chat.reaction.added/removed` を `chat:{cg}` へ（既存 DTO をそのまま data に・ビューア依存フィールドは best-effort）。
  - **C**（`quests/application.py` `remove_party_member`）＝除去後に当該クエストの全 chat_group へ `publish_revoke`（`chat_repo.list_chat_group_ids_for_quest` 追加）。
- **frontend**＝`lib/realtime.ts`（単一 WS・再接続バックオフ 1s→15s・`on(type)`/`onTopic(topic)`/`subscribe`/`unsubscribe`）。`features/notifications/RealtimeProvider.tsx`（ベル未読数の context・初期 seed=getUnreadCount・WS で即時更新）＋`LiveAppHeader.tsx`（components→features 依存を作らない薄い client ラッパ）。`(app)/layout.tsx` を `RealtimeProvider`＋`LiveAppHeader` に差し替え（従来のデモ unread 撤去）。`NotificationsView`（SC-02）＝通知イベントで再取得/未読更新。`IdeaChatView`（SC-24）＝`chat:{cg}` 購読で新着/編集/削除/リアクションを再取得。
- **テスト**＝`doc/テスト/L_リアルタイム.md`（L-TC-101〜121）新設。`tests/realtime/test_ws.py`（通知 4）＋`test_ws_chat.py`（chat 4）＝starlette `TestClient.websocket_connect`（context-managed で lifespan→ハブ起動）。red-green＝`events.publish_event` の type 破壊で配信 4 件 red→撤去で green（`red確認台帳.md` に L 節）。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. backend（pytest）
- **`pytest tests/`（全体）＝436 passed（0 failed）**（428→+8＝L 8）。**mail アサーションを宛先メールで絞り**、H-TC-153 等の順序依存フレークを解消（決定性）。cwd=`impl` 厳守。
- 会社/管理DB migration＝control は **0012 が head**（`mail_outbox.params`・L は新 migration 無し＝Redis/メモリのみ）。
- **backend/frontend イメージは本セッションで再ビルド済み**（実アプリに反映）。**WS は Next rewrite が :3000→backend へプロキシ確認済み**（未認証ハンドシェイクが 403＝backend 到達）。
### 4-2. frontend（tsc・e2e）
- **tsc＝既知1件のみ**（`Snackbar.tsx:122`）。L のフロント変更はクリーン。
- **e2e＝L のブラウザ即時反映（SC-02 ベル/SC-24 チャット）は未作成＝ブラウザ受入バッチへ**（§7.5・2 セッション必要で複雑。backend 契約は WS 8 件で担保）。既存 e2e は前セッション green のまま（今回フロント破壊なし）。
### 4-3. テスト運用
- **TC-ID トレーサビリティ ✅（code 368）**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。

## 5. 詰まっている点（試した/注意）
- **WS テストは lifespan 必須**＝配信ハブは lifespan 起動なので、WS テストは `with TestClient(app) as c:`（context-managed）で張る。conftest の素の `client` フィクスチャ（lifespan 無し）では WS が届かない。
- **2 セッション WS テストは 1 ループに集約**＝context-managed TestClient を 2 つ張ると 2 イベントループができ、シングルトンのハブがループ跨ぎで壊れる。片方（owner の REST/publish 用）は**素の `TestClient(app)`**（lifespan 不要）にし、WS を張るのは 1 つだけ（`test_ws_chat.py` L-TC-121 参照）。
- **login の副作用（security_new_device）**＝MFA-OFF ログインは毎回 new_device 通知＋監査を作る。WS/notifications テストの seed 後は `security_new_device` を purge（`_login_ws_user`/`_login_new` 参照）。auth を跨ぐテストで通知/監査件数を厳密検証するときは切り分け必須。
- **mail アサーションは宛先で絞る**＝`mail` フィクスチャの `.sent` は `process_mail_outbox_once()` で**全**pending を drain するため、他テストの行が混じる。`m.to == acc["email"]` で絞ると決定的（`tests/notifications/test_security.py` の `_mail_subjects(mail, to)`）。
- **publish の company_id**＝`notify()` は呼出側が company_id を渡さない。セッション bind の DB 名→company_id を lru_cache で解決している（`service._company_id_of`）。テスト DB を増やしても FK は無いので問題ないが、db 名→company_id が変わる運用があればキャッシュ注意。
- **chat 配信 data のビューア依存**＝リアクションの `mine` 等は発行元視点（best-effort）。フロントは受信で REST 再取得するので UI は正になる（L.3）。
- **既存フラキー**＝`tests/mail_outbox`/A-TC-038 系は順序依存で稀に落ちるが単独 green・本セッションと無関係。
- **共有 control DB 汚染（継続）**＝`t-umekawa`（非 OPS system_admin）。現状 436 passed で無害。

## 6. 決定事項と根拠
- **L スコープ＝フル（通知＋chat）×backend＋frontend**（ユーザー選択 2026-08-26）。
- **設計 TBD（L.5）を実装で確定**＝購読方式＝**パターン購読**（`PSUBSCRIBE notifications:*/chat:*`・実装単純）／失効チャネル＝**`realtime:revoke`**（`{user_id,chat_group_id,company_id}`）／ハブ購読テーブル＝**プロセス内 dict**（シングルトン）。`doc/API設計/L_リアルタイム配信.md` L.5 に反映済み。
- **publish は sync／購読は async**＝発行元（同期 application）は sync publish 1 コール、ハブだけ `redis.asyncio`。余計な async 化なし。
- **publish は post-commit**＝H は `after_commit` フック、E/C は `with` 抜け後の直接呼び出し。best-effort（例外は握り潰し・本処理成功を優先）。真実は REST（L は速報）。
- **cross-tenant 遮断**＝封筒 `company_id` とハブでのフィルタ（`user_id`/`chat_group_id` は UUID で実質会社一意だが多層防御）。
- **門番は REST と同一**＝chat 購読は `_resolve_chat_idea` を再利用（WS と REST の認可を一致）。
- **frontend の層分離**＝`AppHeader`（components）は features 非依存のまま。live 化は `LiveAppHeader`（features）で供給。
- （継続）テスト運用＝md 先行＋TC-ID＋red確認台帳。ブラウザ受入は後日バッチ（§7.5）。

## 7. 次にやること（優先順・具体的に）
1. **ダッシュボード集約 I（SC-01）**＝`doc/API設計/I_ダッシュボード集約.md`＋`doc/画面設計/screens/SC-01`。週間ランキング/下書き/未投票/参加中等を集約 EP で。SC-01 は現状ヒーロー残高（`/me`）のみ接続。
2. **全文検索 J（SC-12/SC-22）**＝`doc/API設計/J_全文検索.md`。
- 着手前に `impl/README.md` の現況と該当 API/画面/データモデル正本を開く。**未着手の I/J に着手する前にユーザーへスコープ確認**。
- **通知 H・リアルタイム L は完了**（H=発火系フル＋security_*・L=WS 配信フル）。残る横断は I/J。
- **L の follow-up（任意・将来）**＝`Last-Event-ID` 再送・ハートビート/接続数上限・プレゼンス/タイピング・外部通知（メール/Slack）・chat data のビューア依存最適化（L.5 残 TBD）。

## 7.5 ブラウザ受入待ち（バッチ）
- **運用（ユーザー確認 2026-08-25）**＝ブラウザ受入は後日まとめて（e2e green でクローズ扱い・次へ進む）。一覧は `impl/README.md`「ブラウザ受入状況」節。
- **L 追加分**＝(1) SC-02＋ヘッダーベル＝別ユーザーの発火で**未読バッジが即時**増える／既読で即時減る（2 セッション：発火者と受信者）。(2) SC-24＝別パーティー員の投稿/編集/削除/リアクションが**リロード無しで反映**。(3) パーティー除去で当該ユーザーの chat 即時停止（L.4）。dev＝ACME-01 の 2 ユーザー（`user@acme.example` ＋ もう1名を同クエストのパーティーに）。MailHog 不要（WS は Redis）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。db/redis/minio/mailhog/backend/frontend/worker/mail-worker は本セッションで Up＋再ビルド済み。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **反映**＝frontend `... up -d --build frontend`（WS クライアント）／backend `... up -d --build backend worker mail-worker`（ハブは backend プロセス内・lifespan 起動）。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。WS＝`tests/realtime`。
- **WS 疎通確認**（proxy）＝`curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" -H "Origin: http://localhost:3000" http://localhost:3000/api/v1/realtime`＝未認証で **403**（backend 到達＝proxy OK）。
- **frontend tsc**＝`cd impl/frontend && npx tsc --noEmit`（既知1件＝Snackbar.tsx:122）。
- **TC-ID 検査**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。
- **会社/管理DB migration 適用**＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`（冪等）。
- **dev ログイン（PW 全て `Passw0rd!`）**＝一般 `ACME-01`/`user@acme.example`（MFA OFF）／`ACME-02`/`mfa@acme2.example`（MFA ON）／system_admin `OPS`/`admin@ops.example`。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`。現況の正＝`impl/README.md`。API＝`doc/API設計/{A..L}_*.md`（L＝`L_リアルタイム配信.md`・§1.12）。データモデル＝`doc/データモデル.md`。テスト＝`doc/テスト/*.md`（`L_リアルタイム.md`）＋`red確認台帳.md`。
