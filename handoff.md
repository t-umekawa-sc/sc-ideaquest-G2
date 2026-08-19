# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-19 JST**
- ブランチ: **main**（作業も main に直接コミットしている）
- 最新コミット: **`8b89e21` feat(SC-01): ヒーロー残高を GET /me（K.1）へ接続＝fixtures から実 API 差替**
- 作業ツリー: **clean**／**origin/main と同期済み（未push なし）**。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝**画面移植は完了**。今は **backend 接続フェーズ**を **1画面単位ループ**で回している（フロー規約 §1.1・2026-08-19 導入）。

## 3. 今回やったこと（変更ファイルと理由）
本セッション＝**前セッションが WSL フリーズで中断→再開**。3本立て。

### 3-1. 移植画面の回帰 e2e を完走（前 handoff §7-1）
- `impl/frontend/e2e/sc-30-shop.spec.ts`（`5b0d2f4`）・`sc-41-ranking.spec.ts`＋`sc-24-chat.spec.ts`（`7c983df`）。SC-02 は前セッション `97bdc7f`。いずれもデモ fixtures 画面の主要操作を担保。

### 3-2. フロー規約に「画面単位ループ＋受入ゲート」を成文化（`a943bd7`）
- `doc/規約/フロントエンド実装フロー規約.md` に **§1.1** を新設（2026-08-19 ユーザー選択）。接続を画面群→**1画面単位**に詳細化。1画面の流れ＝**必要EP特定→テスト先行4層実装（必要範囲のみ）→fixtures を実APIへ差替→ユーザー動作確認（受入ゲート）→1画面クローズ**。DoD §7 にも「接続完了＝ユーザー受入」を追記。**運用メモリにも保存済み**（各画面の実装後は必ず止めてユーザー動作確認を待つ）。

### 3-3. SC-01 残高スライスを backend 接続（§1.1 を1周・`ecc88e3`＋`8b89e21`）
- **backend（`ecc88e3`）**＝`GET /me` を K.1 正準のネスト形 `{account, profile, balance, system_role}` へ拡張し **balance（level/xp/xp_to_next/level_span/coin_balance/skill_point_balance）を会社DB `users` から返す**。
  - 新設 `impl/backend/app/tenant/gamification/level.py`＝**純粋レベル関数**（データモデル §7・`Lv n→n+1=100+(n-1)×50`・DB非依存）。`level_progress(xp)→{level,xp_to_next,level_span}`。
  - 変更＝`me/schemas.py`（`MeResponse`＋`Me{Account,Profile,Balance}DTO` 新設・`MeProfileResponse` 廃止）／`me/application.py`（`get_me(account_id, company_id)` に変更・`_tenant_user()` で会社DB users を読む・`update_me` も K.1 形返却）／`me/router.py`（`response_model=MeResponse`・company_id 引き回し）。
  - **画像署名URL（K.4/MinIO）は範囲外＝現状 None**。通知(H)も範囲外。
  - **red-green 実施（テスト規約 §5.1・コミット本文に証跡）**＝新テストを旧フラット実装で先に観測（`test_k_tc_004` AssertionError／`test_k_tc_004b` KeyError 'balance'／`test_k_tc_001` KeyError 'profile'＝3 failed）→ネスト実装で green。`tests/gamification/test_level.py` 新設＋`tests/me/test_me.py` の tc_004 書換＋tc_004b 追加。
- **frontend（`8b89e21`）**＝共通ヘッダー通貨・SC-01 ヒーロー・プロフィール残高を demoBalance から実 `/me` へ差替。
  - 新設 `impl/frontend/src/lib/me.ts`＝サーバ側 `getServerMe()`（Cookie 転送・React `cache` 重複排除）＋`heroBalance()/headerBalance()` マッパ（`getServerSession` と同型）。
  - 変更＝`app/(app)/layout.tsx`（ヘッダー balance＝/me・未読は H 未接続で 0）／`app/(app)/page.tsx`（ヒーロー balance＝/me）／`app/(app)/profile/page.tsx`（残高＝/me）／`features/profile/{types.ts,components/ProfileForm.tsx}`（ネスト形 `MeResponse` へ追随＝契約変更の退行防止）。
  - `src/lib/api/schema.d.ts` を**稼働 backend の live OpenAPI から再生成**（`MeResponse` 等反映）。
  - e2e `sc-01-dashboard.spec.ts` 新設＝ヒーロー/ヘッダー残高が `GET /me` の balance と一致（値ハードコードせず突合＝接続の証明）。
