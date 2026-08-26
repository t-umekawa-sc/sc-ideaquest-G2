# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が無い次回の自分」。会話ログは参照不可。本ファイルだけで再開できるよう全文を上書きする（履歴は git）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-26**（セッション終了時・時刻は概算）。
- ブランチ: `main`。**本セッションで 5 スライス実装**＝(A) 通知 H `security_*`（push 済み）／(B) リアルタイム L（push 済み）／(C) ダッシュボード I（push 済み）／(D) 全文検索 J（push 済み `8735b39`+`b6c01c5`）／(E) **SC-12 残 demo 接続＝評価列(F)＋クエスト内週間ランキング(G)（本 handoff コミット直前の作業ツリー・コミット可否はユーザー指示）**。
- E 実装＝アイデア一覧カードに評価集計（`IdeaCardDTO.evaluation`＝評価待ち/評価済 n/5・F 可視のみ）追加＋SC-12 ランキングを `GET /rankings?scope=quest:{id}` で実接続（ユーザー指示「接続して」2026-08-26）。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router、バック＝FastAPI 4層。開発は**1画面単位で backend 接続ループ**。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)。**現況の正＝[`impl/README.md`](impl/README.md)**。

## 3. 今回やったこと（4スライス・A/B/C は git log 参照）
- **A 通知 H security_***（push 済み）＝new_device/password_changed を in-app＋メール＋監査。
- **B リアルタイム L**（push 済み）＝WS 配信ハブ `GET /api/v1/realtime`・H/E/C から発行。
- **C ダッシュボード I**（push 済み `c3cb524`）＝`GET /dashboard` 読取合成の殻・SC-01 全パネル実接続・login_bonus。

### 3-E. SC-12 残 demo 接続＝評価列(F)＋週間ランキング(G)（本セッション末）
- **backend**＝`IdeaCardDTO` に `evaluation`（`{state, overall_avg, evaluator_count}`）追加。`evaluations.application.eval_states_for_ideas(ts, quest, user, ideas)`＝submitted 評価を batch（`repo.list_submitted_evaluations_for_ideas`）→ アイデアごとに可視評価（`_can_view_evaluation`・F.1）で `overall_avg`（n/5・`_aggregate` 再利用）を算定。state＝submitted が1件でもあれば done。`ideas.get_ideas` が batch し `_idea_card` へ渡す（evaluations.application を遅延 import・循環回避）。
- **frontend**＝`QuestDetailView` の評価列を `card.evaluation` にマップ（評価済 n/5・可視0は「評価済」・未評価は「評価待ち」）。クエスト内週間ランキングを `getRankings("this_week", {scope:"quest:{id}", limit:3})` で実接続（デモ RANKING 撤去）。codegen 再生成で `IdeaCardDTO.evaluation` 型反映。
- **コメント数(E)も接続**＝`IdeaCardDTO.comment_count` を E 非削除チャット件数に（`chat_repo.count_active_messages_for_ideas` の batch・`get_ideas` で合成・トゥームストーン除外）。フロントは既に表示（変更不要）。テスト＝D-TC-151（`tests/ideas/test_api.py`・red-green＝batch stub）。
- **テスト**＝`doc/テスト/D_アイデア.md` D-TC-150/151＋`tests/evaluations/test_api.py::test_d_tc_150_ideas_list_eval_aggregate`。red-green＝`eval_states_for_ideas`/`count_active_messages_for_ideas` に stub 差込で red→撤去で green（台帳 D/SC-12 節）。ランキング(G) は既存テストで担保。

### 3-D. 全文検索 J（SC-12）
- **PGroonga カスタム DB イメージ**＝`impl/db/Dockerfile`（`FROM postgres:16`〔現 trixie〕＋`postgresql-16-pgdg-pgroonga`＝PGDG 版の正しいパッケージ名。`-pgroonga` 単体は PGDG では候補なし）。`compose.yaml` の db を `build: ./db`（image `ideaquest-db-pgroonga:16`）へ。**既存 db_data ボリューム（trixie/glibc2.41）と一致＝collation 警告なし・データ保持**。
- **会社DB migration `0018_company_pgroonga_fts`**＝`CREATE EXTENSION IF NOT EXISTS pgroonga`＋索引3本（ideas 連結式・chat_messages.body・attachments.original_name・§6）。bootstrap で全会社DBへ適用済み。
- **新ドメイン `app/tenant/search/`**＝
  - `repository.py`＝ideas/chat/attachments の raw SQL（`&@~`＝クエリAND・`pgroonga_score(tableoid,ctid)`・`array_to_string(pgroonga_snippet_html(text, pgroonga_query_extract_keywords(:q)),' … ')`）。**可視範囲は WHERE で強制**（published・非削除・`is_deleted=false`・下書き除外）。`q` はバインド変数（§2.2③）。`quest_ids` は expanding IN。種別ごと cap=200。
  - `application.py` `search_quest`＝門番（パーティー `get_active_member` ∩ グループ `qg_repo.get_active_membership` の AND・欠ければ 404 存在秘匿）→ 3種を合成し score 降順（タイブレーク created_at/uploaded_at）→ オフセットページング（page/per_page・total）。types CSV 検証（不正 422）・空 q は 422。
  - `router.py`＝`GET /api/v1/quests/{quest_id}/search`（`Depends(require_me)`・q 必須・types/page/per_page）。dict 返却（response_model なし）。
