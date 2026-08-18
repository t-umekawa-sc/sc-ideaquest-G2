# handoff.md — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**このファイルだけで再開できる**ように書く。
> ルール＝毎回全文上書き（履歴は git）／確認した事実のみ・未確認は「未確認」と明記／コードの塊は貼らずファイルパス+関数名で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-18 22:05 JST**
- ブランチ: **main**（作業も main に直接コミット＆プッシュしている）
- 最新コミット: **`b05f10a` feat(SC-02): 通知一覧を移植（features/notifications 新設…）**
- 作業ツリー: **clean**（`git status` 変更なし）。全コミットは push 済み。

## 2. ゴール（プロジェクト概要）
- **ideaquest** = 社内アイデア創出のゲーミフィケーション型マルチテナント SaaS（XP/コイン/レベル/魔法/ランキング）。
- 構成＝Next.js(App Router) フロント ＋ FastAPI(4層) バック ＋ PostgreSQL/Redis/MinIO/MailHog/Docker。設計は完了済み。
- 現フェーズ＝フロント **「画面モック先行 → 画面群ごとに backend 接続」**（`doc/規約/フロントエンド実装フロー規約.md`）。DoD＝モック一致。

## 3. 今回やったこと（変更ファイルと理由）
本セッションの主眼＝**未移植画面の impl 移植（規約推奨順）を完走**し、**共通 UX 部品を新設**、**ゲーム層の導線を統一**した。

### 3-1. 画面移植（features/* 新設＋ `app/(app)/**/page.tsx` のスタブを実体へ差し替え）
理由＝いずれもモック（`doc/画面設計/mocks/SC-*.html`）を impl（React＋`design-system.css`）へ移植。backend 未接続のためデモ fixtures（画面モック先行）。
- SC-12 クエスト詳細のタブ縦スクロール修正（`features/quests/quests.css` の `.tabs` に `overflow-y:hidden`）。
- **SC-22 アイデア詳細**＝`features/ideas/components/IdeaDetailView.tsx`＋`ideas.css`。編集は共通 Modal に `IdeaForm`（後述）。更新履歴モーダル・投票・評価結果・チャット導線。
- **SC-24 アイデアチャット**＝`features/chat/components/IdeaChatView.tsx`＋`chat.css`。コンポーザー/メンション補完/絵文字/リアクション（通常＋魔法 spell-fx）/引用/編集/削除/ライトボックス。**引用文＝引用元へのアンカーリンク**（`#<msgid>`・クリックでスクロール＋`msg--flash`ハイライト）を追加（`doc/画面設計/screens/SC-24_*.md` にも反映）。
- **SC-25 評価画面**＝`features/evaluations/components/EvaluationView.tsx`＋`evaluations.css`。5観点★採点・総評必須・集計・公開範囲。フルページ（モーダル化は将来）。
- **SC-21 アイデア登録/編集**＝`features/ideas/components/{IdeaForm,IdeaCreateModal,IdeaCreatePanel}.tsx`。URL付きモーダル（`app/(app)/@modal/(.)quests/[questId]/ideas/new/page.tsx` ＋ フルページ `app/(app)/quests/[questId]/ideas/new/page.tsx`）。`IdeaForm` は create/edit 共通（SC-22 編集もこれ）。SC-12 の「＋アイデアを追加」から起動。
- **SC-30 ショップ**＝`features/shop/components/ShopView.tsx`＋`shop.css`。装備 DataTable(cardRaw)・購入フロー（`useConfirm`→`useSnackbar`）。
- **SC-31 アバター/着せ替え**＝`features/avatar/components/AvatarView.tsx`＋`avatar.css`。3Dビューア（マスコット代用）＋ワードローブ（クリック着替え）。未所有→`useConfirm`→`/shop`。
- **SC-32 魔法/スキル**＝`features/spells/components/SpellsView.tsx`＋`spells.css`。SP＋魔法カタログ段階解放（`useConfirm`→`useSnackbar`）。
- **SC-40 実績/バッジ**＝`features/achievements/components/AchievementsView.tsx`＋`achievements.css`。収集サマリー＋バッジ DataTable(cardRaw)・ティア色・進捗・シークレット。
- **SC-41 ランキング**＝`features/ranking/components/RankingView.tsx`＋`ranking.css`。期間切替・表彰台TOP3・全件・自分の順位。
- **SC-02 通知一覧**＝`features/notifications/components/NotificationsView.tsx`＋`notifications.css`。絞り込み・日付グループ・既読トグル・参照先遷移。

