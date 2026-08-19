# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-19 JST**
- ブランチ: **main**（作業も main に直接コミットしている）
- 直近コミット（このハンドオフ以外）＝**`e19ed2c` fix(共通ヘッダー) / `89e2ec6` feat(SC-01) XPツールチップ / `776d7f7` feat(G) 活動台帳＋ログインXP**。
- 作業ツリー: **clean**。push 済み（本セッション分＋handoff）。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝**画面移植は完了**。今は **backend 接続フェーズ**を **1画面単位ループ**で回している（フロー規約 §1.1）。

## 3. 今回やったこと（変更ファイルと理由）
本セッション＝再開時に handoff 検証（pytest 195/ e2e）→ **G 活動台帳の最小接続**＋**SC-01/共通ヘッダーの UI 修正3点**。

### 3-1. 再開時の検証（handoff との突合）
- backend pytest 再現＝**195 passed**（一致）。フル e2e は直列 42/43（並列はログインレート制限フレーク・§5）。
- **`sc-92c-quest-groups B-TC-116` が再現失敗**を発見→ **SC-01 前コミット `8b89e21^` の旧レイアウトで再ビルドしても同一箇所で失敗**＝SC-01 回帰ではなく**既存のテスト脆弱性**（RowMenu `position:fixed` の「リネーム」menuitem が viewport 外・`force:true` でも `Element is outside of the viewport`）と確定。**未修整（別件）**。

### 3-2. G 活動台帳（activities）最小実装（`776d7f7`・§1.1 を1周）
- 残高 write の canonical＝**付与/消費は `activities` 追記＋`users` 残高更新を同一 UoW**。
- 新設＝`migrations/company/versions/0007_company_activities.py`（データモデル §5.27・kind/amount/reason/quest_id/ref_type/ref_id/created_at・4インデックス・`user_id` は同一DB内 FK RESTRICT／`quest_id`/`ref_id` は物理FKなし＝多態/未実装ドメイン）。
- 新設＝`app/tenant/gamification/`＝`orm.Activity`／`repository`（`exists_reason_between`日次冪等・`exists_ref`参照冪等・`add`）／`daily`（純粋 `jst_date`/`jst_day_bounds_utc`・JST日境界 §7）／`ledger`（`grant`＝残高更新＋XP時 `level_progress` でレベル再計算＋差分だけ `levelup_sp` 発行／`grant_daily_login`＝ユーザー×JST日で1回・冪等・LOGIN_XP=10）。
- 配線＝`auth/application.py::_issue_session`（ログイン成功パス・MFA有/無 両方通る）に `grant_daily_login`。**会社DB は管理DBと別Tx**（冪等ゆえ last_login_at 側が失敗しても二重付与しない）。
- **付与フック点＝ログイン成功時のみ（最小・2026-08-19 ユーザー選択）**。フルcanonical（require_session で毎リクエスト＝持続セッションも毎日成立）は次スライスに委ねる。
- red-green（§5.1）＝配線前に統合テストが `assert 0 == 10`（GET /me balance.xp）で behavior-red→配線で green。
- 追随＝`tests/me/test_me tc_004`（ログインで +10 XP＝xp10/次まで90 へ）／`tests/conftest`（activities は FK RESTRICT のため user 削除前に掃除）。
- **範囲外（後続）**＝`GET /me/activities` 履歴／投票・投稿・評価・購入・解放（spend 系）／実績フック（G.4）。

### 3-3. SC-01/共通ヘッダー UI 修正3点（`89e2ec6`＋`e19ed2c`）
- **XPバーのホバーツールチップ**（`89e2ec6`）＝ホバー/フォーカスで「獲得 XP {レベル内}/{必要量}（累計{総XP}）」。`lib/me.heroBalance` に `xpInLevel`/`levelSpan`/`xp` 追加。ツールチップ(::after)は `overflow:hidden` の `.xp-bar` だと切れる→ラッパー `.xp-bar-wrap` に描画。e2e 回帰ガード＝`data-xp` が /me と一致（`sc-01-dashboard.spec`）。
- **アクションメニュー**（`e19ed2c`）＝(a) 非表示の管理項目が挟む「空の帯」を解消＝権限が1つも無ければ区切り線ごと非描画（高さ0）／(b) 区切り線が透明で見えなかった（`.usermenu__list li > *` の `background:none`(0,1,1) が `.usermenu__sep`(0,1,0) を上書き）→高特異度(0,2,1)でリセット＝padding0・1px・`--color-border-strong`(slate-300) の**視認できるグループ罫線**に。目視＋computed style(`rgb(203,213,225)`)で確認。

