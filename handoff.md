# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-08（セッション末）。
- ブランチ: `main`（main 直 push が慣習）。
- 最新コミット: **本セッションのまとめコミット（⑥アイデアLLM自動評価の設計ドラフト起票＋AI基盤レベル方針）を push 済み**。直前は `e1779ea9`（①AIモデル選択UI＋UI標準刷新）。正確なハッシュは `git log --oneline -3` で確認。
- working tree: コミット後 **clean**・`origin/main` 同期済みの想定（再開時 `git status` で確認）。
- alembic heads（**本セッションで新規 migration なし**・ファイル基準）: control=`0020_signup_challenges`／company=`0056_info_curators_into_user_capabilities`。

## 2. プロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝**ユーザー指摘txt の消化＋仕様確定済みの未実装機能**を順次処理。①AIモデル選択UI まで消化済み。本セッションは**討議⑥（アイデアLLM自動評価＋RAG）を詰めて設計ドラフト起票**（コード未変更）。

## 3. 今回やったこと（変更ファイルと理由）
> 本セッションは**討議と設計ドラフトのみ・プロダクトコードは一切変更していない**。変更＝新規設計ドラフト md 1本と handoff、自分の記憶（メモリ）。

### 3-1. ⑥ アイデアLLM自動評価＋RAG の設計討議 → ドラフト起票
- 新規 `doc/設計ドラフト/アイデアLLM自動評価_設計.md` を**他ドラフトと同体裁**で起票（§0〜§10・論点表A〜I・保留論点§7-補・実装順§10）。
- **位置づけ（ユーザー決定）＝AI は独立した評価者**。目的は〈公平性・評価する/される側のギクシャク回避〉。人間評価者は介入せず自分の言葉で別途評価。**AI 評価は「参考値」ではなく正当な1評価**として集計・コインに正式算入（ユーザーが討議中に「参考値」を明示訂正）。**AI 評価しか付かないケースも想定**＝その場合も投稿者へ集計/コイン付与。
- **データモデル（決定）＝`evaluations` を拡張**（別テーブルにしない）。`evaluator_kind`(human|ai)追加・`evaluator_id` nullable・`ai_job_id`/`model` 保持・AI1件/ideaは部分ユニークindex（WHERE kind='ai'）。→ F.1集計/F.4コインの既存ロジックを**無改修で流用（DRY）**。表示は kind で別ブロック。
- **集計・報酬（決定）**＝F.1平均・F.4コインに AI 込み。**F.4確定トリガは従来維持**（全評価者submitted or quest completed・再計算なし）。AI 単独時は quest completed で確定。**XPは現仕様維持**（投稿者XPは選定+200のみ／評価者XP+30はAIに付かない＝アカウント無し）。
- **起動（決定）**＝アイデア共有(published)時に自動 enqueue（`ref_idea_id`）＋再生成ボタン(quest_admin)。
- **表示（決定）**＝作成者(被評価者)はAI評価の全文を詳細閲覧可・評価者が採点中に見えても可（気づきの好意的影響として許容）。
- **基盤**＝新task_type `idea_evaluate`（既定 qwen3-swallow・構造化JSON出力）。RAG＝クエスト本文＋関連情報＋経営資料(embedding top-k・既存A-2基盤)＋5観点ルーブリック。`AiGenerateControl`（分割ボタン）再利用。会社でモデル未有効/task無効なら生成スキップ(graceful)。

