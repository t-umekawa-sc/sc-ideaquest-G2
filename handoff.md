# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/バックログ/未実装・ギャップ一覧.md`（未実装/ISOギャップ/follow-up の台帳）／`doc/テスト/R_経営資料.md`（R ドメインの TC 台帳）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-30（本セッション末＝閾値再校正 §7-2 完了）
- ブランチ: `main`（作業ツリー clean）。
- push 状況: 本セッションの閾値再校正 `47383dbe` を **push 済（origin/main=47383dbe・完全同期）**。作業ツリーは未追跡 `doc/設計ドラフト/アイデアコンテスト機能_設計.md`（別作業の生成物）のみ残置。
- 直近コミット（新しい順）:
  - `1f8a6dc4` feat(strategy): 経営資料整合の意味的一致=**A-2**（埋め込み・会社別方式・FR-44 **Step3ب**）
  - `163691ca` docs(llm): ローカルLLM連携 設計ドラフト起票（別セッション・下記 §6 参照）
  - `a90d7257` feat(strategy,info): ピッカー候補行にアイコン表示（クエストを選ぶ/対象を選ぶ・R-TC-109/N-TC-228）
  - `49eaa407` docs(handoff)／`d76a1d66` SC-22 方針整合バッジ／`a576c75e` 整合率＋コイン backend（Step3）ほか（経営資料 R Step1-3）

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。直近の本命は **経営資料整合（FR-44・ドメイン R）**＝中長期計画/方針資料を登録→クエストが適用資料を選択→アイデアと資料の**整合率**を算出→**コイン付与**（将来は機会/脅威率＋AI 用 Markdown export）。

## 3. 今回やったこと（変更と理由）

本セッションは (A) ピッカー行アイコン表示、(B) 経営資料整合の「意味的一致」= A-2、の2件。**(A) は push 済（`a90d7257`）／(B) はローカルコミット済（`1f8a6dc4`）。**

### (A) ピッカー候補行にアイコン表示（`a90d7257`・完了）
- 目的＝「クエストを選ぶ」「対象を選ぶ」ダイアログの候補行に、設定時はアイコン、未設定は頭文字タイルをタイトル前に表示（視認性）。共通部品 `@/components/layout/QuestIcon` を流用。
- backend 候補 DTO に `icon_image_url` 追加＝strategy `QuestLinkItem`（`app/tenant/strategy/schemas.py`・`repository.py` の `quest_candidates`/`quests_for_doc` で `Quest.icon_image_path` 取得・`application.py` の `_quest_link_item` で presigned 解決）／info `InfoLinkCandidateDTO`（`app/tenant/info/schemas.py`・`repository.py` の `search_link_candidates` が raw パスを積み〔ideas=個別→作成者既定 `User.idea_icon_image_path`／quests=クエスト〕・`application.py` の `get_link_candidates` で presigned 解決。concepts/assumptions は null）。
- frontend＝`impl/frontend/src/features/strategy/components/StrategyQuestLinks.tsx`・`impl/frontend/src/features/info-input/components/TargetPicker.tsx`（候補行に `QuestIcon`）＋各 `types.ts` に `icon_image_url` 追加（手書きパススルー型）。
- テスト＝R-TC-109（`tests/strategy/test_strategy_crud.py`）・N-TC-228（`tests/info/test_api.py`）。

### (B) 経営資料整合の意味的一致 = A-2（`1f8a6dc4`・実装完了・実モデル通しは未確認）
方針＝**A-2＝埋め込み（テキスト→ベクトル→cosine）を「LLM 基盤の OpenAI 互換 `/embeddings`」経由で取得**する。モデルは基盤側に置き **backend アプリに焼き込まない**（データ主権・横断集約）。生成AI（方式 B＝LLM 判定）は使わない（整合率は決定的が要る＝コインの公平性のため）。