- **ユーザー受入＝OK 済み**（§1.1 step4）。dev の OPS ユーザーは残高が**初期値**（Lv.1/XP0/◆0/SP0＝XP/コイン付与の G が未実装のため実値0）である点も合意済み。

## 4. 現在の状態（動く/壊れている/テスト）
### 4-1. フロント
- 画面移植は全完了。`features/` は 17 ディレクトリ。
- **backend 接続済み**＝認証 SC-00・プロフィール SC-03/K・管理 SC-90/91/92/93・**SC-01 ヒーロー残高＋共通ヘッダー通貨（新規・GET /me 残高）**。
- **デモ fixtures（未接続）**＝SC-02/10/11/12/21/22/24/25/30/31/32/40/41、および SC-01 の週間ランキング/下書き/未投票/参加中クエスト/フォロー中（G/C/D 接続まで demo）。

### 4-2. backend（接続フェーズの起点判断・実地確認済み）
- 登録ルータは依然 **auth/admin/me の3つ**。ただし **`GET /me` は K.1 正準（残高込み）** になった。
- 実装済みモジュール＝`control_plane/{auth,admin,me,account_sync,audit,mail_outbox}`・`tenant/{profile,quest_group,gamification(level 関数のみ)}`。
- **未実装ドメイン**＝G（活動台帳 activities＝残高を実際に増減させる canonical・未実装のため残高は seed/0 のまま）／H 通知（読取/既読 API は作れるが取得時レンダリングの ref 解決が ideas/achievements 未実装＝部分実装）／D アイデア・E チャット・F 評価・I ダッシュボード集約・L WS 配信。
- API 設計は全ドメイン確定＝`doc/API設計/{A..L}_*.md`。

### 4-3. テスト
- **frontend e2e＝17 spec**（既存15＋`sc-24-chat`＋`sc-30-shop`＝前掲、さらに `sc-41-ranking`・`sc-01-dashboard`。合計 k-profile/sc-00-*×3/sc-01-dashboard/sc-02/sc-11/sc-24/sc-30/sc-41/sc-90/91/92/92b/92b2/92c/93）。
- 本セッション実測 green＝sc-30(2)・sc-41(2)・sc-24(2)・sc-01-dashboard(1)・k-profile(3)。
- **backend pytest＝195 passed**（前 185＋gamification 8＋me 2＝本セッションで +10）。
- **フル e2e（43件・2 worker）で 7 flake**＝並列ログイン集中のレート制限（handoff §5）。**直列(`--workers=1`)再実行で該当14件 green＝回帰ではない**（SC-01 の layout 共有変更に問題なしを確認）。
- 壊れているものは認識していない。

## 5. 詰まっている点（試して失敗した/注意）
- **backend サービスは焼き込み（`build: ./backend`・mount 無し）**＝コード変更を稼働 backend に反映するには **`up -d --build backend worker mail-worker`** が必要（テストは `-v "$PWD/backend:/app"` マウントで即反映するが、稼働 API・openapi.json は別＝再ビルド必須）。ハマった。
- **OpenAPI 型生成**＝`schema.d.ts` は `npm run codegen`（openapi-typescript）で **live backend の openapi から**生成。frontend コンテナ内で `OPENAPI_URL=http://backend:8000/openapi.json npm run codegen` → `docker compose cp frontend:/app/src/lib/api/schema.d.ts <host>` で host へ取り出す（コンテナは焼き込みなので host に戻さないと再ビルドに乗らない）。host にも node v22 あり。
- **フル e2e は並列ログインでレート制限フレーク**＝疑わしい失敗は `--workers=1` で再実行して切り分ける（＋`redis-cli FLUSHALL`）。単体/直列で green なら回帰ではない。
- **background の Bash は cwd を引き継がない**＝`docker compose -f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml ...` の絶対パスで叩く。
- **frontend はソース焼き込み（bind mount 無し）**＝コード変更は `build frontend`→`up -d frontend`。再ビルドで Playwright chromium/依存が消える＝e2e 前に毎回 `install-deps chromium`(root)＋`install chromium`（§8）。
- **red-green の red 観測**＝実装済み変更に対しては `git stash push -- <app パス>` で当該 app 変更のみ退避し、新テストを旧実装に対して走らせて behavior-red（観測 actual）を撮る→`stash pop`→green。**パスは repo ルート基準**（`impl/backend/app/...`。cwd=impl で `app/...` と書くと no-op になる罠あり）。
- **セッション→会社DB user の対応**＝`accounts.id`(管理DB) ≠ `users.id`(会社DB)。会社DB users は `users.account_id == account_id` で引く（`profile/repository.get_user_by_account`）。テナントDBは `get_tenant_session(Company.db_identifier)`。
- `getByRole("heading",{name})` は部分一致＝別見出し衝突に `exact:true`。