### 3-2. AI実行基盤の「レベル」方針を討議 → レベル1維持で決定
- 討議内容＝AI に「手順まで考えさせる／ツールを使わせる」エージェント化（レベル2/3）を先行構築すべきか。
- **決定＝AI実行基盤はレベル1（OpenAI互換の単発チャット補完＋バックエンドが決定論的に用意するRAG）のまま維持**。レベル2（LLMがツール選択→ハーネスが実行して結果を戻す多往復）の先行構築は**見送り**。
- **原則（ユーザー判断）**＝タスクが既知なら必要な情報取得はバックエンドが決定論的に先回りして揃える（レベル1）。LLMにツール選択を委ねる（レベル2）のは、何が求められているか事前に分からない**開放的な状況＝チャットのようなUI**に限る。消費者が出る前の基盤先行構築はしない（YAGNI・抽象を外すリスク）。
- 用語整理（討議で確認）＝**ツール**＝実行コード（決定論・呼んで結果が返る／合成しても「合成ツール」でスキルにならない）。**スキル**＝LLMが読む自然言語の手順書＝ライブラリに置き必要時にLLM自身が選んで読み込む再利用プロンプト(progressive disclosure)・手順が多様で選択が要る世界で初めて価値。レベル1=1往復・情報は全部こちら用意／レベル2=多往復・固定ツールをLLMが1手ずつ選ぶ／レベル3=計画+スキル選択+メモリ(大規模・上位モデル必須)。
- この方針はドラフト §9 に明記。gateway は `impl/backend/app/infra/llm/gateway.py`＝単発補完（`complete()`・`tool_calls` は未パース＝`gateway.py:95-96`）。ワーカー実行部＝`impl/backend/app/tenant/ai_jobs/application.py:450-528`（`_build_messages`→`gateway.complete`→`job.result`）。

## 4. 現在の状態（動作 / 壊れているもの / テスト）
- **プロダクトコード変更なし**＝ビルド/テストの状態は前セッション（`e1779ea9`）から不変。frontend `npm run build` ✅／vitest 252 passed・backend pytest 28 passed（§8 の方法で再実行可）。
- **TC トレーサビリティ**＝`python3 scripts/check_tc_traceability.py` ✅（code 1031 件）。本セッション開始時に確認済み。
- **コンテナ**＝セッション開始時は全て exited（WSL/Docker 再起動後）。再開は `cd impl && docker compose up -d`。
- **壊れているもの＝無し**。
- 変更したのは `doc/設計ドラフト/アイデアLLM自動評価_設計.md`（新規）・`handoff.md`・メモリのみ。

## 5. 詰まっている点（試して失敗したこと・なぜ）
- 本セッションは討議中心で技術的な詰まりは無し。
- 前セッションからの教訓は有効＝共有ユーティリティ(.btn等)の上書きは特異度を1段上げる（Next の CSS チャンク順・memory `next-css-chunk-order-specificity`）／UI修正は新コンテナ起動後に実ブラウザ目視（`verify-ui-visually-before-done`）／baked backend の pytest は `-v` マウント or `up -d --build backend`。

## 6. 決定事項と根拠（採用しなかった案も）
- **⑥ AI評価＝独立した評価者・正当な1評価**（参考値でない・集計/コイン算入）。不採用＝参考ドラフト型（人間が確認して反映＝ユーザー思想「評価者が介入すると違う・自分の言葉で付けるべき」に反する）／作成者向けフィードバック型（集計に効かない）。
- **データモデル＝evaluations拡張**。不採用＝別テーブル完全分離（F.1/F.4二重実装＝DRY違反）／擬似アカウント（accounts/XP/権限汚染）。
- **コイン確定＝従来トリガ維持／XP＝現仕様維持**。
- **AI実行基盤＝レベル1維持**（§3-2）。不採用＝レベル2/3 先行構築（消費者無しで抽象を外す＝YAGNI・小型ローカルモデルはツール使用/計画が不安定）。
- 詳細根拠はドラフト §7 論点表（A〜I）。

## 7. 次にやること（優先順・ファイル/関数レベル）
> 着手前にコードで現況裏取り（memory `handoff-notes-often-stale`）。**次セッション最優先＝⑥正式反映に着手**（ユーザー決定）。

1. **⑥ アイデアLLM自動評価の正式反映に着手**（最優先）。ドラフト `doc/設計ドラフト/アイデアLLM自動評価_設計.md` §10 の順で：
   - (a) FR 採番（`doc/要件定義/README.md`）。
   - (b) `doc/データモデル.md` §5.21-§5.22 に `evaluator_kind`／`evaluator_id` nullable／`ai_job_id`／`model`／部分ユニークindex を追記 → company DB migration 新規。
   - (c) `doc/API設計/F_評価.md` に AI評価の書き込み経路(ジョブ結果)・再生成EP・集計への算入／`doc/API設計/S_AIジョブ・LLM連携.md` に `task_type=idea_evaluate` を追記。
   - (d) `doc/画面設計/screens/SC-22`（AI評価ブロック）・`SC-25`（採点中表示）更新・遷移図確認。
   - (e) TC md 先行（F/S ドメイン）→ 実装（migration→backend ジョブ/保存/集計→frontend 表示/再生成）。
   - **保留論点（実装前に詰める・ドラフト§7-補）**＝SC-25採点中にAIブロックを折り畳むオプション要否／AI評価の再生成履歴を変更履歴標準で版管理するか／生成失敗のquest_admin通知要否／既存published アイデアへのバックフィル要否。
