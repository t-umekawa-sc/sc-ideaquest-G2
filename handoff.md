# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-17 JST**（[B]② sort＋一覧状態復元＋[C]①②＋[B]③ダッシュボード＋[B]⑤ shop 完全サーバー委譲＋一覧規約化のセッション）
- ブランチ: **main**（受入/レビュー反映＝main 直コミット。`feature/game-feel` は今回未使用）
- 最新コミット: **3bb7c73** `docs(convention): 新規一覧は最初からサーバー委譲契約で作る（作り直し回避）`（この後の handoff コミットが実 HEAD）
- **push 済み・未 push 0**（`main...origin/main` 同期・確認済み）
- 本セッションのコミット（古い順・すべて push 済み）＝ `9aaeec9`([B]② sort)→`3944c16`(一覧状態復元)→`a57da50`([C]①)→`a25d1b3`([C]②)→`894a3fb`([B]③)→`78fb955`(list_query→core)→`002f0d8`([B]⑤ backend契約)→`0870d53`(state多値)→`d3b2de3`([B]⑤ frontend server)→`3bb7c73`(一覧規約化)＋各 handoff。

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションするマルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。現在は**ブラウザ受入フェーズ**＝全画面 backend 接続済み。

## 3. 今回やったこと（変更ファイルと理由）

### 0. 本セッション（2026-09-17）＝backend 全体スイート確認 ＋ [B]② `GET /quests` の sort 実装
- **backend 全体スイート green を確認**（592 passed／後述 §4）＝§7-6 の未確認を解消。
- **[B]② `GET /quests` の `sort` を実装**（`9aaeec9`・§1.8.1／C.1）。router に `sort` 追加／application で whitelist 検証（未知キー→`422 validation_error`・`field="sort"`）・sort 解析・**カーソルをソートタプル内包形式へ再設計**（旧形式カーソルは 422＝仕様どおり）／repository で `idea_count`/`member_count` を**相関スカラサブクエリ**として SELECT に載せ SQL でソート/keyset（各行に属性付与＝DTO 集計も兼ね N+1 回避）・**mixed-direction keyset**（末尾 `id` DESC で一意化）・`deadline` は **NULLS LAST**。既定は `-created_at`（新着）維持。
  - 変更ファイル＝`app/tenant/quests/{router,application,repository}.py`・テスト `tests/quests/test_{repository,api}.py`。
  - テスト＝**C-TC-010/011/012**（int: 集計列ソート+keyset・deadline NULLS LAST・複数キー tiebreak）・**C-TC-106/107/108**（api: idea_count 降順・未知キー422・ソート指定時のカーソル安定）。red→green を目視（実装前6件 red）。
  - 台帳＝`doc/テスト/カバレッジギャップ.md` [B]② を [x]／`doc/テスト/C_クエスト.md` に TC 行／`impl/README` SC-10 に注記。**frontend DataTable への `?sort=` 結線は未**（backend 契約は充足）。