### 3-2. 共通 UX 部品（`impl/frontend/src/components/ui/` 新設＋`shared.css`/`shared.js` へ昇格）
理由＝ユーザー要望で「処理中/完了通知/確認ダイアログ」をゲーム要素付きで整備。style-guide でサンプル→shared 昇格→impl 移植の順。
- **Snackbar**（`components/ui/Snackbar.tsx`＝`SnackbarProvider`＋`useSnackbar()`）。`(app)/layout.tsx` に Provider 設置。意味色＋報酬（CRTガラス＋XP/コインチップ）。デザイン標準§14。原則＝**実行された処理の結果のみ通知（キャンセルでは出さない）**。
- **ConfirmDialog**（`components/ui/ConfirmDialog.tsx`＝`ConfirmProvider`＋`useConfirm()`→`Promise<boolean>`）。`(app)/layout.tsx` に Provider 設置。`window.confirm` の置換。variant=danger/game（コスト/残高プレビュー）。SC-30 購入・SC-31/32 で使用。デザイン標準§15。
- **Progress/Spinner/BlockOverlay**（`components/ui/Progress.tsx`）。まだ実利用への接続はしていない（部品のみ公開）。デザイン標準§13。
- **GameNav**（`components/ui/GameNav.tsx`）＝ショップ/きせかえ/魔法の相互ナビピル。
- shared 側は `doc/画面設計/mocks/shared.css`（`.snackbar*`/`.progress*`/`.iq-*`/`.iq-confirm*`/`.gamenav`）＋`shared.js`（`window.iqSnack`/`window.iqConfirm`）に昇格。`style-guide.html` に「13.処理中/14.スナックバー/15.確認ダイアログ」実演。

### 3-3. ゲーム層の導線統一（`feat(nav)` `49cb3c9` ＋ SC-01 一連）
理由＝入口がバラバラ（SC-32 はヘッダーSPのみ・ショップへは行けるが魔法へは行けない等）だった。
- A: ヘッダーの通貨＝使う画面の入口（`components/layout/AppHeader.tsx` の `◆コイン`→`/shop`・`✦SP`→`/spells`。モック全ヘッダーも同様）。
- B: ダッシュボードのタイルに「魔法/スキル」を追加（`DashboardView.tsx` の `TILES`）。
- C: SC-30/31/32 見出し直下に `GameNav`。
- SC-01 ヒーロー刷新（`features/dashboard/components/DashboardView.tsx`＋`dashboard.css`）＝SP 追加・ボタン3つの `▶`除去・**上段アバター＋下段フル幅1行（grid-areas）**・広幅センタリング・狭幅(≤700px)縦積み。
- `doc/画面設計/デザイン標準.md`・`画面遷移図.md` に決定を追記。

## 4. 現在の状態（動く/壊れている/テスト）
- **画面移植＝対象すべて完了**。`app/(app)` 配下に **ScreenStub 使用箇所は 0**（`grep -rl ScreenStub` で確認済み）。`features/` は 17 ディレクトリ（accounts/achievements/auth/avatar/chat/companies/dashboard/evaluations/ideas/notifications/profile/qgadmin/questgroups/quests/ranking/shop/spells）。
- **backend 接続済み画面**（実 API・e2e あり）＝認証 SC-00（auth）・プロフィール SC-03/K（profile・`/me`）・管理 SC-90/91/92/93（companies/accounts/questgroups/qgadmin）。
- **デモ fixtures（backend 未接続）画面**＝SC-01/02/10/11/12/21/22/24/25/30/31/32/40/41（dashboard/notifications/quests/ideas/chat/evaluations/shop/avatar/spells/achievements/ranking）。送信・購入・解放・評価等は**クライアント状態のみ**（接続時に API へ差し替え）。
- **フロントビルド**＝`docker compose build frontend`（＝内部で `next build`・型チェック含む）が本セッション最後まで**通過**。
- **テスト通過状況（本セッションで実測）**:
  - 移植した各画面は**使い捨て e2e（Playwright）＋スクリーンショット**で主要挙動を検証し当時 green（例＝SC-02 の未読件数/絞り込み、SC-41 の期間切替、SC-30 の購入→スナックバー 等）。**ただしこれらの spec はコミットしていない**（＝移植画面の回帰用 e2e は存在しない）。
  - 回帰確認として **`e2e/sc-91-companies.spec.ts`（9件）＋`e2e/k-profile.spec.ts`（3件）を green** で確認（AppHeader/レイアウト変更の影響なし）。
  - **コミット済み e2e は 12 spec**（`impl/frontend/e2e/*.spec.ts`＝sc-00-*/sc-11/sc-90/91/92/92b/92b2/92c/93/k-profile）。**上記2つ以外は本セッションでは未実行**（コード非変更のため通る想定＝未確認）。
