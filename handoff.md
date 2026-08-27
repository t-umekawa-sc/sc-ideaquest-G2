# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。コードの塊は貼らず**ファイルパス＋関数名**で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-27**（セッション終了時・時刻は概算）。
- **作業ブランチ＝`feature/game-feel`**（`origin/feature/game-feel` と同期・**作業ツリーはクリーン**）。**`main` ではない**ので注意。
- 最新コミット（`feature/game-feel`）: **`2738257`** `feat(game-feel): クイック投票の押下バースト＋受入状態更新（増分#5）`。
- **`main` は `65153d5`**（前セッションまでの完了分＝Phase A i18n 結線／通知 N+1／本番デプロイ ハードニング＋§6 決定）。**game-feel の #1〜#5 はまだ `main` に未マージ**＝`feature/game-feel` が main より 4 コミット先行（`7418961`→`461f278`→`b25aae2`→`2738257`）。
- game-feel の運用＝**非同期パイプライン**（記憶 `game-feel-async-pipeline`）＝私は `feature/game-feel` へ**増分ごとに commit+push を自走**（このブランチのみ standing 承認）／`main` は従来どおりユーザー承認後にまとめてマージ。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（TypeScript）、バック＝FastAPI 4層（会社別DB動的ルーティング）。全画面・全横断ドメインは接続済み（`impl/README.md` 画面テーブルは全 ✅）。**現在は「ゲーム感（juiciness）向上」フェーズ**＝このシステムの特色を強化中。

## 3. 今回やったこと（変更ファイルと理由）
> 本セッション＝(A) 前半で `main` に完了投入した横断品質群、(B) 後半で `feature/game-feel` を切って開始した**ゲーム感フェーズ**。(A) は §1 の `main=65153d5` に含まれる。

### 3-A. main に投入済み（前半・すべて 65153d5 までに merge 済み）
- **Phase A＝backend locale 結線**（§2.1 i18n の実効化）＝メール `impl/backend/app/control_plane/mail_outbox/templates.py`（`render` の locale 実効化）／通知 `impl/backend/app/tenant/notifications/catalog.py`（`render(session,n,locale)`）／マスタ名 `achievements/application.py`・`shop/application.py`（受信者 `user.locale` で `name_en/name_ja`）／Accept-Language `impl/backend/app/core/locale.py`＋`core/deps.py resolve_session`＋`core/errors.py`（エラー title/汎用 detail の locale・code は不変）。
- **通知一覧 N+1 回避**＝`impl/backend/app/tenant/notifications/repository.py:prime_refs`（identity map を強参照で事前ロード）を `application.get_notifications` に結線。
- **本番デプロイ ハードニング**＝`impl/backend/app/main.py:_docs_kwargs`（prod で /docs 等無効）／`impl/backend/scripts/bootstrap.py:_seed_demo_enabled`（prod は demo seed スキップ）。`doc/本番デプロイ要件.md` §6 を「決定」に確定。

### 3-B. ゲーム感フェーズ（feature/game-feel・#1〜#5・純加算的な視覚のみ＝backend/挙動は不変・全て reduce-motion 尊重）
- **#1 数値の演出（`7418961`）**＝新規 `impl/frontend/src/components/ui/CountUp.tsx`（純関数 `countUpFrame(from,to,t)` を export＝easeOutCubic 補間・reduce-motion で即時）を `impl/frontend/src/features/dashboard/components/DashboardView.tsx` のヒーロー **コイン/SP** に適用。XP バーは `barFilled` state＋`design-system.css .xp-bar>span` の transition で 0%→現在% 充填。
- **#2 レベルアップ祝福（`7418961`）**＝純ロジック `impl/frontend/src/features/dashboard/levelup.ts`（`shouldCelebrateLevelUp`/`nextStoredLevel`/`parseSeenLevel`）＋`components/LevelUpWatcher.tsx`（前回観測レベルを `localStorage["iq:lastSeenLevel:"+accountId]` で比較→中央オーバーレイ・~2.6s 自動消滅）。`DashboardView` に `accountId` prop 追加、`app/(app)/page.tsx` から `session.account_id` を渡す。CSS＝`dashboard.css .levelup-*`。
- **#3 登場アニメ（`461f278`）**＝`dashboard.css @keyframes dash-enter`＝パネル/カードがロード時に下からフェードイン（リスト内 nth-child スタッガ）。純CSS。
- **#4 XP バーのシャイン（`b25aae2`）**＝`design-system.css .xp-bar>span::after`＝既存 `@keyframes iq-shine` を再利用し充填部を光が走る（overflow:hidden で充填幅内）。
- **#5 クイック投票の押下バースト（`2738257`）**＝新規 `impl/frontend/src/features/dashboard/components/SparkBurst.tsx`＋`DashboardView` の `bursts` state/`fireBurst`（クリック座標に固定オーバーレイで✦を6方向へ・~0.6s・楽観削除でカードが消えても見える）。CSS＝`dashboard.css .spark-burst`/`@keyframes spark-fly`。ボタン `onClick={(e)=>quickVote(v,type,e)}`。
- **受入台帳＝`doc/テスト/ゲーム感受入.md`**（一意ID `GF-AC-NNN`・ブラウザ受入用）。**GF-AC-001/002 はユーザー確認済み＝✅ OK**、残り 13 項は**未確認**。