- **frontend**＝`features/search/api.ts`（`searchQuest`＋型）。`QuestDetailView` の「🔍 全文検索」タブをデモ `SEARCHABLE` から実接続（デバウンス300ms・types 絞り込み・ページング prev/next・種別バッジ・行クリックで idea→`/ideas/{id}`・chat/添付→`/ideas/{id}/chat`）。**スニペットは許可リストサニタイズ**＝`renderSnippet`（`<span class="keyword">` を `<mark>` に、ユーザー文はエンティティデコードして text 描画・`dangerouslySetInnerHTML` 不使用・§2.2④）。
- **テスト**＝`doc/テスト/J_全文検索.md`（J-TC-101〜131）＋`tests/search/test_api.py`（8件）＝PGroonga 実ヒット（idea/chat/attachment）・門番404・下書き/削除/トゥームストーン除外・types・ページング total・空/422・401・スニペット（ハイライト＋`<script>` エスケープ）。red-green＝`search.repository.search` に `return []` 一時差込で 4件 red→撤去で green（`red確認台帳.md` に J 節）。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. backend（pytest）
- **`pytest tests/`（全体）＝452 passed＋既存フラキー（A-TC-038/095/096＝mail 系順序依存・全体実行で稀に1件落ち・単独 green）**（J 8＋SC-12 評価集計 D-TC-150＋コメント数 D-TC-151）。cwd=`impl` 厳守。
- migration＝control head **0012**／company head **0018**（pgroonga）。**db/backend/frontend/worker は本セッションで再ビルド済み**。`GET /quests/{id}/search` 未認証 401 を実アプリで確認。
### 4-2. frontend（tsc・e2e）
- **tsc＝既知1件のみ**（`Snackbar.tsx:122`）。J のフロント変更はクリーン。
- **e2e＝SC-12 全文検索のブラウザ確認はバッチへ**（§7.5）。backend 契約は J 8 件で担保。
### 4-3. テスト運用
- **TC-ID トレーサビリティ ✅（code 382）**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。

## 5. 詰まっている点（試した/注意）
- **PGroonga パッケージ名**＝公式 postgres イメージ（PGDG）では **`postgresql-16-pgdg-pgroonga`**（`postgresql-16-pgroonga` は Debian 標準 PG 用で PGDG では候補なし）。`postgres:16` は現在 **Debian trixie**（bookworm ではない）。既存ボリュームも trixie で作られていたため trixie 継続が collation 一致（bookworm に落とすと glibc 2.36<2.41 で collation 警告）。
- **db イメージは build 参照**＝`docker compose ... up -d --build db`。`docker compose run backend ...`（pytest）は db 依存を自動起動。**新しく clone した環境では db のビルドが必要**（数分）。
- **可視範囲は索引でなくクエリ WHERE**＝pgroonga 索引は全行に張るが、下書き/他パーティー/削除は WHERE で除外（J.0・漏洩防止）。門番はパーティー∩グループの AND。
- **スニペット XSS**＝`pgroonga_snippet_html` は user 文をエスケープし `<span class="keyword">` のみ生注入。フロントは許可リストで `<mark>`＋text 化（生 `dangerouslySetInnerHTML` 禁止・§2.2④）。
- **検索 dict 返却（response_model なし）**＝FE は `features/search/api.ts` で手動型付け。バック DTO 変更時は api.ts 追随。
- **login の副作用（security_new_device）**＝auth を跨ぐテストの seed 後は purge（既存の各テストに踏襲済み）。
- **既存フラキー**＝`tests/mail_outbox`/A-TC-038/095 系は全体実行の順序依存で稀に落ちる（mail 系・単独 green・本セッションと無関係）。
- **共有 control DB 汚染（継続）**＝`t-umekawa`（非 OPS system_admin）。現状無害。