- 埋め込みクライアント＝`app/infra/llm/embeddings.py`（新規）。`OpenAICompatibleEmbeddings`（httpx で `/embeddings`）＋`FakeEmbeddings`（テスト用・決定的・同義語クラスタ）＋`get/set_embeddings_client`（`app/infra/storage.py` と同流儀）＋`cosine`。設定は `app/core/config.py` の `alignment_embed_base_url`/`alignment_embed_model`（既定 `bge-m3`）/`alignment_embed_api_key`/`alignment_hybrid_keyword_weight`（既定 0.5）。`httpx` を本番依存へ移動（`pyproject.toml`）。
- 埋め込み永続化＝`entity_embeddings`（会社DB）。ORM `app/tenant/tokens/orm.py` の `EntityEmbedding`（owner_type/owner_id/model/dim/vector JSONB）＋migration `impl/backend/migrations/company/versions/0047_entity_embeddings.py`（revision id=`0047_entity_embeddings`・down=`0046_quest_strategy_docs`※短縮 id 注意）＋repo `app/tenant/tokens/repository.py` の `upsert_embedding`/`embedding_for`（model 不一致は None＝再計算促す）。保存ヘルパ＝`app/tenant/info/application.py` の `persist_entity_embedding`（**best-effort**＝失敗しても保存を止めない）。保存点＝アイデア公開/更新（`app/tenant/ideas/application.py`）・経営資料保存（`app/tenant/strategy/application.py` の `_persist_tokens`）。
- 類似度プロバイダ＝`app/tenant/strategy/similarity.py`（新規）＝`KeywordProvider`/`EmbeddingProvider`/`HybridProvider`＋`provider_for(method)`。埋め込み欠損/モデル不一致は **keyword フォールバック**。matched_tokens は方式に依らず keyword 由来（説明可能性）。
- 整合算出＝`app/tenant/strategy/alignment.py` の `recompute_for_idea(ts, idea, *, company, award)`／`recompute_for_quest(..., award)` が `company.alignment_method` で provider 選択（`_method_of`）。方式変更の一括再計算＝`app/tenant/strategy/application.py` の `recompute_all_for_company(company)`（資料紐づけのある全クエスト＝`repository.all_linked_quest_ids`・award=True＝差分付与）。
- 会社別設定＝control `companies.alignment_method`（`app/control_plane/auth/orm.py`・enum keyword/embedding/hybrid・既定 keyword）＋migration `migrations/control/versions/0018_alignment_method.py`。admin schemas（`app/control_plane/admin/schemas.py`）＋`company_application.py`（`_SETTINGS_FIELDS`/`_ALIGNMENT_METHODS`・DTO・enum 検証・`update_company_settings` が方式変更時に `recompute_all_for_company` を **best-effort** 呼び出し）。
- frontend＝SC-92 会社設定に「整合の測り方」セレクタ（`impl/frontend/src/features/companies/components/CompanyDetailView.tsx` の `saveAlignmentMethod`＋select）。型は codegen（`npm run codegen` 済＝`schema.d.ts` に `alignment_method`）。
- compose＝`impl/compose.yaml` に `ollama` サービス（**profile `ai`＝opt-in**・既定 up では起動しない）＋backend env（`ALIGNMENT_EMBED_BASE_URL`/`_MODEL`/`_API_KEY`）。
- テスト＝`tests/strategy/test_alignment_embedding.py`（R-TC-202〜205・FakeEmbeddings）＋`tests/admin/test_admin_companies.py`（R-TC-206）。conftest に autouse `_fake_embeddings`（全テストを Fake 固定＝ネット非依存）。
- docs＝`doc/データモデル.md`（§5.36c entity_embeddings・§5.55 method 更新）／`doc/API設計/R_経営資料・整合.md`（R.2/R.3）／`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`（§11-7 に A-2 決定）／`impl/README.md`／`doc/テスト/R_経営資料.md`。

## 4. 現在の状態
- 動いている（本セッションで確認済み）:
  - ピッカー行アイコン＝両ダイアログでアイコン/頭文字タイルをスクショ目視確認済（(A)）。
  - 経営資料整合 A-2＝**backend フル pytest 869 passed**・関連 `tests/strategy`+`tests/info`+`tests/admin` green・`python3 scripts/check_tc_traceability.py` = ✅（895）。frontend `npm run build` 通過・`npm run codegen` 済。SC-92 セレクタは実機で「意味（埋め込み）」に切替→成功トースト→反映をスクショ目視確認。
  - **keyword フォールバックで実機動作**＝Ollama 未起動でも埋め込み best-effort が失敗して keyword で算出（設定変更で 500 にならないことを確認）。
- 壊れているもの＝確認範囲では無し。
- **未確認**＝(a) **実埋め込みモデル（bge-m3）での意味的一致の通し確認**（この環境で Ollama 未起動＝Fake/フォールバックのみ）／(b) frontend `vitest` 全域は未再実行（build は通過）／(c) Playwright e2e フルスイート未実行（使い捨て spec の目視のみ）。

