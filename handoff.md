# handoff — ideaquest 開発引き継ぎ

> 読者＝「このセッションの記憶が一切ない次回の自分」。会話ログは参照不可。**本ファイルだけで再開できるよう毎回全文を上書き**する（履歴は git）。実際に確認した事実だけを書き、未確認は「未確認」と明記する。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-08-27**（セッション終了時・時刻は概算）。
- ブランチ: `main`（`origin/main` と同期・**作業ツリーはクリーン＝未コミット無し**）。
- 最新コミット: **`72271ac`** `test(J/SC-12): スニペット許可リストサニタイズを純関数化＋vitest 単体（SEC-TC-013）`。
- 本セッションの主コミット（新しい順）＝`72271ac`（snippet サニタイズ単体）／`083ec42`+`f5414eb`（セキュリティ監査補完＝応答ヘッダ§10＋マジックバイト§8＋テスト群）／`4c0272e`+`ca8cbd7`（XP 結線漏れ修正 投稿+50/投票+5）／`fadc42a`+`1f822a2`（フラキー根治＝ワーカ停止ルール）。それ以前（H/L/I/J/SC-12 の機能スライス）は `git log` 参照。

## 2. ゴール
社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（TypeScript）、バック＝FastAPI 4層（会社別DB動的ルーティング）。開発は**1画面単位で backend 接続ループ**。実装順の正本＝[`doc/実装計画.md`](doc/実装計画.md)・現況の正＝[`impl/README.md`](impl/README.md)。

## 3. 今回やったこと（変更ファイルと理由）
> 本セッションは「機能スライス」ではなく**監査 → 発見した実バグ/テスト漏れの解消**が中心。全画面・全横断ドメイン（通知H/リアルタイムL/ダッシュボードI/全文検索J/SC-12）は前セッションまでに実接続済み（`impl/README.md` 画面テーブルは全 ✅）。

### 3-A. 監査（FR網羅・仕様有×実装無・セキュリティテスト漏れ）
- ユーザー依頼で横断監査を実施。判明した3点＝(1) **XP 結線が no-op の実バグ**（3-B で修正）、(2) **セキュリティ横断のテスト/実装漏れ**（3-C で補完）、(3) **3D アバター（FR-08）は仕様有るが未実装＝テストパターンも無し**（未着手・7章の候補）。

### 3-B. XP 結線漏れ修正（実バグ・コミット `4c0272e`）
- 監査で「アイデア投稿 XP+50／投票 XP+5」が **no-op** だったと判明（台帳へ grant していなかった）。
- `impl/backend/app/tenant/ideas/application.py`＝`_publish_processing`（idea_post を冪等 grant）・`_award_vote_xp`（各アイデア初回投票のみ＋日次上限5/日・§8-⑥）を G 台帳（`ledger.grant`）へ結線。
- テスト＝`tests/ideas/test_api.py` の D-TC-160/161/162（`doc/テスト/D_アイデア.md`）。
- **注（テストの落とし穴）**＝seed 会社 ACME-01 の `activities` は cross-run で残るため、**投票 XP の日次上限に依存するテストは fresh factory ユーザーを使う**（seed ユーザーは daily count が汚れている）。

### 3-C. セキュリティ監査補完（コミット `083ec42`/`f5414eb`）
- **実装追加**＝(1) 応答セキュリティヘッダ middleware＝`impl/backend/app/main.py`（`X-Content-Type-Options: nosniff`・`X-Frame-Options: DENY`・`Referrer-Policy: no-referrer`・`CSP default-src 'none'; frame-ancestors 'none'`・HSTS は `cookie_secure=true` 時のみ・§10）。(2) アップロードのマジックバイト検証＝`impl/backend/app/infra/storage.py`（`_MAGIC` 表＋`_signature_ok(mime,data)`。`validate_image_upload`/`validate_attachment_upload` が **`data: bytes` を受ける様に signature 変更＝全呼び出し側6箇所を追随**）。
- **テスト補完**＝`doc/テスト/セキュリティ横断.md`（SEC-TC-001〜040）＋`doc/テスト/J_全文検索.md` J-TC-141。応答ヘッダ／マジックバイト（画像・添付）／画像サイズ上限／cross-tenant（会社別DB＝他社IDは404）／機密ログ非出力／Mass Assignment（`extra=forbid`）／検索インジェクション。
- **注（マジックバイトの副作用）**＝アップロード系テストは**有効な先頭バイトが必須**になった＝PNG `\x89PNG`・JPEG `\xff\xd8\xff`・PDF `%PDF-`・office/zip `PK`／`text/*` は署名なしで許可。既存テストで PNG バイトを `image/jpeg` 宣言していた箇所・`b"%PDF"`（短すぎ）等を実バイトに修正済み。