- **一覧の操作状態（検索/ソート/絞込/ページ）の URL 復元を回帰テストで担保**（`3944c16`・§4.5⑨）。判明＝**復元は既に共通 `DataTable.tsx` に実装済み**（session状態=URL `?<storageKey>.q/.sort/.f/.page`・表示設定=localStorage・スクロール=§4.12）だが URL 状態復元の e2e が無かった。SC-10 で **M-TC-016**（ヘッダソート→詳細→戻るで復元）・**M-TC-017**（sort+絞込を URL 適用→戻るで復元）を追加＝**プロダクションコード無変更**（既存挙動を確認・2 passed）。恒久メモリ `list-state-restore-unified`。ユーザー方針＝一覧共通機能は共有 DataTable に統一。
- **[C]① 無変更保存ガードを実装**（`a57da50`・D.2/D.4）。`update_idea` が公開中 PATCH で `_apply_content` の前後の `_content_snapshot` を比較し、**差分ゼロなら版/通知（`_record_revision`）をスキップ**（frontend 抑制と対称・§1 サーバー権威）。テスト＝**D-TC-229**（同一内容 PATCH=版据え置き+通知0／実変更は版2+通知1）。設計 D「編集と版」/D.4 に明記。red→green 目視。
- **[C]② メンション差し替え通知整合を実装**（`a25d1b3`・E.2/E.6・**決定A＝追加分のみ通知**）。no-op だった `_notify_message_updated` を実装＝`edit_message` が `replace_mentions` 前後の被メンション集合を比較し **added（編集後−編集前・自分/重複除外）にのみ** `mention` 通知（不変は再通知せず・外した分は通知も取消もしない＝at-most-once・H に取消プリミティブなし）。テスト＝**E-TC-228**。設計 E.2/E.6 に反映。red→green 目視。**これで [C] 乖離は残なし**。
- **[B]⑤ `GET /items` を完全サーバー委譲（B2+）＋一覧作り直しを規約化**（2026-09-17）。仕様確認＝G.1 はフィルタ/ソートを規定・frontend は client 充足だったが、ユーザー判断で**完全サーバー委譲**へ。P0＝`list_query` を `app/core` へ移動（`78fb955`）。P1/P2＝G.1 拡張＋backend `query_items`（q/slot/rarity/owned/affordable/state多値/price範囲/sort/番号ページャ/pin/CSV・閲覧者依存・rarity序列・後方互換=未指定は全件）＋TC G-TC-310〜317（`002f0d8`/`0870d53`）。P3＝ShopView を DataTable サーバーモード化（`itemsQueryParams`・`refreshToken` で購入後の絞込維持再取得・DataTable に `refreshToken` prop 追加）＋G-TC-318 e2e（`d3b2de3`）。P4＝**フロントエンド実装フロー規約 §4.1 新設**（新規一覧は最初からサーバー委譲契約で作る）＋API設計§1.8.1/デザイン標準§4.5 補強（`3bb7c73`）。恒久メモリ `list-server-delegation-standard`。
- **[B]③ ダッシュボード populated 系の純テストを追加**（`894a3fb`）。裏取りの結果 **`get_dashboard` は全パネル合成済み＝実装ギャップではなく純テスト不足**だった（production 無変更）。追加＝**I-TC-107/108/122**（api・`tests/dashboard/test_api.py`）＝週間ランキング(data≤3＋me)・通知(data≤5＋unread_count)・IDOR(自スコープのみ)／**I-TC-131/141/142/143**（int・`tests/dashboard/test_cross_domain.py`＝新規）＝best-effort(1パネル例外で当該 null)・D/F 横断 read(下書きアイデア/未投票/下書き評価 scored=2)。台帳 I-TC-107 の期待キーを実装(`data`)に訂正。カバレッジギャップ [B]③ を [x]。


### A. モーダル・バックドロップのチカチカ修正（`8e95e32`・前セッションの主作業）
- **症状**＝モーダル/ダイアログの薄いグレーのバックドロップが常時チカチカ（Chrome/Edge 共通・ゲームOFF/HWアクセラOFFでも出る）。
- **根本原因**＝共通モーダル `impl/frontend/src/components/ui/Modal.tsx` の開閉アニメが **framer-motion**（`motion.div`＋`AnimatePresence`）実装で、**静止後も framer の frameloop が毎フレーム合成レイヤを触り**、半透明バックドロップ（`rgba(...,.45)`）が Chromium で再合成されてチラつく。**確定手順＝mock `style-guide.html`（CSS のみ・framer 無し）と実装を同一ブラウザで A/B**（mock は出ず実装だけ出た＝framer 起因を確定）。
- **修正**＝`Modal.tsx` から framer を撤去し **CSS アニメに置換**（`.modal` に `.show` トグル→`design-system.css` の backdrop opacity トランジション＋`@keyframes modal-crt-open`＋`::after` フラッシュ）。focus/Esc/ドラッグ/最大化/スクロールロック/`onClosed`(URLモーダルの戻る) は維持。reduce-motion は `src/lib/motion.ts` の `reduceMotion()`(OS＋ユーザー設定)で CRT を出し分け。
- **併発の別要因も対処**＝背後の `backdrop-filter: blur`（ゲーム風パネル `.pixel-panel`）が半透明バックドロップ越しに**全面再描画**（DevTools Paint flashing で全面緑）する現象を、`design-system.css` の `body.modal-open :not(.modal)...{ backdrop-filter:none; animation-play-state:paused }` で無効化。
- **記録・回帰防止**＝経緯と診断法の正は `doc/画面設計/デザイン標準.md` §4.1（「モーダルのアニメは framer で実装しない・DFT-E-012」）。回帰テスト＝`M-TC-015`（`impl/frontend/e2e/sc-99-modal-backdrop.spec.ts`）。モーダル開閉/Esc は既存 `C-TC-201/202`（`sc-11-quest-create-modal.spec.ts`）が担保。
- **付随**＝`.gitignore` に `*.mp4/mov/webm` 追加（不具合調査の録画は追跡外）。