## 5. 詰まっている点（試して失敗した/落とし穴）
- **migration の revision id は ≤32 字**＝company `0047` の down_revision は `0046_quest_strategy_docs`（ファイル名の `...documents` ではなく、ファイル内 `revision=` の短縮 id）。ファイル名≠revision id なので**必ずファイル内の `revision=` を確認**して繋ぐ。控えは control 側 `0018` も同注意。
- **pytest 環境は実 MinIO を使う**＝`FakeStorage` は明示 fixture 注入時のみ。署名URL の完全一致比較は不可＝**キー包含で検証**する（R-TC-109/N-TC-228 で対応）。
- **埋め込み呼び出しがテストを遅く/不安定にする**＝実クライアントは HTTP を打つため、conftest の **autouse `_fake_embeddings`** で全テストを `FakeEmbeddings` に固定（`FakeStorage`/`FakeMailSender` と同型）。これが無いと各アイデア公開でネットワーク試行が走る。
- **方式変更の再計算は設定保存の後段・best-effort**＝テスト会社は会社DB 未プロビジョニング（`ideaquest_test_*` 実在せず）のため `recompute_all_for_company` が `get_tenant_session` で落ちる。`update_company_settings` は**設定 commit 済みの後に try/except で recompute**（失敗はログのみ・保存はロールバックしない）。
- **frontend/backend はイメージにベイク**＝変更は `docker compose up -d --build frontend|backend` で反映。新 DTO 型は backend 再ビルド→`npm run codegen`→frontend ビルドの順。

## 6. 決定事項と根拠
- **意味的一致＝A-2（埋め込み・基盤の embeddings 経由）を採用**。不採用＝A-1（fastembed を backend に焼き込む）＝横断 LLM ゲートウェイ設計（`doc/設計ドラフト/ローカルLLM連携_設計.md`＝別セッションが起票・`163691ca`）に反し、重い依存を backend に持ち込むため。不採用＝方式 B（LLM 判定・生成）＝毎回ゆらぐためコイン報酬に不適・重い AIジョブ基盤が必要。B は**別要件**（横断 LLM ゲートウェイ＋AIジョブ基盤・未実装）。
- **会社が選ぶのは3方式（キーワード/意味/ハイブリッド）だけ**。ハイブリッド式（max/加重/比率）は**会社 UI に出さない**＝業務ユーザーに直感的でなく過剰。式は config（`alignment_hybrid_keyword_weight`・既定 B=0.5/0.5）で運用調整。
- **方式変更で整合率を全再計算＋差分コイン付与**（初回超えのみ・下げない）＝ユーザー要望。稼ぎ直し防止は G 台帳の `exists_ref` 冪等で担保。
- **埋め込みモデルは env 可変・既定 bge-m3**（多言語・日本語強）。`entity_embeddings` に model/dim を保存し不一致は無効化＝モデル差し替えで意味空間が変わっても誤 cosine を出さない。
- **matched_tokens は方式に依らず keyword 由来**＝意味方式でも「効いた語」の説明可能性を担保。
- **コイン段階は 50/70/90%→+3/+7/+15 のまま**（変更せず）。※埋め込みは分布が異なるため実データでの再キャリブレーション余地あり（次項）。

## 7. 次にやること（優先順・具体的に）
1. **【完了 2026-09-30】実モデル(bge-m3)での通し確認**＝`docker compose --profile ai up -d` + `ollama pull bge-m3`（1024次元）で疎通。意味ペア（語は重ならない）で keyword=0.00(コイン0) に対し embedding=0.50(→+3ティア)・無関係=0.37(閾値未満)＝keyword が取りこぼす意味的一致を捉えることを実機確認。配線も persist_entity_embedding→entity_embeddings(JSONB dim1024)→EmbeddingProvider 読み戻し一致・model不一致→None(フォールバック) を acme 会社DBで rollback 実施。
2. **【完了 2026-09-30】閾値の再校正**＝実測で bge-m3 の cosine 分布が圧縮（NEAR p50=0.525/p90=0.60・FAR p50=0.444/p90=0.518）＝生値では 0.70/0.90 ティアが死に整合率(%) 表示も不自然と判明。**方式＝embedding の生 cosine を 0..1 へ線形リスケール（`similarity._rescale`・config `alignment_embed_score_floor`/`_ceil`・既定 0.42/0.62・モデル別可変）してから共有 `_TIERS`(50/70/90) を適用**（keyword は生値のまま・hybrid は rescale 後 emb を加重）。`_TIERS` 自体は変更せず（Option 1＝正規化・ユーザー選択）。設計 §4.1a／API R／データモデル §5.55/§5.36c／R_経営資料.md §2 に実測分布と結論を記録・R-TC-207(unit)/208(int) 追加・pytest 871 green・稼働 backend 再ビルド反映済。※floor/ceil は評価セット near18/far90 での選定＝実運用データが貯まれば再調整余地（モデル差し替え時は要再計測）。
3. **【完了 2026-09-30】Step4 機会/脅威/影響率（R.4・決定的）**＝`GET /strategy-documents/{id}` の `impact` に影響率/機会率/脅威率を read 集計で同梱。母集団＝当該資料とトークン関連度が会社別 `auto_link_threshold`（既定0.12）以上の **curated（非アーカイブ）情報**（`info/repository.curated_impact`＋`strategy/application._impact_rates`）。機会/脅威は `info_items.impact_class`（人手）由来・決定的。frontend＝SC-81 編集画面上部に読み取り専用「情報の影響」カード（編集時のみ・機会=緑/脅威=赤・複製は非表示）。TC＝R-TC-110(api)/111(int)・pytest green・目視確認済（curated24件中2件関連・影響率8%・機会/脅威50%）。**ワードクラウド（設計§7）は R.4 API 仕様外＝follow-up に送った**（下記4-b）。
4. **Step5 AI 用 Markdown エクスポート（R.5）**＝`doc/テスト/R_経営資料.md` §4 に TC 追加してから。**←次はここ**
   - 4-b（follow-up）: 経営資料の**ワードクラウド**（設計§7＝集約でのみ UI 化）。info repo に `word_cloud` 実装済＝母集団情報 or 資料本文の主要語を集約表示。R.4 とは別 UI（優先度中）。
