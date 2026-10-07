# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-07（セッション末・ユーザー指摘txtの「小さい不具合」一括＋F8＋フローティング重なりまで）
- ブランチ: `main`（main 直 push が慣習・本セッションも都度 push 済み）
- 最新コミット: `5dfccd84 fix(datatable): 会社名/列名フローティングの重なり解消`
- working tree: **clean**・`origin/main` 同期済み。
- alembic heads（ファイル基準・**本セッションで新規 migration なし**）: control=`0020_signup_challenges`／company=`0056_info_curators_into_user_capabilities`。
- 本セッションのコミット（古→新・すべて push 済み）: `05d00a40`(⑦⑧非公開折返し+403→404)／`e98d3075`(⑥ⓘ残り幅展開)／`afaea8a6`(⑨整合=縦ラジオ)／`c081d5e6`(F8メディアプロキシ)／`5dfccd84`(⑭フローティング重なり)。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝**ユーザー指摘txt の消化**（受入不具合の改修＋仕様確定済み未実装）。

## 3. 今回やったこと（指摘txt起点・全てテスト同梱＋実画面目視）
> 指摘の出所＝ユーザーの Windows デスクトップ `C:\Users\t-umekawa\Desktop\無題1_20261003_090605.txt`（WSL パス `/mnt/c/Users/t-umekawa/Desktop/無題1_20261003_090605.txt`）。10項目＋会話中の追加指摘。**作業方針（ユーザー決定）＝「小さい不具合を先に」→ 実装群 → 討議(④③)は実装群の後**。

### 完了（小さい不具合＋F8＋フローティング）
- **⑩ red確認の規約是正**（監査のみ・コード不変）＝今セッション分の red 証跡（昇格/出典/info_curators）は §5.1 準拠を確認。**ただし過去5件が未是正で残存**＝`red確認台帳.md:393(D.3)/427(D.4)/445(F)/465(E)` と `B_会社・アカウント.md:239` が「未実装/未登録の404/405 を自然 red」と記述（§5.1 が名指しで不可とするパターン・B-TC-080〜093 のような retro 是正が未）。ユーザー判断＝**今回は現状報告のみ**（是正は別途）。
- **⑦** 会社詳細「公開(コンテスト専用)モード」の状態語「非公開」折返し解消＝共有 `.switch__state{white-space:nowrap}`（`05d00a40`・B-TC-180）。
- **⑧** 同補足文「サーバーで 403」→「404＝存在秘匿」是正（public会社の業務EPは `access_gate` が404・決定P'）（`05d00a40`・B-TC-180）。
- **⑥** ガイダンス ⓘ(`ScreenPurpose`・§4.13) を hover で**ホスト行の残り幅いっぱい**に展開（内容幅で止めない）＝`max-width`→`width`駆動＋`place()`460px上限撤去＋検索ツールバーの `data-sp-host` を内容幅`.filters`→全幅`.list-toolbar`へ（contest/quest 両画面・共通仕様）。§4.13/style-guide/shared.css 同期（`e98d3075`・C-TC-308）。
- **⑨** 会社詳細「経営資料との整合の測り方」を `<select>`→**縦ラジオ** `.radio-list`（design-system.css 新設）。DRY＝評価の公開範囲(`.vis-opt`)も同共有クラスへ統合し evaluations.css の重複撤去。style-guide「4e」＋shared.css 追加（`afaea8a6`・B-TC-181・sc-25-eval 11 passed 回帰OK）。
- **F8** リッチ本文インライン画像の恒久表示＝**安定配信プロキシ `GET /api/v1/media/{key}`**（`require_me`→インライン画像prefix検証→都度再署名→302・`app/tenant/media/router.py`）。rehost(info N.2/お知らせ U-8)は `storage.media_proxy_path(key)`（`/api/v1/media/<key>`・env非依存相対パス）を返し body_html に安定パス保存。`access_gate` 許可リストに `/media` 追加。**frontend 無改修**（RichTextEditor が返却urlをimg srcに挿入・Next rewrite `/api/v1/*`→backend）。`sanitize_html`(nh3) は相対URL素通し。（`c081d5e6`・U-TC-110/113/114/115・N-TC-125）。
- **⑭（会話追加指摘）** 会社詳細で会社名バナー(`.ctx` sticky)と列見出しフローティング(DataTable floatHead)の重なり解消＝floatHead の top 計算に `.ctx` を考慮（下端＋余白8pxへ）。ロジックを純関数 `belowStuckBar`(`components/ui/floatHeadTop.ts`)に抽出し `.tabs`/`.ctx` 共用。（`5dfccd84`・M-TC-019・実画面 overlap=false 確認）。