### 3-D. フラキーテスト根治（コミット `fadc42a`/`1f822a2`）
- 「稀に落ちる」とされた A-TC-038/040/068/070/095/096・B-TC-001/005 の真因は**環境汚染**＝pytest 実行中に `worker`/`mail-worker` が起動したままだと、両ワーカが共有 control DB の `mail_outbox`/`account_sync_outbox` を real sender で drain し、pytest のプロセス内 drain と競合する（`impl/compose.yaml` 冒頭コメントの警告事象）。
- **恒久ルール＝pytest 時は必ずワーカ停止**（`docker compose stop worker mail-worker`／pytest は `up -d db redis` だけで回す）。ワーカ停止で 8/8 green 実測。
- 併せて防御的隔離を投入＝`impl/backend/tests/conftest.py` の `_clean_account_sync_outbox`（outbox の autouse truncate）・`_reset_settings_cache`（`get_settings.cache_clear`）・mail 系テストの自スコープ化。

### 3-E. フロント許可リストサニタイズの単体テスト（監査残の解消・最新コミット `72271ac`）
- スニペットのサニタイズを `QuestDetailView` のインライン `_ENT`/`_decode`/`renderSnippet` から純関数へ抽出＝**新規 `impl/frontend/src/features/search/snippet.ts`**（`parseSnippet(html) -> {text,hit}[]` ＋ `decodeEntities`。設計 J.5 の「構造化セグメント」オプション）。`QuestDetailView.renderSnippet` は `parseSnippet` を map して hit→`<mark className="keyword">`・text→`<span>`（`dangerouslySetInnerHTML` 不使用は不変・§2.2④）。
- 単体テスト＝**新規 `impl/frontend/src/features/search/snippet.test.ts`**（vitest・6件）＝keyword span のみ hit・`&lt;script&gt;` 等はデコードしてテキスト化（生タグを残さない）・不正 class span は hit にしない・空入力・`decodeEntities` 既知エンティティのみ。**red-green＝`decodeEntities` 呼びを剥がして 2件 red→戻して green を実測**。`doc/テスト/セキュリティ横断.md` に SEC-TC-013 追加。
- **ドライブバイ修正**＝`impl/frontend/src/components/ui/Snackbar.tsx:122` の React19 `useRef` 型エラー（初期引数必須）を `useRef<...|undefined>(undefined)` に修正 → **`tsc --noEmit` 完全クリーン**。

