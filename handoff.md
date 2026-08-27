# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-27**（セッション終了時・時刻は概算）。
- ブランチ: `main`（`origin/main` と同期・**作業ツリーはクリーン**）。
- 最新コミット: **`3ddb775`** `docs(deploy): 本番デプロイ要件 §6 を「決定」に確定（セキュリティ非妥協で採用）`。
- 本セッションの主コミット（新しい順）＝`3ddb775`（デプロイ §6 決定）／`5ee6f0d`（デプロイハードニング＝/docs 無効化＋seed prod ゲート・SEC-TC-045/046）／`40a24da`（通知一覧 N+1 回避＝prime_refs・H-TC-171）／`6e9b575`（i18n A-4 Accept-Language＋エラー title locale・A-TC-108/109）／`ca6ef44`（i18n A-3 マスタ名 locale・G-TC-309/507）／`f3ecc09`（i18n A-1 メール／A-2 通知 locale・A-TC-107・H-TC-170）。それ以前は `git log` 参照。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（TypeScript）、バック＝FastAPI 4層（会社別DB動的ルーティング）。開発は**1画面単位で backend 接続ループ**。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)・現況の正＝[`impl/README.md`](impl/README.md)。**全画面・全横断ドメインは接続済み**（`impl/README.md` 画面テーブルは全 ✅）＝本セッションも機能スライスではなく**横断品質（i18n 結線／性能／本番デプロイ準備）**が中心。

## 3. 今回やったこと（変更ファイルと理由）

### 3-A. Phase A＝backend locale 結線（i18n の実効化・§2.1）
> 仕様は JA/EN 必須だがコードは「en は将来」で保留されていた。**バックエンドの自己ローカライズ出力を全て locale 実効化**（frontend の全面 i18n は別＝§7 参照）。設計上の切り分け＝**メール/通知/マスタ名は entity-bound**（`accounts.locale`／`users.locale` が源泉）で Accept-Language は効かない。Accept-Language が効くのは entity 非依存の per-request 応答＝エラー応答のみ。
- **A-1 メール**＝`app/control_plane/mail_outbox/templates.py`。`render(category,secret,locale,params)` が受け取りながら無視していた `locale` を実効化＝全8カテゴリに EN 文面（`en = locale=="en"`・None/不明は ja フォールバック）。auth の既存 `locale=account.locale` 経路がこれで有効化。**A-TC-107**（unit）。
- **A-2 通知**＝`app/tenant/notifications/catalog.py`。`render(session,n,locale)` を追加し ja 固定を解消＝全11種別＋context/tag/tier/actor/spell を locale 連動。マスタ名は `name_en`（spell/achievement）で解決、**アイデア/クエスト題名は UGC のため非翻訳**。受信者 locale の源泉＝`users.locale`（§4.6 ミラー）＝GET は本人 `user.locale`／push（`service.py _created_data`）は受信者 `User.locale`（クロスプレーン照会不要）。**H-TC-170**（unit）。
- **A-3 マスタ名 API 応答**＝achievements `get_achievements`（name/description/condition_label）・shop `get_my_items`（装備 name）を受信者 `user.locale` で `name_en/name_ja` 選択。**両言語返し型**（`GET /items`・`GET /spells`＝name_ja+name_en 両方返す）は frontend 選択待ちで backend 変更不要＝対象外。単一 name 型のみ結線＝**frontend 変更なしで EN 即効**。**G-TC-309/507**（api）。
- **A-4 Accept-Language フォールバック＋エラー応答 locale**＝新規 `app/core/locale.py`（`normalize`／`parse_accept_language`〔q 値順・q=0 除外〕／`resolve_request_locale`＝**ユーザー設定→Accept-Language→既定 ja**）。`core/deps.py resolve_session` がセッションの `locale` を `request.state.user_locale` に載せる（最優先ソース・DBヒット無し）。`core/errors.py` は `_TITLES` を JA/EN に分離し request locale で選択＋汎用バリデーション detail も locale 連動。**`code` は不変**（機械可読の正・§1.7）＝個別 detail の JA 文言は §1.7「code が正・detail は当たり」に従い対象外。**A-TC-108/109**（unit/api）。