- **backend pytest**＝本セッションでは**未実行**。前セッション実測 185 passed・本セッションで backend コード変更なし（＝現在も 185 想定だが未確認）。
- 壊れているものは認識していない（未確認の範囲は上記のとおり）。

## 5. 詰まっている点（試して失敗した/注意）
- **移植画面の回帰 e2e が無い**＝最大のリスク。今回は使い捨て spec で確認して削除したため、以後の変更で移植画面がサイレント破壊され得る（§7-1 で対応）。
- **frontend はソース焼き込み（bind mount 無し）**＝コード変更は必ず `docker compose build frontend` → `up -d` が必要。編集しただけでは反映されない（ハマりやすい）。
- **再ビルドで Playwright の chromium/依存が消える**＝e2e 前に毎回 `install-deps chromium`(root)＋`install chromium` が必要（§8）。
- **e2e ログインが `ようこそ` で失敗する**＝ログイン試行のレート制限。`docker compose exec -T redis redis-cli FLUSHALL`（または `login_fail:*` キー削除）で解消。
- **モーダルの閉じアニメはスクショで撮れない**（スクショ1枚の遅延 > アニメ長）。検証は `page.evaluate` の requestAnimationFrame で transform/boxShadow を実測サンプリングした（`Modal.tsx` の CRT電源OFF exit を確認した方法）。
- **hydration mismatch**＝Snackbar の portal を初回描画で出すと SSR と不一致。`SnackbarProvider` は `mounted` state 後にのみ portal 描画して回避済み（ConfirmDialog も同方針）。
- **`getByRole("heading",{name})` は部分一致**＝別見出しに当たり strict 違反になる（例 SC-41 `ランキング` が `★ 社内ランキング ★` と衝突→`exact:true` 必須）。

## 6. 決定事項と根拠（不採用案も）
- **通貨アイコン＝使う画面の入口**（◆→ショップ / ✦→魔法）。ゲーム3画面はどこからでも相互往来（GameNav）。根拠＝導線の一貫性。
- **スナックバー＝実行された処理の結果のみ**。確認キャンセル/no-op では出さない。根拠＝「処理が走った」と誤認させないため。
- **確認ダイアログは自前**（`window.confirm` 不採用）＝デザイン準拠・Promise・ゲーム variant のため。
- **モーダル閉じ＝CRT電源OFF**（縦→細線→中央点＋発光）。根拠＝従来のフェード+縦畳みは閉じたと分かりにくかった。
- **横ぶれ防止＝`html { scrollbar-gutter: stable }`**（impl は既存・モックへ追加）。モーダル開閉で背景幅が変わらない。
- **SC-01 ヒーローのボタン行**＝当初 nowrap→横スクロール（狭幅で文字縦潰れ）を**不採用**、grid-areas の2段構成（下段フル幅）＋狭幅縦積みに変更。理由＝横スクロール/潰れの解消。
- **IdeaForm は create/edit 共通化**（DRY）。SC-22 編集専用 `IdeaEditForm` は廃止し `IdeaForm(mode)` に統合。
- **SC-25 はフルページ移植**（設計はモーダル/Intercept 想定だが今回はフルページ。URLモーダル化は別パス）。

