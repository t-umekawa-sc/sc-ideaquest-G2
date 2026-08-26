# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-26**（セッション終了時・時刻は概算）。
- ブランチ: `main`。**本セッションで 3 スライスを実装**＝(A) 通知 H `security_*`（push 済み `6daa68d`+`58e7b73`）／(B) リアルタイム L（push 済み `f8c0861`+`0b6a378`）／(C) **ダッシュボード集約 I（本 handoff コミット直前の作業ツリー・コミット可否はユーザー指示）**。
- I 実装＝**フル end-to-end（全パネル＋クイック投票＋フォロー★）＋ login_bonus ワンショット**（ユーザー選択 2026-08-26）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router、バック＝FastAPI 4層。開発は**1画面単位で backend 接続ループ**。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)。**現況の正＝[`impl/README.md`](impl/README.md)**。

## 3. 今回やったこと（3スライス）

### 3-A. 通知 H `security_*`（push 済み `6daa68d`）
new_device/password_changed を in-app＋メール＋監査で発火。`mail_outbox.params`（migration 0017 系は既存・追加 0012）／`auth/security_events.py`／`notifications.notify_account`。詳細は git log。

### 3-B. リアルタイム L（WS 配信・push 済み `f8c0861`）
新ドメイン `app/tenant/realtime/`（events/hub/gate/router）＝`GET /api/v1/realtime`。プロセス毎ハブ（`redis.asyncio` PSUBSCRIBE・company_id フィルタ）。発行＝H notify post-commit／E chat post-commit／C 除去で `publish_revoke`。フロント＝`lib/realtime.ts`＋`RealtimeProvider`/`LiveAppHeader`。詳細は git log。

### 3-C. ダッシュボード集約 I（本セッションのメイン・SC-01）
- **新ドメイン `app/tenant/dashboard/`**＝
  - `application.py` `get_dashboard(session)`＝**読取合成の殻**（新業務ロジックなし・I.0）。パネル＝hero/drafts(quest/idea/eval)/unvoted_ideas/quests/followed_ideas/weekly_ranking/notifications/roles/login_bonus。**部分失敗は `_safe` でパネル単位 null**（全体は落とさない・I.4）。company_id 未解決/user 無しのみ 401。
  - `router.py`＝`GET /api/v1/dashboard`（`Depends(require_me)`・読取専用）。**response_model なし＝dict 返却**（FE は `api.ts` で手動型付け）。
  - `login_bonus.py`＝Redis ワンショット（`mark`/`consume`＝GETDEL・キー `dashboard:login_bonus:{user_id}`・24h TTL）。
- **横断 read（別 EP 新設せず・I.3）**＝D `ideas/repository.py` に `list_draft_ideas_by_author`/`list_unvoted_published_ideas`/`list_followed_ideas`／F `evaluations/repository.py` に `list_draft_evaluations_by_evaluator`／C `quests/repository.py` に `list_member_quest_ids`。
- **リッチパネルは既存 application 再利用**＝週間ランキング＝`gami_app.get_rankings(period=this_week, scope=company, limit=3)`（返り値＝`{data, me, page_info}`）／参加中クエスト＝`quests_app.get_quests(status=非draft, limit=6)["data"]`／下書きクエスト＝`get_quests(status=["draft"])`／通知＝`notif_app.get_notifications(limit=5)`。hero＝users 残高＋`level_progress`＋署名URL。roles＝session（is_qg_admin/system_role）。
- **login_bonus 結線**＝`auth/application.py` `_issue_session`＝`grant_daily_login` が Activity を返した（当日初回付与）時に `login_bonus.mark(r, user.id, granted.amount)`。I が `consume` で1回だけ返す。
- **frontend**＝`features/dashboard/api.ts`（`getDashboard`＋型）。`DashboardView` をデモ fixtures から `GET /dashboard` 実データへ全面差替（空パネル非表示）。クイック投票＝`voteIdea(id, "approve"|"oppose")`（楽観＝リストから除外・失敗ロールバック）／フォロー解除＝`unfollowIdea`（楽観）。login_bonus＝`useSnackbar`（reward トースト・1回）。ヒーロー初期値は server の `/me` 残高（page.tsx が displayName/balance/admin を渡す＝初回描画のフォールバック）、取得後は集約 hero 優先。
- **テスト**＝`doc/テスト/I_ダッシュボード.md`（I-TC-101〜143）＋`tests/dashboard/test_api.py`（6件）。red-green＝`_drafts`/`_unvoted` に `return []` 一時差込で I-TC-103 red→撤去で green（`red確認台帳.md` に I 節）。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. backend（pytest）
- **`pytest tests/`（全体）＝442 passed（0 failed）**（436→+6＝I 6）。cwd=`impl` 厳守。
- migration＝control head は **0012**（L/I は新 migration 無し＝I は Redis/読取のみ）。**backend/frontend/worker は本セッションで再ビルド済み**。`GET /api/v1/dashboard` 未認証 401 を実アプリで確認。
### 4-2. frontend（tsc・e2e）
- **tsc＝既知1件のみ**（`Snackbar.tsx:122`）。I のフロント変更はクリーン。
- **e2e＝SC-01 のブラウザ確認はバッチへ**（§7.5）。backend 契約は I 6 件で担保。既存 e2e は前セッション green のまま。
### 4-3. テスト運用
- **TC-ID トレーサビリティ ✅（code 374）**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。

