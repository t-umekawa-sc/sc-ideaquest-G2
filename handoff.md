# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-19 JST**
- ブランチ: **main**（作業も main に直接コミットしている）
- 最新コミット: **`7c983df` test(SC-41,SC-24): ランキング期間切替とチャット送信/引用リンクの回帰 e2e を追加**
- 作業ツリー: **clean**（`git status` 変更なし）。
- **push 状況＝origin/main より 3 コミット先行（未push）**: `97bdc7f`(SC-02 e2e)・`5b0d2f4`(SC-30 e2e)・`7c983df`(SC-41/24 e2e)。それ以前は push 済み。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝フロント **「画面モック先行 → 画面群ごとに backend 接続」**（`doc/規約/フロントエンド実装フロー規約.md`）。DoD＝モック一致。**画面移植は完了済み**＝今は **backend 接続フェーズの入口**（§7）。

## 3. 今回やったこと（変更ファイルと理由）
本セッション＝**前回セッションが WSL フリーズで中断→再開**。主眼は **未コミットだった移植画面の回帰 e2e を完走**し、**backend 接続フェーズの前提を実地調査**したこと。

### 3-1. 移植画面の回帰 e2e を追加（handoff §7-1 最優先＝サイレント破壊防止）
理由＝移植画面（デモ fixtures）の主要インタラクションを最小 e2e で固定。前回は使い捨て spec で確認して削除していたため回帰網が無かった。すべて OPS ログイン・green 実測。
- `impl/frontend/e2e/sc-30-shop.spec.ts`（`5b0d2f4`・2件）＝購入＝確認ダイアログ→残高減(320→300)＋報酬スナックバー・所有済み化／キャンセルは処理なし（残高不変・通知なし）。
- `impl/frontend/e2e/sc-41-ranking.spec.ts`（`7c983df`・2件）＝期間タブ切替でスコア（獲得XP＋獲得コイン）再計算。今週 自分2位/405・TOP1 530 → 通算 自分5位/8520・TOP1 15300。
- `impl/frontend/e2e/sc-24-chat.spec.ts`（`7c983df`・2件）＝送信でスレッド末尾に自分投稿追記（（あなた）表示）／引用返信で引用文が引用元アンカー(`href="#m2"`)＋クリックで `msg--flash`。
- （SC-02 通知 e2e `sc-02-notifications.spec.ts` は前セッションのコミット `97bdc7f` で追加済み・5件。）
- 注意＝ホバーアクション（`.msg__actions`）は CSS `display:none`→`.msg:hover` で表示。e2e では対象 `.msg` を `hover()` してからアクションボタンを押す。

### 3-2. backend 接続フェーズの前提調査（コード変更なし・§7 の判断根拠）
理由＝前 handoff の §7-2「軽い残高/通知から」の前提が正しいか未確認だった。**実地確認の結果＝前提は誤り**（下記 §4 参照）。**実装済み backend ルータは auth/admin/me の 3 つのみ**で、通知・ダッシュボード・ゲーミフィケーション等の feature API は**未実装**。

## 4. 現在の状態（動く/壊れている/テスト）
### 4-1. フロント（画面）
- **画面移植＝対象すべて完了**（`app/(app)` 配下に ScreenStub 使用箇所 0）。`features/` は 17 ディレクトリ（accounts/achievements/auth/avatar/chat/companies/dashboard/evaluations/ideas/notifications/profile/qgadmin/questgroups/quests/ranking/shop/spells）。
- **backend 接続済み画面**（実 API・e2e あり）＝認証 SC-00・プロフィール SC-03/K（`/me`）・管理 SC-90/91/92/93。
- **デモ fixtures（backend 未接続）画面**＝SC-01/02/10/11/12/21/22/24/25/30/31/32/40/41。送信・購入・解放・評価等は**クライアント状態のみ**。