## 7. 次にやること（優先順・具体的に）
1. **移植画面の回帰 e2e をコミットする**（最優先・サイレント破壊防止）。`impl/frontend/e2e/` に各 features の主要操作を最小で。少なくとも: `sc-02-notifications`（未読件数/絞り込み/すべて既読）・`sc-30-shop`（購入→残高減＋報酬スナックバー）・`sc-41-ranking`（期間切替でスコア再計算）・`sc-24-chat`（送信/引用リンク）。ログインは OPS `admin@ops.example`/`Passw0rd!`、`ようこそ` を待つ。§5末尾の `exact:true` 注意を守る。
2. **backend 接続フェーズの着手**（画面群ごと）。まず残高/通知など軽いものから。候補＝SC-01 ダッシュボード（`features/dashboard/components/DashboardView.tsx` の `balance`/参加中クエスト等 fixtures→`/me`・クエストAPI）、SC-02 通知（`features/notifications` fixtures→通知API H）。**⚠ backend 側の各 API 実装状況は未確認**＝着手前に `impl/backend/app` と `doc/API設計/` を確認すること。
3. **ヘッダー/メニューの `href="#"` 実リンク化**。impl `AppHeader.tsx` は profile/avatar/admin 済みだが、モック側メニューの「プロフィール/設定」は `#` のまま。「設定」画面の有無・採番は未確認（`doc/画面設計/画面遷移図.md` で確認）。
4. **モック一致の最終目視**（レスポンシブ差分の洗い出し）。特にゲーム層 CRTガラス系の狭幅。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose は `impl/compose.yaml`（多くのコマンドは `cd impl` してから／または `-f impl/compose.yaml`）。
- **フルスタック起動（e2e/アプリ利用・ワーカ込み）**＝`cd impl && docker compose --profile workers up -d --build`。
  - ポート＝frontend **:3000**／backend **:8000**（`/healthz`）／db :5432／redis :6379／mailhog SMTP :1025・**UI :8025**。
  - **e2e は `--profile workers` が必要**（sc-00-mfa の OTP 配信・sc-90 のディレクトリミラー）。
- **frontend 反映**＝コード変更後は必ず `docker compose -f impl/compose.yaml build frontend` → `docker compose -f impl/compose.yaml up -d frontend`（bind mount 無し）。
- **frontend e2e 手順**（Docker）:
  1. `docker compose -f impl/compose.yaml exec -T -u root frontend npx playwright install-deps chromium`（再ビルドの度に必要）
  2. `docker compose -f impl/compose.yaml exec -T frontend npx playwright install chromium`
  3. `docker compose -f impl/compose.yaml exec -T redis redis-cli FLUSHALL`（ログインのレート制限クリア）
  4. `docker compose -f impl/compose.yaml exec -T frontend npx playwright test e2e/<spec> --reporter=line`
  - spec だけの変更は `docker compose -f impl/compose.yaml cp impl/frontend/e2e/x.spec.ts frontend:/app/e2e/x.spec.ts` で差替可（再ビルド不要）。
- **backend テスト**（Docker・cwd=`impl`）＝**先に `docker compose stop worker mail-worker`**（mail_outbox 競合フレーク回避）→ `docker compose run --rm --no-deps -T -v "$PWD/backend:/app" backend pytest tests/ -q`。backend はマウントで即反映（再ビルド不要）。**e2e に戻すときはワーカを再起動**。
- **dev ログイン（seed・PW 全て `Passw0rd!`）**＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`(MFA OFF)・`ACME-02`/`mfa@acme2.example`(MFA ON)。MailHog（送信メール）＝`http://localhost:8025`（要ワーカ）。
- 規約＝`CLAUDE.md` から辿る（コーディング/テスト/リポジトリ構成/ドキュメント作成/フロントエンド実装フロー）。デザインの正＝`doc/画面設計/mocks/*.html`＋`screens/*.md`＋`デザイン標準.md`。
- 一時ファイル運用＝検証用の使い捨て spec/png は `/tmp` とコンテナ `/app/e2e` に作り、コミット前に必ず削除する（本セッションはそうした）。