## 4. 現在の状態（動く / 壊れ / テスト）
- **backend**＝本セッションで game-feel の backend 変更なし。`main` の最終 full pytest＝**490 passed**（前半で実測）。migration head＝control 0012／company 0020。
- **frontend（本セッションで実測）**＝`npx tsc --noEmit` **クリーン**／`npx vitest run` **41 passed**（7 files・node 環境。game-feel で `CountUp.test.ts`＝I-TC-150、`levelup.test.ts`＝I-TC-151 を追加）／`npm run build` **green（EXIT=0・26ページ）**。
- **TC-ID トレーサビリティ ✅（code 408）**＝repo ルートで `python3 scripts/check_tc_traceability.py`。**注**＝`GF-AC-` と `src/**/*.test.ts`（vitest 単体）は走査対象外（`impl/backend/tests/**`＋`impl/frontend/e2e/**` のみ・正規表現 `\b([A-Z])-TC-(\d{3})\b`）。frontend 単体の追跡は md（I-TC-150/151）で担保。
- **壊れているもの＝無し**（既知の transient は §5）。

## 5. 詰まっている点（試した/失敗と理由）
- **`next build` の transient 失敗**＝`Collecting page data` フェーズで稀に `Failed to collect page data for /admin/accounts/[accountId]/edit` や `PageNotFoundError: /_document`（ENOENT）が出る。**game-feel の CSS/コードとは無関係**（変更を含まない状態でも発生・App Router の並列収集の既知の脆さ）＝**再実行で EXIT=0**。build 判定は「1回落ちたら再実行」で運用。
- **識別できた地雷（前半・回帰防止で記録）**＝(1) 通知 N+1 の identity-map 事前ロードは**弱参照で GC される**ため `session.info` に強参照必須（`prime_refs`）。(2) pytest 時は `worker`/`mail-worker` を**必ず停止**（共有 control DB の outbox を real sender で drain して競合＝フラキー）。
- **一次QAスクショ（Playwright headless）は未着手**＝動作中スタックが要るため未実装。現状のゲートは tsc/vitest/build。次セッションで harness 化する（§7）。

## 6. 決定事項と根拠（不採用案も）
- **ゲーム感は非同期パイプラインで先行実装**（採用・記憶 `game-feel-async-pipeline`）＝ユーザー検証が遅く私の実装が速い前提で、検証待ちで止めない。**不採用＝1増分ごとに同期承認**（私が遊ぶ・遅い）。commit/push は `feature/game-feel` に standing 承認・`main` は承認後マージ。
- **各増分は純加算的な視覚レイヤ＋reduce-motion 尊重＋テスト規約**（採用）＝純ロジック（`countUpFrame`/`shouldCelebrateLevelUp`）は必ず抽出して md 先行＋vitest red-green（I-TC-150/151）。視覚は `doc/テスト/ゲーム感受入.md` の GF-AC でブラウザ受入。**視覚のみの増分（#3/#4/#5）は純ロジックが無いので vitest 無し＝正直に GF-AC のみ**。
- **レベルアップ検出は localStorage（account 別キー）で前回観測比較**（採用・`features/dashboard/levelup.ts`）＝初回観測は祝福しない（誤発火防止）。**不採用＝サーバーが leveled_up フラグを返す**（現状レスポンスに無い・backend 変更が要る＝#8 と同じ設計判断なので後回し）。
- （前半・継続）backend locale 切り分け＝メール/通知/マスタ名は entity-bound・Accept-Language はエラー応答のみ／frontend 全面 i18n は優先度低で繰延（記憶 `frontend-i18n-low-priority`・next-intl 標準）／本番デプロイ §6 はセキュリティ非妥協で確定。

## 7. 次にやること（優先順・具体的に）
> `feature/game-feel` で継続。着手前に `doc/テスト/ゲーム感受入.md` の未確認/指摘を確認し、GF-AC に追記しながら進める。各増分＝純ロジックは red-green・視覚は GF-AC・push は `feature/game-feel` へ自走。