## 4. 現在の状態（動作/テスト）
- **backend pytest**（-v マウント／ベイク exec とも）＝`tests/announcements tests/info` **68 passed**（F8 分含む）。他ドメイン未回帰確認（F8 は storage/access_gate 触るが低リスク・full は未実行）。
- **frontend**＝`npm run build` ✅（複数回）。`npx vitest run floatHeadTop.test.ts` 4 passed。e2e＝B-TC-180/181(sc-92)・C-TC-308(sc-12)・sc-25-eval 11 passed を実行し green。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅（code 1020 件）。
- **コンテナ**＝backend/db/frontend/mailhog/minio/redis 稼働・本セッションの変更を `--build` 反映済み。**worker/mail-worker は停止中**。
- 壊れているもの＝**無し**（確認範囲）。

## 5. 詰まっている点（注意）
- **TC-ID 採番は既存 max 確認後**（`grep -rhoE '<D>-TC-[0-9]+' doc/テスト/` で max→+1）。本セッションで採番＝B-TC-180/181・C-TC-308・M-TC-019・U-TC-113/114/115。※`check_tc_traceability.py` は**重複を検出しない**。なお `tests/info/test_api.py` に **N-TC-125 が2つ存在**（pin_ids と rehost・pre-existing の重複・未是正＝将来 renumber 候補）。
- **frontend にコンポーネント描画テスト基盤が無い**（vitest=node env・testing-library/jsdom 未導入）＝UI 構造/レイアウトの回帰は e2e か「純ロジック抽出→unit」で担保（⑭は後者＝belowStuckBar）。
- **UI レイアウト/崩れ系は報告前に必ず実画面スクショ目視**（テスト規約§5.5・memory `verify-ui-visually-before-done`）。本セッションは使い捨て `impl/frontend/_*.mjs`(Playwright chromium)で計測＋スクショ→削除、を徹底。
- **baked backend の pytest は未コミット編集を反映しない**＝`-v` マウント run か `up -d --build backend`。
- **frontend はビルドをベイク**＝CSS/TSX 変更は `up -d --build frontend` まで実ブラウザ/e2e に反映されない。
- **新規EPの red は §5.1＝スタブ(501/誤値)先置き→差分で behavior-red**（ルート未定義404はNG・handoff で過去に指摘済み）。F8 はこの手順で実施（台帳記録）。

## 6. 決定事項と根拠
- **F8＝案(b)安定配信プロキシ採用**（バックログF8推奨）＝認可/監査/キャッシュ制御を1点集約。安定パスは**相対**（ホスト名を焼かない）＝ⅰ nh3 が相対URL素通し ⅱ Next rewrite で同一オリジン→backend。プロキシ対象は**インライン画像prefixのみ**(`announcement-images`/`info-images`)＝添付/アバターの踏み台防止・対象外は404存在秘匿。認可は `require_me`（粗粒度・キーは sha256+乱数で列挙耐性＝現 presigned と同等の保護水準）。
- **⑥ ⓘ展開幅＝ホスト残り幅いっぱい**（内容長を考慮しない・ユーザー要望）＝`width`駆動。ホストは**全幅の行**を指す（検索は `.filters`でなく`.list-toolbar`に `data-sp-host`）。
- **⑨ 縦ラジオは共有 `.radio-list`**＝横の`.segmented`より選択肢が長い/各肢に説明が要る単一選択向け。評価の公開範囲(`.vis-opt`)も統合（DRY・CSS同一＝視覚不変）。
- **⑭ floatHead は sticky バー(.tabs/.ctx)の下へ**＝`belowStuckBar`（張り付き判定＝`bottom>top && top<=top+4`→`bottom+gap`）。