## 6. 決定事項と根拠（不採用案も）
- **backend 接続は1画面単位ループ＋受入ゲート**（§1.1・2026-08-19）。根拠＝1画面ずつ実データで動作確認し齟齬を早期に潰す・完了を画面で数える。
- **`GET /me` は K.1 正準のネスト形**（`{account,profile,balance,system_role}`）。フラット部分スライスから完成形へ。既存プロフィール画面は同形へ追随（規約 §6・退行させない）。
- **レベル/進捗は §7 純粋関数で xp から算出**（`users.level` キャッシュに依存しない・G 未実装でも自己完結）。
- **通貨アイコン＝使う画面の入口**（◆→ショップ/✦→魔法）・**スナックバー＝実行された処理の結果のみ**・**確認ダイアログは自前**・**モーダル閉じ＝CRT電源OFF**（既存決定・据え置き）。

## 7. 次にやること（優先順・具体的に）
1. **次の画面で §1.1 を回す**（依存の少ない順）。有力＝
   - **G 活動台帳（activities）の最小実装**＝残高を実際に増減させる canonical。これがあると SC-01 の残高が実値で動き、SC-30 購入/SC-32 解放/SC-40 実績等の後続接続の土台になる（残高 write の起点）。**推奨**。
   - または **H 通知（SC-02）**＝一覧/既読 API は作れる。取得時レンダリング（ref 解決）は ideas/achievements 未実装のため **seed の body 文字列で部分実装**になる旨を明示して進める。
   - 着手前に必ず対象ドメインの `doc/API設計/*` と、既存4層テンプレ（`control_plane/me`・`control_plane/admin`）を読む。
2. **SC-01 の残り**（週間ランキングTOP3・下書き・未投票・参加中クエスト・フォロー中）は I 集約 or 各ドメイン（G/C/D）接続時に demo→API 差替。
3. **ヘッダー/メニューの `href="#"` 実リンク化**（「設定」画面の採番は `画面遷移図.md` で要確認）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`。**コマンドは絶対パス `-f /home/t-umekawa/sc-ideaquest-G2/impl/compose.yaml` 推奨**（特に background）。
- **フルスタック起動（e2e/アプリ・ワーカ込み）**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`。
  - ポート＝frontend **:3000**／backend **:8000**（`/healthz`）／db :5432／redis :6379／mailhog UI :8025。
  - **e2e は `--profile workers` 必須**。
- **backend コード反映**＝`up -d --build backend worker mail-worker`（焼き込み）。**openapi 変更時は frontend の schema.d.ts を codegen で再生成**（§5）。
- **frontend コード反映**＝`build frontend`→`up -d frontend`。
- **frontend e2e 手順**（Docker）:
  1. `... exec -T -u root frontend npx playwright install-deps chromium`（再ビルド毎）
  2. `... exec -T frontend npx playwright install chromium`
  3. `... exec -T redis redis-cli FLUSHALL`（レート制限クリア）
  4. `... exec -T frontend npx playwright test e2e/<spec> --reporter=line`（疑わしい失敗は `--workers=1`）
  - spec だけ差替＝`... cp impl/frontend/e2e/x.spec.ts frontend:/app/e2e/x.spec.ts`（再ビルド不要）。
- **backend テスト**（cwd=`impl`）＝**先に `docker compose stop worker mail-worker`**（mail_outbox 競合回避）→ `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`。マウントで即反映。**e2e に戻すときワーカ再起動**。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。MailHog＝`http://localhost:8025`。
- 規約＝`CLAUDE.md` から辿る。デザインの正＝`doc/画面設計/mocks/*.html`＋`screens/*.md`＋`デザイン標準.md`。API 設計の正＝`doc/API設計/{A..L}_*.md`。
- 一時ファイル運用＝検証用の使い捨て spec/png は `/tmp`・コンテナ `/app/e2e` に作り、コミット前に必ず削除。