### 3-4. ユーザー受入（§1.1 step4）
- ログイン XP＝実 API/ブラウザで ACME-01 ログイン→ヒーロー Lv.1・XP10・NEXT 90 XP を確認、冪等（再ログインで増えない）も確認＝**受入 OK**。UI 3点も screenshot で受入 OK。

## 4. 現在の状態（動く/壊れている/テスト）
### 4-1. フロント
- 画面移植は全完了。`features/` は 17 ディレクトリ。
- **backend 接続済み**＝認証 SC-00・プロフィール SC-03/K・管理 SC-90/91/92/93・**SC-01 ヒーロー残高＋共通ヘッダー通貨（GET /me 残高）**。
- **残高が実データで動く**＝ログイン XP（G.6 login）で XP/レベル/進捗が動く（コイン/SP は購入・解放・実績など後続で動く）。
- **デモ fixtures（未接続）**＝SC-02/10/11/12/21/22/24/25/30/31/32/40/41、SC-01 の週間ランキング/下書き/未投票/参加中クエスト/フォロー中（G/C/D/I 接続まで demo）。

### 4-2. backend
- 登録ルータは **auth/admin/me の3つ**（新EP追加なし＝ログイン XP はログイン副作用・`GET /me` 応答形も不変）。
- 実装済み＝`control_plane/{auth,admin,me,account_sync,audit,mail_outbox}`・`tenant/{profile,quest_group,gamification}`。**`tenant/gamification` に activities 台帳（orm/repository/daily/ledger）を追加**（level 純粋関数は既存）。
- **未実装ドメイン**＝G の残り（ショップ/装備/魔法/実績/ランキングの各EP・spend 系・`GET /me/activities`）／H 通知／D アイデア・E チャット・F 評価・I ダッシュボード集約・L WS。API 設計は全ドメイン確定（`doc/API設計/{A..L}_*.md`）。

### 4-3. テスト
- **backend pytest＝203 passed**（前 195＋gamification 8＝daily3/ledger3/login2）。テストは `-v "$PWD/backend:/app"` マウントで即反映（entrypoint bootstrap が migration 0007 も自動適用）。
- **フル e2e はランダム順（pytest-randomly 相当）＋並列ログインでフレーク**。回帰確認済み＝`sc-01-dashboard`・`k-profile` green（直列）。
- **既知の壊れ**＝(1) `sc-92c B-TC-116`（前述・既存脆弱性・SC-01無関係）。(2) backend `test_a_tc_040`（パスワード設定メール）がフル実行のランダム順で稀に `mail.sent[1]` IndexError＝**順序依存の既存フレーク**（単独・別シードで green・本セッション変更と無関係）。

## 5. 詰まっている点（試して失敗した/注意）
- **backend/frontend はソース焼き込み（bind mount 無し）**＝稼働反映は再ビルド。backend＝`up -d --build backend worker mail-worker`／frontend＝`build frontend`→`up -d frontend`。**openapi 変更時のみ** frontend `schema.d.ts` を codegen 再生成（今回は不変で不要）。
- **frontend 再ビルドで Playwright chromium/依存が消える**＝e2e 前に毎回 `install-deps chromium`(root)＋`install chromium`。**さらに `docker compose cp` で入れた使い捨て spec/png も再ビルドで消える**＝rebuild 後に再 cp が必要（今回ハマった）。
- **CSS の落とし穴（今回）**＝(1) `overflow:hidden` の要素に `::after` ツールチップは切れる→ラッパーに出す。(2) `.usermenu__list li > *`(0,1,1) の `background:none`/`padding` が `.usermenu__sep`(0,1,0) を上書き＝区切り線が透明・膨張。高特異度(0,2,1)で打ち消す。**layout.css と design-system.css が usermenu を二重定義**（段階移行の負債）＝layout.css が後 import で勝つ。
- **フル e2e フレークの切り分け**＝`--workers=1`＋`redis-cli FLUSHALL`。単体/直列で green なら回帰ではない。
- **background の Bash は cwd 引き継がない**＝`docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml ...` の絶対パス。
- **red-green の red 観測**＝新規挙動は「配線前に統合テストを走らせて behavior-red を撮る」が最も綺麗（今回 `assert 0==10`）。実装済み変更は `git stash push -- <app パス>`（パスは repo ルート基準）。
- **セッション→会社DB user**＝`accounts.id`(管理DB)≠`users.id`(会社DB)。会社DB users は `users.account_id==account_id` で引く（`profile/repository.get_user_by_account`）。テナントDB＝`get_tenant_session(Company.db_identifier)`（**commit しない**＝書込み時は明示 commit）。
- `getByRole("heading",{name})` は部分一致＝別見出し衝突に `exact:true`。