## 5. 詰まっている点（試した/注意）
- **`get_quests` の (A) 可視は「所属クエストグループ × パーティー参加」の AND**＝ダッシュボードの参加中クエスト/下書きクエストを出すには、対象ユーザーが `quest_group_members`（有効）にも居る必要がある。テスト seed は `qg_repo.upsert_membership(ts, gid, uid, "member")` を必ず入れる（`tests/dashboard/test_api.py` 参照）。未投票の絞り込みは `quests_repo.list_member_quest_ids`（パーティーのみ）で足りる。
- **login の副作用（security_new_device）**＝ダッシュボードの通知パネル検証では seed 後に `security_new_device` を purge（`_login_dash`）。
- **login_bonus の当日初回**＝`grant_daily_login` は「新 JST 日の初回」で1回だけ Activity を返す。dev で同じ account が同日再ログインしても付与されない＝login_bonus は出ない。テストは factory の新規 account を使い、`_flush_redis`（autouse）でワンショットキーも毎テスト初期化されるので I-TC-110 は決定的。
- **/dashboard は dict 返却（response_model なし）**＝openapi に厳密型が出ないため FE は `features/dashboard/api.ts` で手動型付け。バックの DTO キーを変えたら api.ts も追随。
- **既存フラキー**＝`tests/mail_outbox`/A-TC-038 系は順序依存で稀に落ちるが単独 green・本セッションと無関係。mail アサーションは宛先で絞る流儀（security テスト）を踏襲。
- **共有 control DB 汚染（継続）**＝`t-umekawa`（非 OPS system_admin）。現状 442 passed で無害。

## 6. 決定事項と根拠
- **I スコープ＝フル end-to-end＋login_bonus**（ユーザー選択 2026-08-26）。
- **集約1本 `GET /dashboard`**（設計 I.0 採用理由＝ランディングの1往復・パネル固定）。横断 read は D/F repo に置き別 EP を新設しない（I.3・匿名化/門番を各ドメインで一元適用）。
- **設計 I.5 TBD を実装で確定**＝件数上限（通知5/未投票・参加・フォロー各6/下書き全件）・並び（下書き/フォロー＝更新降順・未投票/参加＝締切近い順）・部分失敗＝パネル単位 best-effort（null）・login_bonus＝Redis ワンショット（GETDEL）。`doc/API設計/I_ダッシュボード集約.md` I.5 に反映済み。
- **リッチパネルは既存 application 再利用**（DRY・re-実装しない）＝ランキング/クエストカード/通知は各ドメインの application を呼ぶ（自前セッション・読取・best-effort）。横断のみ repo read を新設。
- **ヒーロー残高の正準は K の `/me`**＝I も `/dashboard` に同梱（両立・別用途・I.4/K.1）。
- （継続）テスト運用＝md 先行＋TC-ID＋red確認台帳。ブラウザ受入は後日バッチ（§7.5）。

## 7. 次にやること（優先順・具体的に）
1. **全文検索 J（SC-12/SC-22）**＝`doc/API設計/J_全文検索.md`。着手前に該当 API/画面/データモデル正本を開き、**スコープ確認**（検索対象範囲・匿名化/門番・PG 全文 or 別基盤）。
2. **その他の横断/仕上げ**＝`doc/実装計画.md`「その他」＋`impl/README.md` の 🟡/未接続を確認。L/I の follow-up（下記）も候補。
- 着手前に `impl/README.md` の現況と正本を開く。**未着手ドメインはユーザーへスコープ確認**。
- **完了済み横断**＝通知 H（発火系フル＋security_*）・リアルタイム L（WS 配信フル）・ダッシュボード I（集約フル）。**横断で残るのは主に J（全文検索）**。
- **I の follow-up（任意・将来）**＝各 read の並列化/キャッシュ・レベルアップ演出・通知ベル簡易ドロップダウン・実績サマリ・未投票/フォローの付加情報（category/comment_count）・3D アバター（I.5 残 TBD）。

## 7.5 ブラウザ受入待ち（バッチ）
- **運用（ユーザー確認 2026-08-25）**＝ブラウザ受入は後日まとめて（e2e green でクローズ扱い・次へ進む）。一覧は `impl/README.md`「ブラウザ受入状況」節。
- **I 追加分**＝SC-01 ダッシュボードで (1) 参加中クエスト/フォロー中/未投票/下書き/週間ランキング/最近の通知が実データで出る（空パネルは非表示）(2) 未投票カードの▲賛成/▼反対で投票が確定しリストから外れる (3) フォロー★解除でカードが外れる (4) 当日初回ログイン直後に login_bonus トーストが1回出る。dev＝ACME-01 `user@acme.example`（同クエストのパーティー＋グループ所属・公開アイデア/下書き/評価を用意）。
- **L 追加分**（前スライス・未消化）＝ベル/SC-02 の WS 即時反映・SC-24 chat 即時反映・パーティー除去の購読失効。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。db/redis/minio/mailhog/backend/frontend/worker/mail-worker は本セッションで Up＋再ビルド済み。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。ポート＝frontend :3000／backend :8000／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **反映**＝frontend `... up -d --build frontend`／backend `... up -d --build backend worker mail-worker`。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。I＝`tests/dashboard`・L＝`tests/realtime`・security＝`tests/notifications/test_security.py`。
- **frontend tsc**＝`cd impl/frontend && npx tsc --noEmit`（既知1件＝Snackbar.tsx:122）。
- **TC-ID 検査**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。
- **会社/管理DB migration 適用**＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`（冪等）。
- **dev ログイン（PW 全て `Passw0rd!`）**＝一般 `ACME-01`/`user@acme.example`（MFA OFF）／`ACME-02`/`mfa@acme2.example`（MFA ON）／system_admin `OPS`/`admin@ops.example`。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`。現況の正＝`impl/README.md`。API＝`doc/API設計/{A..L}_*.md`（I＝`I_ダッシュボード集約.md`・L＝`L_リアルタイム配信.md`）。データモデル＝`doc/データモデル.md`。テスト＝`doc/テスト/*.md`（`I_ダッシュボード.md`）＋`red確認台帳.md`。