### B. テストカバレッジ [A] Med/Low を完走（`be138e2`・`079fb62`）
台帳＝`doc/テスト/カバレッジギャップ.md`。**backend プロダクションコードは未変更**（実装済みの振る舞いへの純テスト追加）。**着手前にコードで裏取りした結果、多くが既存担保済み or 純テスト不可**と判明し台帳を実態に訂正。
- 追加した TC（すべて green）＝ **B-TC-045〜049**（`/admin/accounts` セルフ経路の編集/disable/enable/password-reset/他社IDOR404/identity409・`tests/admin/test_admin_self.py`）・**A-TC-110**（email-verify 不正Origin403）・**C-TC-145/146**（PUT /party completed409・原子性）・**E-TC-227**（引用元delete で excerpt トゥームストーン）・**G-TC-407/408**（ランキング多段tiebreak・this_month/all）。
- 既存担保を確認し台帳訂正（テスト追加せず）＝ permission境界(F-107/E-104/D-103/D-122)・メール再送失効(B-165/166/A-104/B-167)・GET /me署名URL(K-TC avatar)。

### C. 設計を実態化＋TC-ID 重複解消（`f7d8cc9`）※ユーザー承認済み
- `GET /me/spells`＝不採用化（API設計 G.3・`GET /spells` に一本化）。
- `chat_preview`＝「現状未実装・将来対応」と明示（API設計 D.1/E.1）。
- **B-TC-025 の二重定義**（発行の冪等 と disable）を解消＝発行の冪等を **B-TC-035** へ改番（disable 側 025 が `red確認台帳` 参照の原典）。