1. **#6 実績アンロック祝福**＝#2 の実績版。新規 `impl/frontend/src/features/achievements/celebrate.ts`（純関数 `shouldCelebrateUnlock(prevSeenCodes:string[], currentUnlockedCodes:string[]):string[]`＝新規解放 code 群を返す）＋`components/AchievementCelebration.tsx`（`features/dashboard/components/LevelUpWatcher.tsx` を雛形に・`localStorage["iq:seenAch:"+accountId]` で差分検出）。`features/achievements/components/AchievementsView.tsx` に結線。テスト＝`doc/テスト/G_ゲーミフィケーション.md` に G-TC を先行追記＋vitest red-green。
2. **#7 ヘッダーの微演出（全画面で効く）**＝`impl/frontend/src/features/notifications` の `LiveAppHeader`／ベル要素に「未読>0 でベルが軽く振れる」CSS、ヘッダーのコイン表示に変化時の pulse。純CSS＋データ属性駆動（未読数は既存 state）。純ロジック無し＝GF-AC のみ。
3. **#8 獲得フィードバック「+50 XP」フローティング**＝**設計判断あり（要注意）**。投稿/投票/評価/購入の**レスポンスに XP/コイン差分が載っていない**（`features/ideas/api.ts` の vote 応答等）。潰すには (a) backend 応答に delta を足す（`ideas/application.py` 等・spec 追記）か (b) フロントで before/after 残高差分から算出。**着手前にユーザーへ設計確認**（backend 変更＝main 側の話になる）。
4. **一次QA harness**＝Playwright headless でダッシュボードのスクショを撮り私が目視する仕組み。既存 e2e（`impl/frontend/e2e/*.spec.ts`）を雛形に。動作スタック（`--profile workers up` ＋ host `npm run dev`）前提。
5. **`feature/game-feel` → `main` マージ**＝ユーザーが GF-AC を一通り受入（✅ OK）したらバッチで main へ。マージ時に handoff/`impl/README.md` を追随更新。

- **共通ルール**＝非自明な新規スコープ（特に #8 の backend 変更）はユーザー確認。テストは md 先行・red-green（`doc/テスト/red確認台帳.md`）。`main` への push はユーザー承認後。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。**まず `git branch` で `feature/game-feel` に居るか確認**（居なければ `git checkout feature/game-feel`）。compose＝`impl/compose.yaml`。db はカスタムビルド（PGroonga 同梱・`impl/db/Dockerfile`）。
- **ゲーム感の検証（並行ワークフロー）**＝backend 一式は compose（`docker compose -f impl/compose.yaml up -d`）、**フロントはホストで `cd impl/frontend && npm run dev`**（hot-reload・`/api` は既定で `localhost:8000` へプロキシ）。ブラウザ `http://localhost:3000` → `ACME-01`/`user@acme.example`/`Passw0rd!` → ダッシュボードで GF-AC を確認。※compose の frontend は src バインドマウントが無くホスト編集が反映されないため、開発検証は host `npm run dev` を使う。
- **フルスタック起動（e2e 等）**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`（db ビルド含む＝初回数分）。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。
- **frontend tsc / vitest / build**＝`cd impl/frontend` で `npx tsc --noEmit`（クリーン）／`npx vitest run`（41/41・node）／`npm run build`（26ページ・**transient で落ちたら再実行**＝§5）。
- **backend テスト（cwd=`impl` 厳守・ワーカ停止必須）**＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose stop worker mail-worker` の後 `docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`（490 passed）。終わったら `docker compose start worker mail-worker`。
- **DB migration 適用（冪等）**＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`。
- **TC-ID 検査**＝repo ルートで `python3 scripts/check_tc_traceability.py`（✅ code 408・GF-AC/src 単体は対象外）。
- **正本の在り処**＝規約/入口＝`CLAUDE.md`。現況＝`impl/README.md`。ゲーム感受入＝`doc/テスト/ゲーム感受入.md`（GF-AC）。テスト＝`doc/テスト/*.md`（frontend 単体の TC も domain md に記す＝例 I-TC-150/151）＋`red確認台帳.md`＋`セキュリティ横断.md`。本番＝`doc/本番デプロイ要件.md`。API＝`doc/API設計/{A..L}_*.md`。データモデル＝`doc/データモデル.md`。
- **コミット規約**＝メッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`／PR body 末尾に 🤖 Generated with Claude Code 行／`feature/game-feel` への push は自走可・`main` への push はユーザー承認後。
