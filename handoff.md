# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-17 JST**（FR-40 SC-13 活発度スパークライン→受入不具合修正→モーダル閉じ CRT 演出→フォロー表現とカード UI の統一、まで行ったセッション）。
- ブランチ: **main**（受入/レビュー反映＝main 直コミット可）。`feature/game-feel` は今回未使用。
- 最新の実装コミット: **bfca58f** `refactor(ui): フォロー表現の整理＋発見カタログ/ダッシュボード カードの見た目統一`（この後の handoff コミットが実 HEAD）。
- **本セッションのコミット（古い順・すべて push 予定）**＝`1615f54`(スパークライン＋ダイアログ2不具合＋CRT閉じ演出)→`cba6464`(ダイアログのフォロー★共有化＋フッター順)→`bfca58f`(フォロー表現整理＋カード統一)＋本 handoff コミット。
- **push 状態＝本セッション末に `git push` 実施（完了なら「push 済み」）**。手前の `071ab26`（前回 handoff）は push 済み。

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションするマルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`・会社ごと物理分離DB）。全画面 backend 接続済みで、現在は **FR-40（クエスト発見/フォロー/参加リクエスト）の縦スライス実装フェーズ**。

## 3. 今回やったこと（変更ファイルと理由）

### A. FR-40 SC-13 活発度スパークライン（進め方 A＝共有部品＋グラフ・`1615f54`）
- **backend（メタ限定・本文非返却）**＝`app/tenant/chat/repository.py daily_message_counts_for_quest`（クエスト横断＝公開アイデアのチャット合算・日次件数）／`app/tenant/quests/application.py` に `_quest_activity`＋`get_catalog_detail` へ `activity{daily,total,days=14}` を付与／`schemas.py`＝`QuestActivityDailyDTO`/`QuestActivityDTO`/`QuestCatalogDetailDTO`／`router.py` catalog-detail の response_model を detail DTO 化。テスト＝`tests/quests/test_catalog.py` **C-TC-265**（横断集計・本文が応答に漏れない）。
- **frontend**＝共有 `src/components/ui/ActivitySpark.tsx` 新設（`daily`／任意 `markers`◆／`emptyText`）。CSS を `features/ideas/ideas.css`→`styles/components.css` へ移設（globals 経由で全ルート有効）。`IdeaDetailView.tsx` の inline スパークを ActivitySpark に置換／`QuestCatalogView.tsx` の `CatalogDialog` に活発度を表示（`getCatalogDetail` を後追いフェッチして activity を結合）。api＝`features/quests/api.ts`（`QuestCatalogDetail`/`getCatalogDetail`）。

### B. 受入不具合 2 件の修正（`1615f54`・SC-13 掲示板ダイアログ）
- **DFT-E-013 最大化欠落**＝`CatalogDialog` が `Modal` に `maximizable={false}` を明示上書き（標準は既定 on・§106）→ 撤去。
- **DFT-E-014 閉じアニメ欠落**＝`{detail && <Dialog>}` の即アンマウントで exit アニメが飛ぶ → `open` 駆動＋`onClosed` でアンマウント遅延（`RouteModal` と同パターン）。`QuestCatalogView` に `dialogOpen` state 追加。
- **回帰 e2e**＝`e2e/sc-13-catalog.spec.ts` **C-TC-266/267**（red は修正 revert で観測・`doc/テスト/red確認台帳.md` に記録）。
- **e2e の土台**＝`impl/backend/scripts/bootstrap.py seed_demo_discovery`＝**発見デモ discoverable クエスト（全社公開・固定 UUID `d15c…0002`・冪等）＋公開アイデア2件＋直近チャット**を ACME-01 に自動 seed（非prod のみ）。DB リセットでも安定再現。

### C. モーダル閉じアニメを CRT 電源OFF に（`1615f54`・全モーダル共通）
- `src/components/ui/Modal.tsx`＝`closing` state を追加し閉じる間だけ `.is-closing`（開く前フレームには付けない＝誤発火防止）／`ANIM_MS` を 340 に／reduce では尺ゼロ（即閉じ）。`styles/design-system.css`＝`@keyframes modal-crt-close`（縦一本線へ収束→横一点へ消灯＋輝度）＋`.modal.is-closing` ルール＋reduce override。開く側 CRT 電源ON と対称。**CSS のみ**（framer 不使用＝DFT-E-012 回帰対策踏襲）。
- **style-guide モック**＝`doc/画面設計/mocks/style-guide.html` §10 に受入用モック。reduce 抑制テスト＝`sc-13-catalog.spec.ts` **C-TC-268**。

### D. フォロー表現の整理＋カード UI の統一（`cba6464`＋`bfca58f`・ユーザー受入フィードバック反映）
- **`.follow-star` の衝突を解消**＝`ideas.css`（枠付き星＋テキスト）と `components.css`（アイコン）で二重定義していたため 2 形態に分離・共有化＝`styles/components.css` に **`.follow-toggle`**（枠付き 星＋テキスト＝SC-22 アイデア詳細／SC-13 ダイアログ）と **`.follow-star`**（アイコンのみ＝SC-01 ダッシュボード フォロー中カード／SC-13 探すカード）。`IdeaDetailView.tsx` は `follow-star`→`follow-toggle` に。`dashboard.css` は `.follow-star` を位置指定のみに（見た目は共有へ）。
- **SC-13 ダイアログ**＝フォローを**ヘッダー右上**へ（アイデア詳細と同位置・`follow-toggle`）。フッターは 閉じる（左）→ 主要アクション（右）。
- **SC-13 探すカード**（`QuestCatalogView.tsx cardRaw/cardActions`）＝フォロー★を**カード右上角に絶対配置**（ステータスより上）／ステータスはタイトル行と上下中央（`.between` の align-items:center）／`👥 パーティーN`・`💡 アイデアN` 表記に統一（ダッシュボード参加中カードと同形式）／参加をリクエストを右寄せ。
- **SC-01 ダッシュボード**（`DashboardView.tsx`）＝未投票/フォロー中カードで「💬 チャットで議論」を**作成者名の横**にインライン統一（共有 `.dash-chat-link`）。フォロー中カードを未投票カードと同構造に（カードは div・タイトルが詳細への Link）＝右下の💬アイコン（旧 `.follow-chat`）を撤去。

### E. デモ環境の状態リセット（コード外・DB 操作）
- seed アカウント `user@acme.example` の **`accounts.game_mode_override` を None に戻した**（会社デフォルト＝ON に復帰）。理由＝ゲーム層 e2e `G-TC-175` が override=False だと落ちるため（§5 参照）。※DB リセットで戻る一時状態。

## 4. 現在の状態（動作/テスト）
- **動いているもの**＝SC-13 発見カタログ（申請者側＝一覧/カード/詳細ダイアログ/フォロー/参加リクエスト＋活発度スパークライン）・全モーダルの CRT 電源OFF 閉じ演出・フォロー表現の 2 形態・カード UI の統一。実機スモークで確認済み。
- **テスト通過状況**＝**backend 全体 `628 passed`**（最後に全体実行したのは seed_demo_discovery 追加後。以降は frontend のみ変更＝backend 未変更のため 628 のはず・再確認は未実施）。frontend＝`sc-13-catalog` **3 passed**（C-TC-266/267/268）・`sc-22-vote-follow` **4 passed**（D-TC-209〜212）・`sc-01-dashboard`＋`G-TC-175` passed・`vitest` **188 passed**・`npm run build` 通過。トレーサビリティ＝`python3 scripts/check_tc_traceability.py` **✅ 618 件**。
- **コンテナ**＝本セッション末はフル起動中（frontend/backend は本変更で再ビルド済み・codegen 済み）。次セッションでは落ちている想定＝§8 で再起動。
- **壊れているもの**＝認識範囲では無し。**注意**＝`G-TC-175`（ゲーム層ヒーロー）は `game_mode_override=False` だと落ちる。今回 None にリセット済みだが **DB リセットで False に戻ると再発**（pytest のゲームモード系テストが seed DB に残す可能性・§5）。

## 5. 詰まっている点（試して失敗したアプローチ＝次回の近道用）
- **`.follow-star` の二重定義**＝共有アイコン `.follow-star` を components.css に足したら、アイデア詳細（ideas.css の枠付き `.follow-star`）と衝突しグローバルに競合。→ **クラスを 2 つに分離**（`.follow-toggle`＝枠付き／`.follow-star`＝アイコン）。同名グローバルクラスの二重定義は避ける。
- **CRT 閉じアニメの誤発火**＝`.modal:not(.show)` に閉じアニメを当てると、開く前フレーム（mounted かつ .show 前）にも一致して開いた瞬間に閉じアニメが走る。→ Modal に `closing` state を持たせ **open の false 遷移でのみ `.is-closing`** を付ける（`ANIM_MS` は閉じ尺 .34s 以上に）。
- **`G-TC-175` の pre-existing 失敗**＝私の変更と無関係。切り分け＝**修正を stash してコミット済み HEAD でも同じ失敗**を確認 → 根因は seed アカウントの `game_mode_override=False`（`gameEnabled = GET /me の game_mode.effective`・`app/(app)/layout.tsx` 他）。seed_demo_discovery は game_mode に触れない（無関係）。→ override を None にリセットで green。
- **seed 追加が既存テストを壊さないか**＝約40のテストが seed 会社を使うため手審査より**全体スイート実測が速い**。seed_demo_discovery 追加後の全体＝628 passed で破損なしを確認。
- **手動 seed と bootstrap seed の二重**＝会話中に手動 seed した発見デモ（ランダム id）と bootstrap の固定 id 版が二重化。→ 手動分を物理削除して固定 id に一本化（クエスト削除は `quest_categories`/`quest_outcomes` 等の FK も先に消す）。

## 6. 決定事項と根拠（採用しなかった案も）
1. **活発度スパークライン＝進め方 A**（共有 `ActivitySpark`＋グラフ・catalog-detail に横断活動集計）。メタ限定＝本文は参加後（`can_access_quest` 現状維持）。ユーザー決定。
2. **CRT 電源OFF の閉じ演出は全モーダル共通**（開く CRT 電源ON と対称）。ユーザー決定。**CSS のみ**（framer は静止後も合成を触りバックドロップがチカつく＝DFT-E-012 回帰のため不可）。
3. **フォローは 2 形態**＝`.follow-toggle`（枠付き 星＋テキスト・詳細/ダイアログ）／`.follow-star`（アイコン・カード）。ダイアログのフォローはアイデア詳細と同位置（ヘッダー右上）。ユーザー決定（画像イメージから仕様起こし）。
4. **発見デモを自動 seed に追加**（bootstrap `seed_demo_discovery`）＝CI/デモ双方で安定・「デモは DB リセットで消える」ワート解消。**ゼロ部署＝全社公開**にして seed 一般ユーザーが非メンバーで発見できる形。採用しなかった案＝(a) discoverable トグルを先に実装して e2e で自前生成（scope 大）(b) dev-seed 依存 e2e（CI 不安定）。ユーザーが seed 追加を選択。
5. **受入不具合は §5.3 準拠で回帰テスト同梱**（C-TC-266/267/268・red は修正 revert で観測・`red確認台帳.md`）。表示/挙動ガードは e2e で担保。

## 7. 次にやること（優先順・具体的に）
1. **FR-40 残スライス（受信側＝作成者/quest_admin の承認/却下）＝未実装**：`GET /quests/{id}/join-requests`・`POST .../{uid}/approve`・`.../reject`（`doc/API設計/C_…md` C.9.1 に仕様あり）。承認で `quest_members` 追加＋通知 `join_request_decided`（`app/tenant/notifications/catalog.py` にテンプレ追加要）。repo に `list_join_requests`・`list_owner_and_admin_ids` は用意済み（未確認＝関数名はコードで裏取り）。UI＝SC-12 パーティータブ（`features/quests/components/QuestPartyPanel.tsx`／`QuestPartyModal.tsx`）に pending 上位・rejected 下部・行クリックでプロフィール→承諾/拒否（SC-12 §4.3）。
2. **FR-40 残スライス（作成者が discoverable を立てる）＝未実装**：SC-11 に discoverable トグル。backend＝C.2 の create/update（`application.py create_quest_flow`/`update_quest`＋`QuestCreateRequest`/`QuestUpdateRequest` schema に `discoverable`）／frontend＝`features/quests/components/QuestForm.tsx` にトグル。※現状は seed（`seed_demo_discovery`）か直 DB でしか立てられない。
3. **FR-40 残スライス（フォロー通知 `quest_watch_update`）＝未実装**：クエスト状態遷移/締切/新着件数でフォロワーへ post-commit 通知（メタ級）。発火点＝C.5 の状態遷移・締切変更・アイデア公開。catalog テンプレ追加要。
4. **FR-40 残スライス（ダッシュボード SC-01）＝未結線**：§4.6b フォロー中クエスト・§4.6c 参加リクエスト状況の frontend 結線（backend は `quest_follows`／`my_state` あり・集約 EP は要検討）。
5. **推奨：まとまった変更の前に backend 全体スイートを一度回す**（本セッション末以降の再確認は未実施＝§4）。

## 8. 再開に必要な環境情報
- **作業ディレクトリ**＝リポジトリルート `/home/t-umekawa/sc-ideaquest-G2`。docker 操作は必ず **`impl/`** から。
- **コンテナ起動（フル・受入用）**＝`cd impl && docker compose --profile workers up -d`。ポート＝frontend **3000**・backend **8000**・MailHog UI **8025**・MinIO **9000**。
- **backend 改修の反映**＝`cd impl && docker compose build backend && docker compose up -d backend`（source 無マウントのためベイク＝再ビルド必須）。**OpenAPI 変更時は frontend 型再生成**＝`cd impl/frontend && npm run codegen`（稼働 backend:8000 を引く＝先に backend 再ビルド起動）。
- **frontend 改修の反映**＝`cd impl && docker compose build frontend && docker compose up -d frontend`（**ブラウザは DevTools「Disable cache」でリロード**）。ビルドゲート＝`cd impl/frontend && npm run build`（tsc＋ESLint＋Next lint・必須）。vitest＝`npx vitest run`。
- **frontend e2e**＝`cd impl/frontend && npx playwright test <spec> --project=chromium --reporter=line`（要 frontend:3000）。既定 reducedMotion＝no-preference（reduce テストは `page.emulateMedia({reducedMotion:'reduce'})`）。
- **backend pytest（最新 source 反映）**＝`cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend python -m pytest <path> -k "<expr>" -q`。**`-v` マウント必須**。**全体実行時は先に `docker compose stop worker mail-worker`**（outbox 系フレーク回避）→ 実行後に受入なら再起動。新 migration/seed は本コマンド起動時の bootstrap で seed 会社DBに適用される。
- **トレーサビリティゲート**＝リポジトリルートで `python3 scripts/check_tc_traceability.py`（コミット前に ✅ 必須）。
- **seed ログイン**＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`（MFA 会社は `ACME-02`／`mfa@acme2.example`）。
- **発見カタログ確認**＝ログイン→左ドロワー「🔎 クエストを探す」（`/quest-catalog`）。bootstrap `seed_demo_discovery` の「【発見デモ】部署横断アイデア募集」が1件出る（`my_state=none`・活発度スパーク＝合計18件）。
- **CRT 閉じ演出の style-guide モック**＝`doc/画面設計/mocks/style-guide.html` を開き §10 のダイアログで開閉。演出変更はまず style-guide→受入→production 移植の運用。
- **ゲーム層が出ない時**＝seed アカウントの `accounts.game_mode_override` を None に（会社デフォルト ON）。`docker compose run --rm -T backend python -c "..."` で control_session 経由で更新（`G-TC-175` の前提）。
- **コミット規約**＝末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。受入/レビュー反映は main 直コミット可。
- **正本の場所**＝実装現況 `impl/README.md`／実装順 `doc/実装計画.md`／規約 `doc/規約/*`（一覧サーバー委譲＝フロントエンド実装フロー規約 §4.1）／設計ドラフト `doc/設計ドラフト/*`／テスト台帳 `doc/テスト/*`（backlog＝`カバレッジギャップ.md`・red 証跡＝`red確認台帳.md`）／横断UI標準 `doc/画面設計/デザイン標準.md`。FR-40 の正＝FR-40／データモデル §5.6/§5.8b/§5.8c／API設計 C.9・H／`SC-13_発見カタログ.md`。