## 7. 次にやること（優先順・ユーザー確定の実装群→討議）
> **「小さい不具合を先に」は消化済み。残りは実装群（中〜大）→ 討議(④③)**。着手前にコードで現況裏取り（memory `handoff-notes-often-stale`）。
1. **⑤ コンテストの参加承認前のタブ表示整理**＝会社アカウント管理者が承認前でも、パーティタブは可視のまま／**アイデア・全文検索タブも「タブは表示」するが中身は「操作権限がない旨のメッセージのみ」**にする。現状は `ContestDetailView.tsx` が `forbidden`(403)で全体を閉じる（SC-54・`features/contests/components/ContestDetailView.tsx`）。承認制×未参加の見せ方の再設計＝タブ枠は出し中身をガードメッセージに。
2. **（新）全能力の汎用付与UI**（ユーザー決定＝quest_create 単体でなく**全能力**）＝`info_curator`/`quest_create`/`contest_create`/`contest_evaluator` を会社アカウント管理(SC-93系)で付与/剥奪する汎用UI。**backend EP は実装済み**＝`GET/POST/DELETE /api/v1/admin/accounts/{uid}/capabilities`(`capabilities/router.py`)。frontend は現状 `accounts/components/InfoCuratorSection.tsx`(info_curator専用)のみ→汎用化（§7-6 info_curators統合の総仕上げも兼ねる）。
3. **① AIモデルのクライアント選択UI**＝AI処理のモデルをクライアント側で選べるUIが無い。LLMゲートウェイ基盤あり（memory `fr45-llm-foundation-formalized`・`local-llm-integration-design`）。SC-04/94 周辺。着手前に gateway のモデル指定経路を裏取り。
4. **#13 アイデア作成者向け 評価詳細（コメント＋得点）閲覧画面**＝作成者が評価者のコメント・得点詳細を確認できる画面。評価ドメイン(F)。着手時に既存の評価可視範囲(visibility=party/limited・F.1集計)をコードで裏取りしてスコープ確定（SC-22/SC-25 周辺）。
5. **② AI処理状況のリアルタイム反映 E2E**＝他ユーザのジョブ開始/待機数/自分の番がリロード無しで反映・進捗率更新、を Playwright で確認（SC-04 ai-jobs・realtime L/WS）。共有DB非冪等注意（memory `e2e-full-not-idempotent-shared-db`）。
6. **④【討議】おすすめクエスト選出アルゴリズム**＝ユーザー案「参加可×経営資料整合率高×直近活発×管理者お勧めマーク、得点上位をパネル最大件数」への意見を返す→合意後に実装。
7. **③【討議】アイデアのLLM自動評価＋RAG**＝評価パネルに「AI評価」ボタン→背景ジョブでLLM採点＋コメント、必要ならRAG。将来は情報インプットの内部情報をRAG（社内Q&A/サポート）。**大型＝FR採番→データモデル→API→画面から**。

### 前セッションからの持ち越し（txt指摘とは別・未着手）
- Turnstile `size:flexible` 幅の実ブラウザ目視（`.env` の `#TURNSTILE_*` を外して `/signup` 確認・確認後 dev既定へ戻す）。
- SC-01 設計書 §3〜9 を5ゾーン再設計に整合（`doc/画面設計/screens/SC-01_ダッシュボード.md`）。
- アイデアコンテスト Phase2（妥当性解析・自動表彰スケジューラ＝LLM/スケジューラ基盤前提・MVP外）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`http://localhost:8000`・frontend=`http://localhost:3000`・openapi=`http://localhost:8000/openapi.json`・MailHog=`http://localhost:8025`。
- **workers（必ず `--build`）**：`cd impl && docker compose --profile workers up -d --build worker mail-worker`。確認後 `docker compose stop worker mail-worker`。
- 反映（ソースベイク・volumes無）：`cd impl && docker compose up -d --build backend|frontend`。型再生成＝backend 再ビルド後 `cd impl/frontend && npm run codegen`。
- DB直接：`docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- テスト：
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`（e2e は専用 bootstrap DB・db.reset.ts が走る）。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット反映は** `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`。
- `.env`（`impl/.env`・gitignore 追跡外）現状＝dev 共有スタック既定（`IQ_DEFAULT_COMPANY_CODE=`空・`TURNSTILE_*` コメントアウト＝CAPTCHA無効）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin・会社`OPS`）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`（public＋self_signup）。
- dev 会社id（control DB companies）：ACME-01=`debba8dc-7f32-4705-abd8-61f2d77e23c1`／OPS=`d249a8ea-5109-4974-ad46-e0da36a546e6`／DEMO=`a5e28360-043a-4b61-b659-664ab0107f2f`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`(Playwright chromium・`deviceScaleFactor` 上げて計測/スクショ)を作り**使い終わったら削除**。ログインは `#company_code`/`#login_id`/`#password` に fill→「ログイン」click。