## 6. 決定事項と根拠
- **J エンジン＝PGroonga（設計準拠）**（ユーザー選択 2026-08-26）＝日本語の分かち書き不要・DB 内で score/snippet 完結（§6）。カスタム DB イメージ（`impl/db/Dockerfile`）＋会社DB migration で導入。本番も同等が必須（`本番デプロイ要件.md` に明記）。
- **スコープ＝SC-12 タブ end-to-end**（グローバル `GET /search` は予約・設計も将来）。
- **設計 J.6 の実装既定**＝複数語 AND（`&@~`）・オフセットページング（total・J.4）・種別間スコアは素の pgroonga_score・タイブレーク created_at/uploaded_at 降順・per_page 既定20/上限100。`field` は種別代表（idea/chat=body・attachment=original_name・MVP）。
- **可視範囲はクエリ WHERE で強制／門番＝パーティー∩グループ AND**（J.0）。**下書きは本人分も FTS 対象外**（共有前 WIP）。
- （継続）テスト運用＝md 先行＋TC-ID＋red確認台帳。ブラウザ受入は後日バッチ（§7.5）。

## 7. 次にやること（優先順・具体的に）
- **横断ドメインは H/L/I/J 完了**（通知・リアルタイム・ダッシュボード・全文検索）。残りは `doc/実装計画.md`「その他」＋`impl/README.md` の 🟡/未接続を棚卸し。候補＝
  1. **SC-12 の残 demo＝完了**（評価列 F・クエスト内週間ランキング G 接続済み）。
  2. **コメント数(E)＝完了**（`IdeaCardDTO.comment_count` を E 非削除チャット件数に接続・D-TC-151）。残＝`impl/README.md` 画面テーブルは全 ✅・細部の follow-up（SC-25 intercept モーダル化・締切事前 disable）と UI ポリッシュのみ。全画面・全横断ドメインが実接続済みなので、次は要件(FR)網羅の点検 or 本番デプロイ準備（`doc/本番デプロイ要件.md`）が候補。
  3. **アップロード/画像まわり**の未接続があれば（実装計画で後回し禁止の項目）。
- 着手前に `impl/README.md` の現況と正本を開き、**未着手はユーザーへスコープ確認**。
- **J の follow-up（任意・将来）**＝グローバル `GET /search`＋ヘッダー導線／検索語の最小文字数・演算子（OR/フレーズ）・正規化／種別間スコア重み／`per_page` 最終値／高精度化（Meilisearch/OpenSearch＋kuromoji・§6）（J.6 残 TBD）。

## 7.5 ブラウザ受入待ち（バッチ）
- **運用（ユーザー確認 2026-08-25）**＝ブラウザ受入は後日まとめて（e2e green でクローズ扱い）。一覧は `impl/README.md`「ブラウザ受入状況」節。
- **J 追加分**＝SC-12「🔍 全文検索」タブで語を入れると（このクエスト内の）アイデア/チャット/添付ファイル名がヒット・種別バッジ・ハイライトスニペット・件数/ページング・行クリックで SC-22/SC-24 へ遷移・対象（types）絞り込み・下書き/削除は出ない。dev＝ACME-01 の参加クエストに公開アイデア＋チャット＋添付を用意。
- **I/L 追加分**（前スライス・未消化）＝SC-01 実データ/投票/フォロー/login_bonus・ベル/SC-02/SC-24 の WS 即時反映。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: `/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。db は**カスタムビルド**（PGroonga）。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`（**db のビルドを含む＝初回は数分**）。ポート＝frontend :3000／backend :8000／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **反映**＝db `... up -d --build db`（PGroonga イメージ変更時）／frontend `... up -d --build frontend`／backend `... up -d --build backend worker mail-worker`。
- **会社/管理DB migration 適用**＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`（冪等・0018 pgroonga 含む）。
- **backend テスト**（cwd=`impl` 厳守）＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`。J＝`tests/search`・I＝`tests/dashboard`・L＝`tests/realtime`。
- **PGroonga 疎通確認**＝`docker compose exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d ideaquest_company_acme -tc "select name,default_version from pg_available_extensions where name=''pgroonga'';"'`（→ pgroonga 4.0.x）。
- **frontend tsc**＝`cd impl/frontend && npx tsc --noEmit`（既知1件＝Snackbar.tsx:122）。
- **TC-ID 検査**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。
- **dev ログイン（PW 全て `Passw0rd!`）**＝一般 `ACME-01`/`user@acme.example`（MFA OFF）／`ACME-02`/`mfa@acme2.example`（MFA ON）／system_admin `OPS`/`admin@ops.example`。MailHog＝`http://localhost:8025`。
- 規約/正本＝`CLAUDE.md`。現況の正＝`impl/README.md`。API＝`doc/API設計/{A..L}_*.md`（J＝`J_全文検索.md`）。データモデル＝`doc/データモデル.md`（§6 PGroonga）。テスト＝`doc/テスト/*.md`（`J_全文検索.md`）＋`red確認台帳.md`。本番＝`doc/本番デプロイ要件.md`（PGroonga カスタムイメージ）。