---
### 自己チェック（これだけで再開できるか）
- ✅ 最新コミット `bfca58f`・本セッションのコミット列（`1615f54`/`cba6464`/`bfca58f`）・push は末尾で実施を明記。
- ✅ 今回の 4 系統（スパークライン／ダイアログ2不具合／CRT閉じ演出／フォロー表現・カード統一）を §3 にファイル・関数レベルで明記。
- ✅ テスト状況＝backend 628（seed 追加後の全体・以降 frontend のみ）・SC-13 e2e 3・SC-22 follow 4・vitest 188・traceability ✅618・build 通過を明記。
- ✅ 詰まった点（follow-star 衝突／CRT 誤発火／G-TC-175 切り分け／seed 実測／二重 seed 掃除）と近道を §5 に記録。
- ✅ 次アクション＝FR-40 残スライス（受信側／discoverable トグル／フォロー通知／ダッシュボード結線）を §7 にファイル・関数レベルで明記。
- ⚠️ 未確認事項＝(1) frontend 変更後の backend 全体スイート再実行（未実施・628 のはず）(2) `repo.list_join_requests`/`list_owner_and_admin_ids` の正確な関数名は着手時にコードで裏取り (3) `G-TC-175` は DB リセットで game_mode_override が False に戻ると再発しうる。