### 3-B. 通知一覧描画の per-row ref N+1 回避（性能・コミット `40a24da`）
- `catalog.render` が各通知の ref（idea/quest/achievement/spell）を per-row `session.get` で引く N+1（別軸監査の残・優先度低）を解消。
- `notifications/repository.py prime_refs`（新規）＝ページ分の ref を `IN` 一括ロードして identity map に載せ、後続 get を追加クエリ無しに（描画側 `catalog.render` の署名は不変＝DRY）。`application.get_notifications` の list 直後に結線。
- **落とし穴**＝identity map は**弱参照**。ロードした ORM を捨てると render 前に GC され get が再クエリ（実測で q7=12＝N+1 継続）。`session.info["_primed_refs"]` に強参照を残して解決。
- **H-TC-171**（int）＝distinct 実績参照の achievement 通知 K=2/7 で `get_notifications` 中の SELECT 数を計測し**行数非依存（q2==q7）**を担保。red-green＝prime 無効時 q2=7/q7=12→有効時 q2==q7。

### 3-C. 本番デプロイ準備（ハードニング＋§6 決定・コミット `5ee6f0d`/`3ddb775`）
- `doc/本番デプロイ要件.md` を点検。**コードで閉じられる 2 点を実装**（残りはインフラ/意思決定）＝
  - `app/main.py _docs_kwargs(app_env)`＝`APP_ENV=prod` で `/docs`・`/redoc`・`/openapi.json` を全無効（最小 CSP 下で Swagger は無意味＋スキーマ露出回避・要件§2）。**SEC-TC-045**。
  - `scripts/bootstrap.py _seed_demo_enabled(app_env)`＝`APP_ENV=prod` で demo 会社/アカウント（`_SEEDS`＝ACME 等・既定PW）を自動スキップ＝OPS テナント＋system_admin＋migration のみ（従来 `main()` の無条件 seed による本番デモ混入リスクを解消・要件§5）。**SEC-TC-046**。**注＝prod は `APP_ENV=prod` 必須**（未設定は dev 扱いで demo が入る）。
- **§6 意思決定を「決定」に確定**（セキュリティ非妥協）＝6.1 トポロジ `/api 直結ホップ1`→`TRUSTED_PROXY_COUNT=1`（Next rewrite の未検証 XFF 依存を排除）／6.2 メール＝マネージド送信を SMTP（STARTTLS 587＋秘匿供給＋SPF/DKIM/DMARC）／6.3 Redis＝HA（最低 AOF）＋TLS/認証/私設ネット／6.4 DB＝日次フル＋WAL の PITR・保存時暗号化・**PGroonga on マネージドPG の可否検証**を分岐条件に／6.5 監査ログ＝DB(追記専用)＋期限超過を WORM アーカイブ・叩き台 DB180日/アーカイブ1年。

### 3-D. frontend i18n＝優先度低で繰延（ユーザー方針）
- 現状＝next-intl 未導入・JA リテラルは 174 ファイル/約2570行・URL は Parallel/Intercept モーダルで複雑。既存 seam＝`lib/forms/validation.ts` の `t(locale,key)`（検証層のみ）。
- **ユーザー決定＝多言語対応は優先度低／やるなら一般的な方法（next-intl）で・当面全訳しない**（memory `frontend-i18n-low-priority` に保存）。着手指示が出るまで §7 の繰延項目として据え置き。backend の locale 結線（3-A）で**システム生成テキストは既に ja/en 対応済み**。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. backend（本セッションで実測）
- **`pytest tests/` 全体 490 passed**（0 失敗・ワーカ停止で複数回 green）。
- migration head＝control **0012**／company **0020**（本セッションでの migration 追加なし）。
### 4-2. frontend（本セッションで実測）
- **tsc＝完全クリーン**／**vitest＝5 files・28 passed**（node 環境）／**`npm run build`＝26ページ green**。本セッションで frontend コード変更なし（健全性確認のみ）。
- e2e（Playwright）は本セッション未実行（§7.5 バッチ受入方針）。
### 4-3. テスト運用
- **TC-ID トレーサビリティ ✅（code 408）**＝repo ルートで `python3 scripts/check_tc_traceability.py`。
- **注**＝走査は `impl/backend/tests/**` ＋ `impl/frontend/e2e/**` のみ・正規表現 `\b([A-Z])-TC-(\d{3})\b`。**`SEC-TC-` は3文字接頭辞で不一致＝検査対象外**（追跡は `doc/テスト/セキュリティ横断.md` の md 行で担保）。frontend `src/**/*.test.ts`（vitest 単体）も対象外。