## 4. 現在の状態（動く / 壊れ / テスト）
### 4-1. frontend（本セッションで実測）
- **tsc＝完全クリーン**（`cd impl/frontend && npx tsc --noEmit` を本セッションで実行・エラー0）。
- **vitest 単体＝15/15**（`companies/api.test.ts` 9＋`search/snippet.test.ts` 6・`cd impl/frontend && npx vitest run` を本セッションで実行）。**環境は node（DOM 非依存の純ロジックのみ）**＝jsdom 未導入。
- e2e（Playwright）は本セッションでは未実行（§7.5 バッチ受入方針）。
### 4-2. backend（本セッションで full pytest を再実測）
- **`pytest tests/` 全体 464 passed**（本セッションで 2 回実測＝健全性確認時／avatar_base migration 追加後。いずれもワーカ停止で green）。
- 動作確認済み＝`GET /quests/{id}/search` 未認証 401 を実アプリで確認（前スライス）。
- migration head＝control **0012**／company **0020**（`0019_company_avatar_base`＝users.avatar_base／`0020_company_balance_guards`＝残高 CHECK(>=0)＋activities 部分ユニーク〔M6〕。いずれも bootstrap 適用＋実DB検証済み）。
### 4-3. テスト運用（本セッションで実測）
- **TC-ID トレーサビリティ ✅（code 388）**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`。
- **注＝本検査は `impl/backend/tests/**/*.py` ＋ `impl/frontend/e2e/**/*.spec.ts` のみ走査**＝frontend の `src/**/*.test.ts`（vitest 単体）は対象外。正規表現も `\b([A-Z])-TC-(\d{3})\b`＝**3文字接頭辞 `SEC-TC-` に不一致**。よって vitest 単体は検査対象外で、追跡は md（SEC-TC-013 等）で担保する。

## 5. 詰まっている点（試した/失敗と理由）
- **フラキーの初期仮説は外れ**＝当初「設定キャッシュリーク」「account_sync outbox truncate 漏れ」を疑ったが、真因は**ワーカ競合**（3-D）。防御的隔離だけでは不十分でワーカ停止が必須だった。
- **PGroonga イメージのビルド失敗**＝`postgres:16` は現在 **Debian trixie**。パッケージ名は PGDG 版の **`postgresql-16-pgdg-pgroonga`**（`postgresql-16-pgroonga` は Debian 標準 PG 用で PGDG では候補なし）で解決。`FROM postgres:16`（trixie）を維持＝既存 `db_data` ボリューム（glibc 2.41）と一致し collation 警告を回避（bookworm へ落とすと glibc 2.36<2.41 で警告）。ファイル＝`impl/db/Dockerfile`。
- **マジックバイトで既存テストが赤化**＝PNG バイトを `image/jpeg` 宣言・`b"%PDF"`（短すぎ）等が signature_mismatch に。実バイトへ修正して解消（3-C 注）。
- **ルート直下の stray `backend/` フォルダ**＝cwd トラップ（Docker マウントが root として作成）由来と確認し削除済み。実体は `impl/backend/`。
- **共有 control DB 汚染（継続・無害）**＝`t-umekawa`（非 OPS system_admin）が残存。現状動作に影響なし。

## 6. 決定事項と根拠（不採用案も）
- **J 全文検索エンジン＝PGroonga**（採用・§6 設計準拠）＝日本語で分かち書き不要・DB 内で score/snippet 完結。**不採用＝Meilisearch/OpenSearch+kuromoji**（別サービス運用コスト増・MVP 過剰。将来の高精度化候補として J.6 に温存）。
- **スニペットXSS対策＝許可リスト（構造化セグメント）**（採用）＝`pgroonga_snippet_html` は user 文をエスケープし `<span class="keyword">` のみ生注入。フロントは `dangerouslySetInnerHTML` を使わず keyword のみ `<mark>`・他はデコードして text 描画。**不採用＝生 HTML 挿入＋DOMPurify**（依存追加＋原理的に許可リストの方が安全）。
- **フロント単体は vitest（node・純ロジック）**（採用）＝サニタイズは DOM 非依存に切り出せるため jsdom 不要。**不採用＝React Testing Library/jsdom 導入**（今回の対象には過剰。将来 DOM 依存の単体が必要になったら再検討）。
- **pytest 時はワーカ停止**（採用・恒久運用ルール・3-D）。
- **可視範囲はクエリ WHERE で強制／門番＝パーティー∩グループ AND／下書きは本人分も FTS 対象外**（J.0）。
- **テスト運用＝md 先行＋TC-ID＋red-green（red確認台帳）**（継続）。ブラウザ受入は後日バッチ（§7.5・ユーザー確認 2026-08-25）。

## 7. 次にやること（優先順・具体的に）

> **仕様×実装 網羅監査（2026-08-27・全ドメイン並列）の punch-list**。HIGH は本セッションで修正済み。残りは未着手のバックログ（着手時は §7 共通ルール＝TC先行・red-green）。
> - ✅ **H1 修正済**＝`complete_password_setup`（PW再設定完了）で信頼端末を失効していなかった（A.7/A.9-③ 違反）→ `revoke_all_trusted_devices` を同一Txに追加（A-TC-049 拡張・red→green）。
> - ✅ **H2 修正済**＝`change_account`（ロール変更）で信頼端末を失効していなかった（A.9-③ 違反）→ 同上（B-TC-032 拡張・red→green）。
> - ✅ **M1 修正済（パーティー差分）**＝L.4 購読失効を**バルク経路にも結線**。`_apply_party_diff` が除去 uid を返し、`set_party`/`update_quest`/`publish_quest` が post-commit で `_revoke_chat_subscriptions`（除去×chat group に `publish_revoke`）を発火（増分 `DELETE /members` の DRY 化含む）。L-TC-122（bulk PUT /party・monkeypatch で発火検証・red→green）。
> - ⬜ **M1b（残・小）**＝**クエストグループ除去**（`quest_group_application.py:remove_membership`／`admin/application.py`）は依然 `publish_revoke` 未発火。グループ除去はグループ内全クエストの chat 可視性を失わせるため、除去 user × グループ内全クエストの chat group に失効が要る（control_plane 側・system_admin 操作でより低頻度）。着手時は tenant 側 `_revoke_chat_subscriptions` を再利用する導線を検討。
> - ✅ **M2 修正済**＝公開アイデアの並行 `PATCH` を 409 `edit_conflict` に（版INSERTの `UNIQUE(idea_id,revision)` 違反を `ideas/application.py` の `update_idea` で `IntegrityError`→翻訳・`edit_conflict` code 追加・フロント `mapServerErrors` に実行可能文言）。D-TC-143（red→green）＋vitest 3。
> - ✅ **M3 誤検知（コード変更不要・調査で確定）**＝「代理公開で投稿XP+50 が公開者に付く」は**発生しない**。下書きは本人のみ可視で、他人（owner/quest_admin）の下書き公開は `_authorize_edit_idea` が 404（代理公開不可）＝publish 時は常に `user==投稿者`ゆえ現行の付与先は正しい。ガードテスト D-TC-145（他人 owner の publish=404・誰にも idea_post 付与なし）で不変条件を固定し、コメントも明確化。将来この経路を開くなら D-TC-145 が赤化して XP 受給者の再検討を促す。
> - ✅ **M4 修正済**＝`GET /ideas/{id}` の `vote.stale`（`my_vote` あり かつ `voted_revision < current_revision`）を `_build_detail` で算出。フロント SC-22 に「⚠ 投票後に更新」バッジ＋見直し文言（押し直しで解消）。D-TC-144（red→green）。
> - ⬜ **M5**（med・idempotency）＝`Idempotency-Key`（§1.9）が全面未実装（購入/魔法解放/クエスト作成/アカウント発行）。UNIQUE 制約が backstop で実害は限定的。
> - ✅ **M6 修正済**＝migration `0020_company_balance_guards`＝`users.xp/coin_balance/skill_point_balance` に `CHECK(>=0)`（負残高を DB 拒否）＋`activities` 部分ユニーク `UNIQUE(user_id,kind,reason,ref_type,ref_id) WHERE ref_id IS NOT NULL`（付与冪等の DB 最終防御＝`exists_ref` の SELECT を抜けた並行 INSERT を拒否・ref_id NULL の login/levelup_sp は重複可）。G-TC-107/108（red→green・既存データ重複0/負残高0を事前確認）。company head 0020。
> - ⬜ **F1**（Should・未完成）＝FR-36 アクティビティフィード ②クエスト内(SC-12 `GET /quests/{id}/activities`)・③チーム横断(SC-01 `GET /me/feed`) 未実装（①`/me/activities` のみ）。**成果系のみ公開**述語（idea_post/selection/achievement_reward/levelup_sp）を実装時に要注意。
> - ✅ **stale-doc 一括修正済**（コード挙動不変・コメント/文言のみ）＝FR-01/Idea 定義「投稿でコイン付与」→「XP+50・コインは評価連動（§6）」／`ledger.py` docstring（全ドメイン共用へ）／`publish_quest`・`chat/application.py` の「no-op フック」古コメント→「結線済み」／API設計 C.7「publish 通知は H まで no-op」→「H 結線済み」。import OK 確認。
> - **監査で確認して問題なし**（主要）＝XP/コイン付与の台帳結線（投稿+50/投票+5/評価+30/選定+200/評価連動コイン round(平均×10)・冪等・上限）／可視性門番（グループ∩パーティー・下書き本人のみ・cross-tenant 404）／権限6種の実強制／通知10種別の発生源結線／全文検索の WHERE 強制＋インジェクション対策／Mass Assignment（extra=forbid）／accounts→users ミラー網羅。

1. **（推奨・低コスト）再開時の健全性確認**＝backend full pytest を再実行（4-2 の 468 が維持か）。手順＝§8 の「backend テスト」。frontend は tsc/vitest/traceability を再実行（§8）。
2. **3D アバター（FR-08）＝着せ替え機能は実装/接続/テスト済み・残るは 3D VRM 描画のみ**（前回 handoff の「未実装」は不正確と本セッションで判明。実態＝SC-30/SC-31 ✅・migration 0015・`tests/shop`・G-TC-202/203。現状ビューアはマスコット画像＋装備アイコン重ねの 2D 見立て）。**本セッションで設計 TBD を確定**＝`doc/画面設計/screens/SC-31_アバター着せ替え.md` §9（9.1 ラインナップ確定〔既存19点シード〕・9.2 **ベース＝男女2体**〔`users.avatar_base` 新規列・要データモデル追記〕＋同一 humanoid リグで装備共用・9.3 2Dフォールバック/性能・9.4 回転ON/ズーム等MVP外・9.5 試着MVP外・9.6 将来〔動物キャラ等〕）。要件定義 第7節の非機能TBD（FPS/対応環境）も §9.3 へ整合。**次アクション**＝(a) ~~データモデル §5.3 に `avatar_base` 追記→migration~~ **完了**（データモデル §5.3＋enum節・migration `0019_company_avatar_base`・ORM `profile/orm.py` 追加・実DB検証済み）、(b) ~~`avatar_base` の read/write API~~ **backend 完了**（K.4.1 `PUT /me/avatar-base`・`GET /me` 同梱・K-TC-011-014・pytest 468）。(c) ~~three-vrm/R3F 導入＋WebGL フォールバック骨組み＋ベース切替 UI~~ **フロント骨組み完了**（three/@react-three/fiber v9/drei 導入＝package.json。`AvatarViewer3D.tsx`＝R3F Canvas＋プレースホルダ humanoid＋ドラッグ回転＋`prefers-reduced-motion`。`webgl.ts supportsWebGL()` で分岐＝WebGL 時 3D／非対応は 2D マスコット〔progressive enhancement・§9.3〕。ベース切替〔男/女〕→`PUT /me/avatar-base`〔SSR 初期値＝`GET /me`・楽観更新＋ロールバック〕。vitest 4件〔`avatar/avatar.test.ts`〕・tsc/lint クリーン）。**残＝(d) 実VRM 3Dアセット（男女2体＋装備パーツ）＝コード外の制作物・別途手配**＝これが入るまで `AvatarViewer3D.tsx` の TODO seam（`@pixiv/three-vrm` で `items.part_ref` をスロットへアタッチ）をプレースホルダのまま維持。**ブラウザ受入 完了**＝`e2e/sc-31-avatar.spec.ts`（**K-TC-015** green・実スタックで実測）＝ログイン→`/avatar`→3D Canvas 描画（headless chromium WebGL・`canvasCount=1`・2Dフォールバックせず）→ベース切替（男↔女）が `PUT /me/avatar-base` で永続（`GET /me` の `avatar_base` 反映・リロード後 `aria-pressed=true`）→元値へ cleanup。スクショで頭＝球/胴腕＝カプセルの 3D プレースホルダ描画を目視。
   - **既存ビルド不具合＝根治済み**＝ホストの `npm run build` が **CSS minify（cssnano）"Unexpected '/'" で失敗していたのは本 3D とは無関係の既存バグ**。真因＝`chat.css`/`shop.css` のヘッダーコメント内でクラス列挙のグロブ `*` 直後に `/` が来て `*/` を形成（`.reaction*/`・`.spell-fx*/`・`.rarity-*/`）→ブロックコメントを早期終了→以降が不正 CSS→minify で露呈（dev は寛容で通っていた）。**修正＝`*/`→`*・`**。`next build` **26ページ green 実測**（`/avatar` First Load 169kB＝three は動的import で別チャンク・初回に含まれない）。cssnano 個別診断で全 CSS OK。
3. **本番デプロイ準備**＝`doc/本番デプロイ要件.md` に沿って PGroonga カスタムイメージの本番反映・bootstrap/migration 手順・Redis 永続化・ヘッダのエッジ（プロキシ/TLS 前提の HSTS）整合を点検。
4. **要件(FR)網羅の最終点検 / UI ポリッシュ follow-up**＝`impl/README.md` 画面テーブルは全 ✅。細部 follow-up の現況（2026-08-27 精査で前回記述の一部は既に解消と判明）＝
   - ~~`IdeaDetailDTO` に `quest_id`/カテゴリー欠落で SC-22「クエストへ戻る」が暫定~~ **既に実装済み**（前回 handoff の記述は古い）＝DTO は `quest.id`/`quest.status`/`quest.categories`/`quest.deadline` を返し（D-TC-130）、`IdeaDetailView.tsx:255/264` が戻る導線・カテゴリーバッジに使用。
   - ~~投票の締切日時での事前 disable~~ **本セッションで実装**（`isVotingClosed`＝`voting.ts`・サーバー `_guard_votable` の `quest.deadline < today` と一致・vitest D-TC-219・6件 red→green）＝SC-22 投票ボタンを `completed`＋締切後で事前無効化＋バッジ/文言。フォロー/選定は `completed` のみ（締切対象外＝サーバーと一致）。
   - **残＝SC-25 の intercept モーダル化**（現状 `ideas/[ideaId]/eval/page.tsx` はフルページ・`@modal` slot 未整備）＝URL 付きモーダル標準（デザイン標準/フロント実装フロー規約）への寄せ。未対応。
5. **J の将来拡張（任意）**＝グローバル `GET /search`＋ヘッダー導線／最小文字数・演算子(OR/フレーズ)・正規化／種別間スコア重み／`per_page` 最終値（J.6 TBD）。
- **共通ルール**＝着手前に `impl/README.md` の現況と該当正本を開き、非自明な新規スコープはユーザーへ確認。1スライス＝backend+frontend＋テスト（md 先行・red-green）＝docs(handoff) の順でコミット、**push はユーザー承認後**。

## 7.5 ブラウザ受入待ち（バッチ・未消化）
- **運用**＝ブラウザ受入は後日まとめて（e2e green でクローズ扱い）。一覧は `impl/README.md`「ブラウザ受入状況」節。
- **J（全文検索）**＝SC-12「🔍 全文検索」タブで語を入れるとこのクエスト内のアイデア/チャット/添付ファイル名がヒット・種別バッジ・ハイライトスニペット・件数/ページング・行クリックで SC-22/SC-24 へ遷移・types 絞り込み・下書き/削除は出ない。dev＝ACME-01 の参加クエストに公開アイデア＋チャット＋添付を用意。
- **I/L**＝SC-01 実データ/投票/フォロー/login_bonus・ベル/SC-02/SC-24 の WS 即時反映。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝`/home/t-umekawa/sc-ideaquest-G2`。compose＝`impl/compose.yaml`。db は**カスタムビルド**（PGroonga 同梱・`impl/db/Dockerfile`）。
- **フルスタック起動**＝`docker compose -f impl/compose.yaml --profile workers up -d --build`（**db のビルドを含む＝初回は数分**）。ポート＝frontend :3000／backend :8000(`/healthz`)／db :5432／redis :6379／minio :9000/:9001／mailhog :8025。**e2e は `--profile workers` 必須**。
- **再ビルド反映**＝db `... up -d --build db`（PGroonga イメージ変更時）／frontend `... up -d --build frontend`／backend `... up -d --build backend worker mail-worker`。**frontend 再ビルド後は Playwright を再 install**。
- **DB migration 適用（会社/管理・冪等・0018 pgroonga 含む）**＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend python -m scripts.bootstrap`。
- **backend テスト（cwd=`impl` 厳守・ワーカ停止必須）**＝まず `cd /home/t-umekawa/sc-ideaquest-G2/impl && docker compose stop worker mail-worker`、続けて `docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/ -q`（ワーカ起動中は outbox 競合でフラキー・§5）。ドメイン別＝J `tests/search`／I `tests/dashboard`／L `tests/realtime`／XP `tests/ideas`・`tests/evaluations`。
- **frontend tsc / vitest**＝`cd impl/frontend && npx tsc --noEmit`（現状クリーン）／`cd impl/frontend && npx vitest run`（現状 15/15・node 環境）。
- **TC-ID 検査**＝**repo ルートで** `python3 scripts/check_tc_traceability.py`（現状 ✅ code 388）。
- **PGroonga 疎通確認**＝`docker compose exec -T db sh -lc 'psql -U "$POSTGRES_USER" -d ideaquest_company_acme -tc "select name,default_version from pg_available_extensions where name=''pgroonga'';"'`（→ pgroonga 4.0.x）。
- **dev ログイン（PW 全て `Passw0rd!`）**＝一般 `ACME-01`/`user@acme.example`（MFA OFF）／`ACME-02`/`mfa@acme2.example`（MFA ON）／system_admin `OPS`/`admin@ops.example`。MailHog＝`http://localhost:8025`。
- **正本の在り処**＝規約/入口＝`CLAUDE.md`。現況＝`impl/README.md`。実装順＝`doc/実装計画.md`。API＝`doc/API設計/{A..L}_*.md`（横断規約は `doc/API設計/README.md`）。データモデル＝`doc/データモデル.md`（§6 PGroonga）。テスト＝`doc/テスト/*.md`＋`red確認台帳.md`＋セキュリティ横断 `doc/テスト/セキュリティ横断.md`。本番＝`doc/本番デプロイ要件.md`。要件＝`doc/要件定義/README.md`（FR-xx）。
- **コミット規約**＝メッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`／PR body 末尾に 🤖 Generated with Claude Code 行／commit・push はユーザー承認後。