### 4-2. backend（★接続フェーズの起点判断に直結・実地確認済み）
- **`impl/backend/app/main.py` に登録されているルータは 3 つだけ**＝`auth_router`・`admin_router`・`me_router`。
- 実装済みモジュール＝`control_plane/{auth,admin,me,account_sync,audit,mail_outbox}`・`tenant/{profile,quest_group}`（profile/quest_group は orm+repository のみで**独立ルータ無し**＝me/admin から利用）。
- **`GET /api/v1/me` は identity サブセットのみ返す**（`MeProfileResponse`＝`login_id/email/display_name/locale/system_role`）。**残高・XP・レベル・コイン・画像署名URL は返さない**＝K.1 全体は「別スライス＝未実装」（`me/schemas.py`・`me/application.py:50` のコメント）。
- ゆえに **通知(H)・ダッシュボード(I)・ゲーミフィケーション(G)・アイデア(D)・チャット(E)・評価(F) の backend は未実装**。→ **「軽い残高/通知だけ配線」は不可能。どの画面接続も先に backend ドメイン実装が要る**。
- API 設計は全ドメイン確定済み＝`doc/API設計/{A..L}_*.md`。例＝H 通知は EP 確定（`GET /notifications`・`/notifications/unread-count`・`POST /notifications/{id}/read`・`/unread`・`/read-all`＝SC-02 に対応）。

### 4-3. テスト
- **コミット済み frontend e2e＝16 spec**（`impl/frontend/e2e/*.spec.ts`）: k-profile / sc-00-login / sc-00-mfa / sc-00-password-setup / **sc-02-notifications** / sc-11-quest-create-modal / **sc-24-chat** / **sc-30-shop** / **sc-41-ranking** / sc-90-quest-group-admin / sc-91-companies / sc-92-company-detail / sc-92b-accounts / sc-92b2-account-edit / sc-92c-quest-groups / sc-93-own-accounts。
- 本セッションで実測 green＝sc-30(2)・sc-41(2)・sc-24(2)。他 spec は**本セッション未実行**（コード非変更のため通る想定＝未確認）。
- **backend pytest**＝本セッション未実行。前々セッション実測 185 passed・以後 backend コード変更なし（＝現在も 185 想定だが未確認）。
- フロントビルド＝本セッションは e2e 実行前に `docker compose --profile workers up -d --build` が通過（＝`next build`・型チェック含めて成功）。
- 壊れているものは認識していない（未確認の範囲は上記のとおり）。

## 5. 詰まっている点（試して失敗した/注意）
- **backend 接続は「実装フェーズ」＝配線だけでは終わらない**（§4-2）。着手ドメインは ORM/リポジトリ/アプリ/ルータ＋テスト（テスト規約 red-green §5.1）＋seed が要る。設計は `doc/API設計/` に確定済み。
- **background の Bash は cwd を引き継がない**＝`docker compose` は `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` の**絶対パス**で叩く（`cd impl` はバックグラウンドで失敗した）。
- **frontend はソース焼き込み（bind mount 無し）**＝コード変更は必ず `build frontend`→`up -d frontend`。編集だけでは反映されない。
- **再ビルドで Playwright chromium/依存が消える**＝e2e 前に毎回 `install-deps chromium`(root)＋`install chromium`（§8）。
- **e2e ログインが `ようこそ` で失敗＝レート制限**＝`redis-cli FLUSHALL` で解消（§8）。
- **`getByRole("heading",{name})` は部分一致**＝別見出しと衝突し strict 違反（例 SC-41 `ランキング` と `★ 社内ランキング ★`）→`exact:true` 必須。
- **spec だけの変更は再ビルド不要**＝`docker compose cp` でコンテナ `/app/e2e/` へ差替できる（§8）。
- hydration mismatch 回避＝Snackbar/ConfirmDialog の portal は `mounted` state 後にのみ描画（既存対応済み）。