## 5. 詰まっている点・注意（試した/失敗と理由）
- **通知 N+1 の identity-map 事前ロードは弱参照で GC される**（3-B）。バルクロード結果は必ず強参照（`session.info`）で保持しないと `session.get` が再クエリして N+1 が残る（実測で気付いた・回帰ガードは H-TC-171）。
- **pytest 時はワーカ停止が恒久ルール**＝`worker`/`mail-worker` 起動中は共有 control DB の outbox を real sender で drain し pytest と競合＝フラキー化（`impl/compose.yaml` 冒頭コメント）。手順は §8。
- **エラー応答の locale は Accept-Language ベース**＝ログイン済みは `request.state.user_locale`（セッション locale）優先。個別 `AppError(detail=…)` の JA 文言は意図的に未翻訳（§1.7 で code が正・frontend が code で多言語化する前提）。
- **PGroonga イメージ**＝`postgres:16`（Debian trixie）＋PGDG 版 `postgresql-16-pgdg-pgroonga`（`impl/db/Dockerfile`）。本番も同等の PGroonga 導入 PG16 が必須（§6.4 の分岐＝マネージドPG で拡張可否を要検証）。

## 6. 決定事項と根拠（不採用案も）
- **backend locale 結線の切り分け**（採用・3-A）＝メール/通知/マスタ名は entity-bound（stored locale が源泉）／Accept-Language は per-request のエラー応答にのみ適用。**不採用＝全出力に Accept-Language**（entity に紐づく出力では誤り）。
- **frontend i18n は next-intl（標準）・優先度低で繰延**（採用・ユーザー決定・3-D）。**不採用＝自作 `t()` を全画面へ手拡張**（標準でない・維持コスト）。
- **通知 N+1 は identity-map 事前ロード（署名不変）**（採用・3-B）＝`catalog.render` を変えず repository で prime。**不採用＝render に解決済みキャッシュを引数追加**（署名変更＝呼び出し側の広範改修）。
- **本番ハードニングはコードで自動強制**（採用・3-C）＝prod で /docs 無効・demo seed スキップ。**不採用＝運用手順書だけに委ねる**（設定漏れで露出/混入のリスク）。
- **デプロイ §6 はセキュリティ非妥協で確定**（採用・3-C）＝実IP確定 hop1・TLS 全経路・秘匿供給・追記専用監査・保存時暗号化。
- （継続）J 検索＝PGroonga／スニペット XSS＝許可リスト構造化セグメント／pytest はワーカ停止／テスト運用＝md 先行＋TC-ID＋red-green（`doc/テスト/red確認台帳.md`）／ブラウザ受入は後日バッチ（§7.5）。

## 7. 次にやること（優先順・具体的に）
> 全画面・全横断ドメインは接続済み。過去セッションの大規模パンチリスト（監査 HIGH／M1-M6／FR-08 3D 骨組み／別軸監査の性能・a11y）は**すべて完了**（詳細は `git log`）。以下は**実際に残っている作業**。

1. **本番デプロイの環境実装（コード外）**＝§6 の決定を環境へ反映＝`TRUSTED_PROXY_COUNT=1`＋エッジで実 IP 確定・`COOKIE_SECURE=true`・`SMTP_START_TLS=true`＋秘匿供給・Redis HA/AOF・DB PITR・監査 WORM アーカイブ。**唯一のコード外前提確認＝PGroonga on マネージドPG の可否**（不可なら自前 PGroonga 像＋WAL アーカイブ）。
2. **監査ログ保存期間のコンプラ確認**＝§6.5 の叩き台（DB180日/アーカイブ1年）を法務/社内規定で確定（別タスク起票）。決まれば掃除/移送ジョブを実装。
3. **frontend i18n（繰延・優先度低）**＝着手時は next-intl（標準）。`session.locale` は SSR で取得可・backend は locale 結線済みなので、frontend は provider＋カタログ＋画面訳の段階作業（1画面群ずつ）。memory `frontend-i18n-low-priority` 参照。
4. **3D アバター残（コード外）**＝実 VRM アセット（男女2体＋装備パーツ）の手配のみ。入れば `AvatarViewer3D.tsx` の TODO seam（`@pixiv/three-vrm` で `items.part_ref` をスロットへ）を差し替え。着せ替え backend/API/2D フォールバックは完了済み。
5. **J の将来拡張（任意）**＝グローバル `GET /search`＋ヘッダー導線／最小文字数・演算子(OR/フレーズ)／種別間スコア重み／`per_page` 最終値（J.6 TBD）。
- **共通ルール**＝着手前に `impl/README.md` の現況と該当正本を開き、非自明な新規スコープはユーザーへ確認。1スライス＝backend+frontend＋テスト（md 先行・red-green）→docs(handoff) の順でコミット、**push はユーザー承認後**。