2. **④【討議】おすすめクエスト選出アルゴリズム**＝ユーザー案「参加可×経営資料整合率高×直近活発×管理者お勧めマーク、得点上位をパネル最大件数」への意見→合意後に実装（残るもう1つの討議案件）。
3. **#13 アイデア作成者向け 評価詳細（コメント＋得点）閲覧画面**＝評価ドメイン(F)・SC-22/SC-25 周辺。⑥と同ドメインで相乗り可。既存の可視範囲（visibility=party/limited・F.1集計）を裏取りしてスコープ確定。
4. **（フォロー・小）DataTable「表示件数」セレクタのカスタム `.combobox` 化**（`impl/frontend/src/components/ui/DataTable.tsx:1146` 付近・ユーザー決定で後回し・全一覧影響のため floatHead/横スクロール目視要）。
5. **（フォロー）`/info-curators` backend EP と N.5 テストの retire**（generic 能力EPへ移行済・`impl/backend/app/tenant/info/router.py`・削除前に `is_curator`/`list_curators` 以外の参照が無いか grep）。
6. **② AI処理状況のリアルタイム反映 E2E**（SC-04 ai-jobs・realtime L/WS・共有DB非冪等注意 memory `e2e-full-not-idempotent-shared-db`）。

### 前セッションからの持ち越し（未着手）
- Turnstile `size:flexible` 幅の実ブラウザ目視（`impl/.env` の `#TURNSTILE_*` を外して `/signup` 確認・確認後 dev既定へ戻す）。
- SC-01 設計書 §3〜9 を5ゾーン再設計に整合（`doc/画面設計/screens/SC-01_ダッシュボード.md`）。
- アイデアコンテスト Phase2（妥当性解析・自動表彰スケジューラ＝LLM/スケジューラ基盤前提・MVP外）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`）。
- 起動：`cd impl && docker compose up -d`。backend=`http://localhost:8000`・frontend=`http://localhost:3000`・openapi=`http://localhost:8000/openapi.json`・MailHog=`http://localhost:8025`。
- **workers（必ず `--build`）**：`cd impl && docker compose --profile workers up -d --build worker mail-worker`（LLM 実行を試すなら `--profile ai` + `llm-worker`）。確認後 `docker compose stop worker mail-worker llm-worker`。
- 反映（ソースベイク・volumes無）：`cd impl && docker compose up -d --build backend|frontend`。**ビルド完了を待ってから**（`RunningFor`「数秒前」＋`curl -sf http://localhost:3000/login`）検証。型再生成＝backend 再ビルド後 `cd impl/frontend && npm run codegen`。
- DB直接：`cd impl && docker compose exec -T db psql -U ideaquest -d ideaquest_control`（control）／`-d ideaquest_company_acme`（会社）。資格＝`ideaquest`/`ideaquest`。
- テスト：
  - frontend `cd impl/frontend && npm run build`（lint＋コンパイル必須ゲート）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。**未コミット/新規テスト反映は** `cd impl && docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- `.env`（`impl/.env`・gitignore 追跡外）現状＝dev 共有スタック既定（`IQ_DEFAULT_COMPANY_CODE=`空・`TURNSTILE_*` コメントアウト＝CAPTCHA無効）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`（MFA OFF）／管理 `ACME-01`/`kanri@acme.example`（company_account_admin）／OPS `admin@ops.example`（system_admin・会社`OPS`）／MFA `ACME-02`/`mfa@acme2.example`／DEMO `DEMO`/`admin@demo.example`（public＋self_signup）。
- dev 会社id（control DB companies）：ACME-01=`debba8dc-7f32-4705-abd8-61f2d77e23c1`／OPS=`d249a8ea-5109-4974-ad46-e0da36a546e6`／DEMO=`a5e28360-043a-4b61-b659-664ab0107f2f`。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`(Playwright chromium)を作り**使い終わったら削除**。**必ず新コンテナ起動後に実行**（§5）。