## 6. 決定事項と根拠（不採用案も）
- **通貨アイコン＝使う画面の入口**（◆→ショップ / ✦→魔法）。ゲーム3画面は GameNav で相互往来。
- **スナックバー＝実行された処理の結果のみ**（確認キャンセル/no-op では出さない）。
- **確認ダイアログは自前**（`window.confirm` 不採用）＝デザイン準拠・Promise・ゲーム variant。
- **モーダル閉じ＝CRT電源OFF**（縦→細線→中央点＋発光）。
- **IdeaForm は create/edit 共通化**（DRY）。SC-25 は今回フルページ移植（URLモーダル化は別パス）。
- **SC-01 ヒーローのボタン行**＝grid-areas 2段（下段フル幅）＋狭幅縦積み（横スクロール/縦潰れを不採用）。

## 7. 次にやること（優先順・具体的に）
**§7-1 の回帰 e2e は本セッションで完了**（SC-02/30/41/24）。次は **backend 接続フェーズ**。ただし §4-2 のとおり「実装」から。

1. **最初の backend ドメイン＝H 通知（SC-02）を推奨**（自己完結・EP 確定・対応フロントと回帰 e2e が既にある）。手順＝`doc/API設計/H_通知.md` に沿って 4層実装（`tenant/notification/` に orm/repository/application/router 新設＝コーディング規約 §3.4）→`main.py` にルータ登録→Alembic 等でテーブル＋seed→**テスト規約 §5.1 の red-green**（api/int テスト先行）→フロント `features/notifications` の fixtures を実 API へ差替→既存 `sc-02-notifications.spec.ts` を実 API で green。**⚠ 着手前に既存の実装パターン（`control_plane/me` と `control_plane/admin`）をテンプレとして必読**（4層の分け方・DTO・deps・セッション認可の作法）。
   - 代替候補＝K.1 の `/me` 全体スライス（残高/レベル/画像署名URL）→ヘッダー通貨＋SC-01 ダッシュボード。ただし残高/XP のデータモデル（会社DB `users` ミラー）実装状況が未確認＝H より重い可能性。
2. **push**＝未push 3 コミット（§1）を適時 `git push`。
3. **ヘッダー/メニューの `href="#"` 実リンク化**（`AppHeader.tsx` の「プロフィール/設定」等。「設定」画面の採番は `doc/画面設計/画面遷移図.md` で要確認）。
4. **モック一致の最終目視**（レスポンシブ差分・ゲーム層 CRTガラスの狭幅）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは `docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml ...` の絶対パス推奨**（特に background 実行時）。
- **フルスタック起動（e2e/アプリ利用・ワーカ込み）**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。
  - ポート＝frontend **:3000**／backend **:8000**（`/healthz`）／db :5432／redis :6379／mailhog SMTP :1025・**UI :8025**。
  - **e2e は `--profile workers` が必要**（sc-00-mfa の OTP・sc-90 のディレクトリミラー）。
- **frontend 反映**＝コード変更後は `build frontend`→`up -d frontend`（bind mount 無し）。
- **frontend e2e 手順**（Docker）:
  1. `... exec -T -u root frontend npx playwright install-deps chromium`（再ビルドの度に必要）
  2. `... exec -T frontend npx playwright install chromium`
  3. `... exec -T redis redis-cli FLUSHALL`（ログインのレート制限クリア）
  4. `... exec -T frontend npx playwright test e2e/<spec> --reporter=line`
  - spec だけの変更は `... cp impl/frontend/e2e/x.spec.ts frontend:/app/e2e/x.spec.ts` で差替可（再ビルド不要）。
- **backend テスト**（Docker・cwd=`impl`）＝**先に `docker compose stop worker mail-worker`**（mail_outbox 競合フレーク回避）→ `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`。backend はマウントで即反映（再ビルド不要）。**e2e に戻すときはワーカを再起動**。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。MailHog＝`http://localhost:8025`（要ワーカ）。
- 規約＝`CLAUDE.md` から辿る。デザインの正＝`doc/画面設計/mocks/*.html`＋`screens/*.md`＋`デザイン標準.md`。API 設計の正＝`doc/API設計/{A..L}_*.md`。
- 一時ファイル運用＝検証用の使い捨て spec/png は `/tmp` とコンテナ `/app/e2e` に作り、コミット前に必ず削除する。