## 7.5 ブラウザ受入待ち（バッチ・未消化）
- **運用**＝ブラウザ受入は後日まとめて（e2e green でクローズ扱い）。一覧は `impl/README.md`「ブラウザ受入状況」節。
- **J（全文検索）**＝SC-12「🔍 全文検索」タブで語→このクエスト内のアイデア/チャット/添付ファイル名がヒット・種別バッジ・ハイライト・件数/ページング・行クリックで SC-22/SC-24 遷移・types 絞り込み・下書き/削除は出ない。dev＝ACME-01 参加クエストに公開アイデア＋チャット＋添付を用意。
- **I/L**＝SC-01 実データ/投票/フォロー/login_bonus・ベル/SC-02/SC-24 の WS 即時反映。
- **i18n（任意確認）**＝`accounts.locale=en` のユーザーでメール/通知/実績名/装備名が英語・エラー応答が Accept-Language に追従することを実スタックで確認（現状は unit/api テストで担保）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。db は**カスタムビルド**（PGroonga 同梱・`impl/db/Dockerfile`）。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`（db ビルド含む＝初回数分）。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **再ビルド反映**＝db `... up -d --build db`／frontend `... up -d --build frontend`／backend `... up -d --build backend worker mail-worker`。**frontend 再ビルド後は Playwright を再 install**。
- **DB migration 適用（冪等・0018 pgroonga 含む）**＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`。
- **backend テスト（cwd=`impl` 厳守・ワーカ停止必須）**＝`cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose stop worker mail-worker` の後 `docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`（ワーカ起動中は outbox 競合でフラキー・§5）。終わったら `docker compose start worker mail-worker` で戻す。ドメイン別＝H `tests/notifications`／J `tests/search`／I `tests/dashboard`／L `tests/realtime`／横断 `tests/core`。
- **frontend tsc / vitest / build**＝`cd impl/frontend && npx tsc --noEmit`（クリーン）／`npx vitest run`（28/28・node）／`npm run build`（26ページ）。
- **TC-ID 検査**＝repo ルートで `python3 scripts/check_tc_traceability.py`（✅ code 408・SEC-TC は対象外）。
- **PGroonga 疎通**＝`docker compose exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d ideaquest_company_acme -tc "select name,default_version from pg_available_extensions where name=''pgroonga'';"'`（→ pgroonga 4.0.x）。
- **dev ログイン（PW 全て `Passw0rd!`）**＝一般 `ACME-01`/`user@acme.example`（MFA OFF）／`ACME-02`/`mfa@acme2.example`（MFA ON）／system_admin `OPS`/`admin@ops.example`。MailHog＝`http://localhost:8025`。
- **正本の在り処**＝規約/入口＝`CLAUDE.md`。現況＝`impl/README.md`。実装順＝`doc/実装計画.md`。API＝`doc/API設計/{A..L}_*.md`（横断規約 `doc/API設計/README.md`・§2.1 i18n＝`doc/規約/コーディング規約.md`）。データモデル＝`doc/データモデル.md`（§6 PGroonga）。テスト＝`doc/テスト/*.md`＋`red確認台帳.md`＋`セキュリティ横断.md`。本番＝`doc/本番デプロイ要件.md`。要件＝`doc/要件定義/README.md`（FR-xx）。
- **コミット規約**＝メッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`／PR body 末尾に 🤖 Generated with Claude Code 行／commit・push はユーザー承認後。