## 4. 現在の状態（動作/テスト）
- **動いているもの**＝フロント全画面 backend 接続済み。**モーダルのチカチカは解消**（ユーザー目視で確認済み）。
- **テスト通過状況**＝**backend 全体スイート green（2026-09-17）＝`614 passed`**（推移＝592→sort 598→[C]①599→[C]②600→[B]③+7=607→[B]⑤ shop server契約+7=614）。フロント e2e＝一覧状態復元2件（M-TC-016/017）＋shop 6件（`sc-30-shop`/`sc-30-shop-server`＝G-TC-202/203/318・balance-sync）green。`npm run build` 通過。**注意＝pytest 全体実行時は `worker`＋`mail-worker` 両方を止める**（`docker compose stop worker mail-worker`）＝稼働のままだと outbox 系（`test_b_tc_005`）がリトライ競合でまれに落ちる（フレーク・単独 green・§8）。実行＝docker フル起動→mail-worker停止→`docker compose run --rm -T -v backend:/app backend python -m pytest -q`。warning 3 件は依存の Deprecation（httpx/anyio/alembic）で結果に影響なし。フロント e2e はモーダル5件 green（`sc-11` C-TC-201〜204・`sc-99-modal-backdrop` M-TC-015）。`npm run build`（tsc＋ESLint＋Next lint）通過（今回 frontend 未変更）。
- **トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` = **✅ code 582 件すべて md 記載**（確認済み）。
- **壊れているもの**＝認識している範囲では無し。
- **コンテナ**＝本セッション末時点でフル起動中（frontend/backend/db/redis/minio/mailhog/worker/mail-worker）。次セッションでは落ちている想定＝§8 で再起動。

## 5. 詰まっている点（試して失敗したアプローチ＝チカつき調査の記録）
モーダルのチカつきは**環境（GPU/Chromium 合成）依存でヘッドレスでは再現しない**ため、確定まで回り道した。次回同種の問題での近道用に失敗も残す:
- **CSS アニメの停止**（`animation-play-state: paused`）→ 効かず。原因は CSS `@keyframes` ではなかった（背後の `bell-wiggle` は在ったが主因でない）。
- **backdrop-filter の無効化**→ 「全面緑（全面再描画）」は消えたが**チカつきは残った**（これは別の併発現象だった）。
- **backdrop に `translateZ(0)`/`isolation: isolate`**→ 効かず（半透明要素の独立レイヤ化はむしろ逆効果になりうる・撤回済み）。
- **HW アクセラ OFF / ゲームモード OFF**→ どちらでも出る＝GPU単独/ゲーム層ではないと確定。
- **決め手＝mock（`style-guide.html`＝framer 無しの CSS のみ）と実装の A/B**。mock は出ず実装だけ出た→framer 起因を確定。診断に効いたツール＝**DevTools「Rendering→Paint flashing／Layer borders」**・`document.getAnimations()`・要素の computed `backdrop-filter` 列挙・rAF での opacity サンプリング。**教訓＝ヘッドレス計測で「DOM/CSS はクリーン」と出ても、合成レベルの回帰はあり得る。framer 有無の A/B が最短**。

## 6. 決定事項と根拠（採用しなかった案も）
1. **モーダルのアニメは framer-motion で実装しない＝CSS のみ**（DFT-E-012）。framer の frameloop が半透明バックドロップをチカつかせるため。CSS アニメは再生後に停止し frameloop を持たない。→ 採用しなかった案＝framer のまま `translateZ`/`isolation` 等で合成を安定化（いずれも効かず）。正＝デザイン標準 §4.1・恒久メモリ `modal-no-framer-css-only`。
2. **モーダル表示中は背後の backdrop-filter/CSS無限アニメを無効化**（暗転して見えないので実害なし＋全面再描画を防ぐ）。
3. **台帳の残項目は「テスト追加」より先に「実態で done か」をコードで確認**し、既済なら重複テストを書かず台帳を訂正する。
4. `GET /me/spells`/`chat_preview` は実装を増やさず**設計を実態に合わせる**（ユーザー承認）。

## 7. 次にやること（優先順・具体的に）
1. **結果タブ Modal 化の受入＝完了扱い**（当初セッションの目的）。ダイアログのチカつき修正込みで正常動作を確認済み。回帰テスト要否は不要と判断（M-TC-015＋C-TC-201/202 でカバー）。
2. **[A] 純テストは残ゼロ**＝`doc/テスト/カバレッジギャップ.md` の [A] セクションに未対応の純テストは無い（残る `[ ]` は [B] 実装ギャップ・[C] 乖離のみ）。
3. **[B] 実装ギャップ（実装＋テスト・要ユーザー着手指示）**＝ ①認証イベントの監査ログ（**要精査**＝A.9-⑥。`audit.record` は auth 2種＋admin 多数で既に記録済み＝handoff 旧記述「1箇所のみ」は誤り。欠落イベントの有無を先に精査）②~~`GET /quests` の `sort`~~＝**実装済み（`9aaeec9`）** ③~~ダッシュボード populated~~＝**2026-09-17 テスト追加済み（`894a3fb`・I-TC-107/108/122/131/141〜143・実装は既済で純テスト不足だった）** ④リアルタイム L-TC-103/131（未対応・台帳にIDあるが未実装） ⑤~~`GET /items` フィルタ~~＝**2026-09-17 完了（B2+ 完全サーバー委譲）**＝backend G.1拡張（q/slot/rarity/owned/affordable/state/price範囲/sort/番号ページャ/pin/CSV・`list_query`共用）＋ShopView を DataTable サーバーモード化（`d3b2de3`ほか・G-TC-310〜318）。⑥`chat_preview` 実装（将来）。
4. **[C] 設計・実装の乖離＝両方 2026-09-17 実装済み**＝ ①~~無変更保存＝版なし~~（`a57da50`・`update_idea` が差分ゼロなら版/通知スキップ・D-TC-229・D.4 反映） ②~~メンション差し替え通知整合~~（`a25d1b3`・決定A＝編集で追加された被メンションのみ通知・E-TC-228・E.2/E.6 反映）。**[C] 残なし**。
5. **クエスト参加リクエスト設計ドラフト**（`doc/設計ドラフト/クエスト発見_フォロー_参加リクエスト_設計.md`）＝**まだドラフト・実装着手指示なし**。着手指示が出たら正規化（要件定義FR・データモデル `quest_follows`/`quest_join_requests`/`quests.discoverable`・API設計C/H・screens）へ展開。決定事項は当ドラフト §6/§8。
6. **backend 全体スイートは 2026-09-17 に確認済み**（無変更ガード後 599 passed・§4）。まとまった変更のたびに §8 の pytest コマンドで再確認する。

## 8. 再開に必要な環境情報
- **作業ディレクトリ**＝リポジトリルート `/home/t-umekawa/sc-ideaquest-G2`。docker 操作は必ず **`impl/`** から。
- **コンテナ起動（フル・受入用）**＝`cd impl && docker compose --profile workers up -d`。ポート＝frontend **3000**・backend **8000**・MailHog UI **8025**・MinIO **9000**。
- **frontend 改修の反映**＝`cd impl && docker compose build frontend && docker compose up -d frontend`（source 無マウントのため再ビルド必須。**ブラウザ側は DevTools「Disable cache」でリロードしないと古い CSS/JS が残る**＝今回のチカつき確認で実際に嵌った）。
- **frontend ビルドゲート**＝`cd impl/frontend && npm run build`（tsc＋ESLint＋Next lint）。
- **frontend e2e（Playwright・要 frontend 3000 稼働）**＝`cd impl/frontend && npx playwright test <spec> --project=chromium --reporter=line`。モーダル関連＝`sc-11-quest-create-modal`・`sc-99-modal-backdrop`。
- **backend pytest（最新 source を反映）**＝`cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend python -m pytest <path> -k "<expr>" -q`。**`-v` マウント必須**（付けないと古いベイクを実行）。全体は `<path>` 省略。**pytest 実行時は mail-worker を止める**（`docker compose stop mail-worker`）。
- **トレーサビリティゲート**＝リポジトリルートで `python3 scripts/check_tc_traceability.py`（コミット前に ✅ 必須）。
- **seed ログイン**＝会社コード `ACME-01`／ログインID `user@acme.example`／パスワード `Passw0rd!`。
- **モーダル/結果タブ受入に使える完了クエスト**＝`ff846bae-fa9f-4ed9-a025-e1c97133dc49`（「【受入】D-完了クエスト」・owner=seed ユーザー＝結果タブ編集可・未削除）。※他の E2E 生成完了クエストは削除済み(404)が多い。DB は `ideaquest_control`（accounts/companies）・`ideaquest_company_acme`（テナント）・接続ユーザー `ideaquest`。
- **コミット規約**＝末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。受入/レビュー反映は main 直コミット可。
- **正本の場所**＝実装現況 `impl/README.md`／実装順 `doc/実装計画.md`／規約 `doc/規約/*`／設計ドラフト `doc/設計ドラフト/*`／テスト台帳 `doc/テスト/*`（カバレッジ backlog＝`カバレッジギャップ.md`）／横断UI標準 `doc/画面設計/デザイン標準.md`。

---
### 自己チェック（これだけで再開できるか）
- ✅ 最新実装コミット `9aaeec9`（[B]② sort）・push 状態・ブランチ明記。
- ✅ 本セッションの主作業（backend 全体確認＋[B]② `GET /quests` sort 実装）を §3-0 に原因・設計判断・テストまで明記。
- ✅ 前セッションのモーダルチカつき修正（framer→CSS）・[A] テスト完走・設計実態化も §3 に残置。
- ✅ テスト状況＝追加6件/既存一覧TC green、**backend 全体スイートは sort 実装後 598 passed で確認済み**と明記。
- ✅ 失敗アプローチ（CSSアニメ停止/backdrop-filter/translateZ/HWアクセラ/ゲームOFF）と、確定手順（mock A/B・Paint flashing）を §5 に記録＝次回同種問題の近道。
- ✅ 再起動/ビルド/テストコマンド・**Disable cache の落とし穴**・seed 認証・受入用クエストID を §8 に明記。
- ⚠️ 未確認事項＝(1) 設計ドラフトの実装着手指示（現時点なし）(2) frontend DataTable への `?sort=` 結線は未着手（backend 契約は充足）。