## 6. 決定事項と根拠
- **backend 接続は1画面単位ループ＋受入ゲート**（§1.1）。**各画面の実装後は必ず止めてユーザー動作確認**（運用メモリにも保存）。
- **G 台帳 canonical＝`activities` が真実・`users` 残高はキャッシュ・同一 UoW**（データモデル §7）。レベル/進捗は §7 純粋関数で xp から算出（`users.level` に依存しない）。**ログイン XP のフック点＝ログイン成功時のみ（最小）**、フルcanonical は後続。
- **`GET /me` は K.1 正準のネスト形**（`{account,profile,balance,system_role}`）。
- UI＝**共通ヘッダーのアクションメニューはグループを罫線で区切る**・非表示項目は高さ0（空き帯を作らない）・XPバーはホバーで獲得XPをツールチップ表示（既存決定に追加）。

## 7. 次にやること（優先順・具体的に）
1. **G を続けて §1.1 を回す**（依存の少ない順）。有力＝
   - **`GET /me/activities`（履歴・SC-01/プロフィール）**＝読取専用・`kind?`/`period?`＋カーソル（§1.8）。台帳が実データで入るので SC-01 の履歴/フィード系を接続できる。**軽く着手しやすい**。
   - または **ショップ SC-30（`GET /items`＋`POST /items/{id}/purchase`）**＝spend 系の初回。`ledger.grant(COIN_SPEND, reason=shop_purchase)` を UoW で使い、残高検証（不足→409）・`Idempotency-Key`（§1.9）・`user_items` 作成。**残高がコインでも動き出す**。
   - または **H 通知（SC-02）**＝一覧/既読 API は作れる（ref 解決は ideas/achievements 未実装で seed body 部分実装）。
   - 着手前に必ず対象ドメインの `doc/API設計/*` と既存4層テンプレ（`control_plane/me`・`tenant/gamification`）を読む。
2. **`sc-92c B-TC-116` の脆弱性修整**（別件・RowMenu の viewport 収まりを担保する待機/スクロール手当）。
3. SC-01 の残り（週間ランキングTOP3・下書き・未投票・参加中クエスト・フォロー中）＝I 集約 or 各ドメイン（G/C/D）接続時に demo→API 差替。
4. ヘッダー/メニューの `href="#"` 実リンク化（「設定」画面の採番は `画面遷移図.md` で要確認）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**（特に background）。
- **フルスタック起動（e2e/アプリ・ワーカ込み）**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。
  - ポート＝frontend **:3000**／backend **:8000**（`/healthz`）／db :5432／redis :6379／mailhog UI :8025。**e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`。**frontend コード反映**＝`build frontend`→`up -d frontend`。
- **backend テスト**（cwd=`impl`）＝先に `docker compose stop worker mail-worker`（mail_outbox 競合回避）→ `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`（マウントで即反映・entrypoint が migration も適用）。**e2e に戻すとき `--profile workers up -d worker mail-worker`**。
- **frontend e2e 手順**（Docker）: (1) `exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）(2) `exec -T frontend npx playwright install chromium` (3) `exec -T redis redis-cli FLUSHALL` (4) `exec -T frontend npx playwright test e2e/<spec> --reporter=line`（疑わしい失敗は `--workers=1`）。spec 差替＝`cp impl/frontend/e2e/x.spec.ts frontend:/app/e2e/x.spec.ts`（再ビルド不要・ただし frontend 再ビルドで消える＝再 cp）。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。MailHog＝`http://localhost:8025`。※**ログインで +10 XP/JST日** が入るようになった（G 接続）。
- 規約＝`CLAUDE.md` から辿る。デザインの正＝`doc/画面設計/mocks/*.html`＋`screens/*.md`＋`デザイン標準.md`。API 設計の正＝`doc/API設計/{A..L}_*.md`。データモデル＝`doc/データモデル.md`（残高/台帳＝§5.27・§7）。
- 一時ファイル運用＝使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に必ず削除。