5. **回帰**＝着手前に backend フル pytest（下記コマンド）と Playwright e2e フル（本セッション未実行）を通す。
- 参考：LLM 生成（方式 B・要約/ISO 生成）を実装する時は**先に横断 LLM ゲートウェイ＋AIジョブ基盤**（`doc/設計ドラフト/ローカルLLM連携_設計.md`）を作る。A-2 の `infra/llm/embeddings.py` はその薄い前身＝将来ゲートウェイに吸収する想定。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（このシェルは cd が持続しない）。compose＝`impl/compose.yaml`。
- 通常起動＝`cd impl && docker compose up -d --build`。フロント反映＝`up -d --build frontend`／backend 反映＝`up -d --build backend`。**新 DTO の型は backend 変更後に `cd impl/frontend && npm run codegen`**（`http://localhost:8000/openapi.json`→`src/lib/api/schema.d.ts`）→frontend ビルド。
- 埋め込み基盤（A-2・意味/ハイブリッド方式で必要）＝`docker compose --profile ai up -d ollama` → `docker compose exec ollama ollama pull bge-m3`。**既定 up では起動しない**（keyword 方式は不要／意味方式でも未起動なら keyword フォールバック）。env＝`ALIGNMENT_EMBED_BASE_URL`（既定 `http://ollama:11434/v1`）・`ALIGNMENT_EMBED_MODEL`（既定 `bge-m3`）・`ALIGNMENT_EMBED_API_KEY`（空可）。
- 非同期系（mail=MFA/PW設定・sc-90 ディレクトリ）＝`docker compose --profile workers up -d`（既定 up では非起動）。**pytest 時は競合回避に `docker compose stop worker mail-worker`**。
- backend pytest（未コミット編集反映＝`-v`マウント・cwd=impl）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest -q`（対象限定は末尾に `tests/strategy` 等）。entrypoint が pytest 前に bootstrap（migration 適用）＝新 migration は自動適用。**全テストは FakeEmbeddings 固定**（conftest autouse）＝ネット不要。
- frontend 検証＝`cd impl/frontend && npm run build`（tsc/lint 兼）・`npx vitest run <path>`。e2e＝`npx playwright test <spec> --project=chromium`（storageState 認証・auth.setup 先行）。使い捨て spec は `e2e/tmp-*.spec.ts`（確認後削除）・スクショ `tmp_shots/`。**CSRF Cookie 名＝`iq_csrf`**（`page.request` で叩く時のヘッダ `X-CSRF-Token` に使う）。
- TC トレーサビリティ＝リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート・**一意性は見ない**＝採番前に当該ドメインの max を grep）。
- ポート＝frontend `:3000`／backend `:8000`／MailHog `:8025`／MinIO `:9000`／Ollama `:11434`（profile ai）。ログイン（ACME）＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者＝`kanri@acme.example`（company_account_admin）／`admin@ops.example`（system_admin・会社 OPS）・共に `Passw0rd!`。経営資料の登録・会社設定（SC-92 の整合方式）は管理者で。
- DB 直確認＝`docker compose -f impl/compose.yaml exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。R 表＝`strategy_documents`・`idea_alignment`・`quest_strategy_documents`・`entity_tokens`・`entity_embeddings`。会社設定＝control `companies.alignment_method`／`companies.auto_link_threshold`。
