# R. 経営資料・整合 テストパターン（FR-44・API設計 R・データモデル §5.54-5.55）

> トレーサビリティ＝設計書→本 md（TC-ID・`根拠` 列）→テストコード（テスト規約 §5）。TC-ID は `R-TC-1xx`（api/int）・`R-TC-2xx`（e2e/unit）で採番。設計元＝[経営資料整合・自動関連付け 設計](../設計ドラフト/経営資料整合・自動関連付け_設計.md)。
>
> Phase1 を Step 単位で実装＝Step2 CRUD／Step3 整合率＋コイン／Step3ب 埋め込み／Step4 機会脅威率／Step5 エクスポート。各 Step 着手時に本 md へ TC 行（`根拠` 付き）を追加してからテストコードを書く（md 無しでコード書かない・CLAUDE.md）。

## 1. 経営資料 CRUD（R.1・SC-80/81/82・Step2）

> 権限＝`company_account_admin`/`system_admin` のみ変更可（一般/クエスト権限は 403）。検証＝§4.7（title 必須・doc_kind ホワイトリスト・period_from<=period_to）。`body_text` 連結＋`entity_tokens`（owner_type='strategy_doc'）同期。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R-TC-101 | api | 作成＝201＋body_text 連結＋トークン永続化（owner='strategy_doc'） | company_account_admin | `POST /strategy-documents`（構造化項目） | 201・`status=active`／`entity_tokens`（owner_type='strategy_doc'）が生成される | R.1／§5.54/§5.36b |
| R-TC-102 | api | 管理一覧に出る／一般ユーザーは 403 | admin で1件作成 | admin `GET /strategy-documents?q=`／一般 `GET` | admin＝data に作成分・page_info.total≥1／一般＝403（管理者スコープ・R.0） | R.1／R.0 |
| R-TC-103 | api | 選択用一覧はクエスト作成者可・active のみ・軽量 | admin で1件作成 | 一般ユーザーで `GET ?for=selection&q=` | 200・作成分を含む・キーは `{id,title,doc_kind,period_from,period_to}` のみ（全文/率なし） | R.0／R.1 |
| R-TC-104 | api | 更新＝反映＋トークン再永続化／doc_kind 不正・期間逆転は 422 | admin で1件作成 | `PATCH`（strategy 変更）／`PATCH`（doc_kind=bogus）／`PATCH`（period_from>period_to） | 前者200・反映／後2つ 422（field=doc_kind／period_to） | R.1／§4.7 |
| R-TC-105 | api | 変更系の CSRF/認可 | admin／一般 | CSRF 無し `POST`／一般ユーザー `POST`（CSRF有） | いずれも 403（csrf_failed／forbidden） | R.0／A.0 |
| R-TC-106 | api | アーカイブ（論理削除）＝status=archived・選択用一覧から除外（物理削除はしない） | admin で1件作成 | `POST /{id}/archive`→一般で `?for=selection` | archived・選択用一覧に出ない（active のみ）・レコードは残る | R.1／R.0 |
| R-TC-107 | api | 復元（アーカイブ解除）＝active に戻り選択用一覧に再掲（誤アーカイブの復元） | admin で1件作成→archive | `POST /{id}/unarchive`→一般で `?for=selection` | status=active・選択用一覧に再び出る | R.1 |
| R-TC-108 | api | 経営資料←→クエストの紐づけ（候補検索/追加/解除）＋クエスト版履歴に記録・authz | admin で資料＋クエスト作成 | `GET /quest-candidates`／`POST /{id}/quests`／`GET /{id}/quests`／`DELETE /{id}/quests/{qid}`／一般で `GET /{id}/quests` | 候補に出る／追加で linked に出る／版履歴（quest_revisions）の changes に `strategy_documents`（資料タイトル）が載る／解除で消える／一般は 403 | R.1b／§5.56／§3.1 |
| R-TC-109 | api | クエスト候補にアイコンURLを載せる（ピッカー行頭表示・未設定は null＝頭文字タイルへフォールバック） | admin でアイコン設定済クエスト1件＋未設定クエスト1件 | `GET /quest-candidates` | アイコン設定クエストの行は `icon_image_url` が非 null（署名URL）／未設定クエストは `icon_image_url` が null | R.1b／§5.56 |

## 2. 整合率＋コイン（R.2/R.3・SC-22・Step3）

> 整合率＝`SimilarityProvider`（会社別 keyword/embedding/hybrid・A-2）→`idea_alignment` upsert・最大採用＋effective tokens。コイン＝段階（≥50→+3/≥70→+7/≥90→+15）・冪等・初回のみ・下げない。意味方式（embedding/hybrid）＝保存済み `entity_embeddings`（LLM 基盤 embeddings 由来）の cosine・欠損は keyword フォールバック。**embedding の生 cosine は 0..1 へ線形リスケールしてからティア適用**（bge-m3 は分布が圧縮＝生値では上位ティアが死ぬ・config floor/ceil 既定0.42/0.62・R-TC-207/208・設計§4.1a）。テストは FakeEmbeddings（同義語クラスタで意味近接を決定的に再現・外部未接続）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R-TC-201 | int | 整合率＝母集合（クエストの選択資料）でキーワード cosine を算出→best・効いた語を idea_alignment に保存／best 段階でコイン初回付与（冪等） | アイデア・経営資料・quest_strategy_documents・両者の entity_tokens（cosine≈0.924）をシード | `alignment.recompute_for_idea(award=True)`×2 | best≥0.9／idea_alignment 1行・matched_tokens に「脱炭素」／`alignment_payload` の best_strategy=当該資料・coins_awarded=15／コイン付与は初回のみ（activities 1件・exists_ref 冪等） | R.2／R.3／§5.55 |
| R-TC-202 | int | 意味方式は「語が重ならないが意味が近い」ペアで keyword より高い（意味的一致・A-2） | 語の重ならない意味ペア（idea=太陽光/パネル・doc=脱炭素/再エネ）の entity_tokens＋FakeEmbeddings 埋め込みを永続 | keyword/embedding/hybrid の各 provider で score | keyword≈0（重なりなし）／embedding>0.5／hybrid＝w·kw+(1-w)·emb で両者の中間（embedding>hybrid>keyword） | R.2／A-2／FR-44 |
| R-TC-203 | int | 会社設定で provider が切替わる／埋め込み欠損はキーワードへフォールバック（graceful degradation） | 上と同ペア・埋め込みは doc 側のみ削除して欠損を作る | `alignment_method=embedding` で `recompute_for_idea`（埋め込み欠損） | 方式=embedding でも欠損時は keyword 相当（best≈keyword）＝例外なく算出・idea_alignment.method に選択方式を記録 | R.2／A-2 |
| R-TC-204 | int | 埋め込み永続化＝本文保存で entity_embeddings が model/dim 付きで生成される | 空 | `persist_entity_embedding(ts,'idea',id,text)` | entity_embeddings 1行・model=FakeEmbeddings.model・dim=len(vector)>0・再呼び出しで upsert（重複しない） | A-2／§5.36b |
| R-TC-205 | int | 会社の方式変更で整合率を全再計算＋差分コイン付与（初回超えのみ・下げない） | keyword では best<0.5（コイン0）／embedding では best≥0.9 になる意味ペアをシード・quest_strategy_documents 紐づけ | `recompute_all_for_company`（keyword→coin0 を確認後 method=embedding で再実行） | keyword 時 coins_awarded=0／embedding 再計算後に差分付与され coins_awarded>0（activities 1件・冪等・再々実行で増えない） | R.3／A-2 |
| R-TC-206 | api | 会社設定 `alignment_method` は keyword/embedding/hybrid のホワイトリスト（未知は 422・正常は保存） | company_account_admin | `PATCH /companies/{id}/settings`（alignment_method=bogus／=embedding） | bogus=422（field=alignment_method）／embedding=200・詳細 `alignment_method=embedding` で反映 | R.1／FR-44／§4.7 |
| R-TC-207 | unit | 埋め込み cosine→整合率の線形リスケール（bge-m3 校正）＝floor→0・ceil→1・中点→0.5・範囲外はクランプ／既定 floor/ceil では無関係域は 0 ティア・意味近域は最上位ティアへ | config 既定（floor/ceil） | `similarity._rescale(x)` を境界値・中点・範囲外で評価／`alignment.coins_for(_rescale(0.44))`・同`(0.60)` | floor→0.0・ceil→1.0・中点→0.5・floor未満/ceil超はクランプ／far中央(0.44)→コイン0・near上位(0.605)→+15（上位ティアが生き返る） | R.2／A-2／設計§4.1a |
| R-TC-208 | int | EmbeddingProvider は生 cosine でなくリスケール後(0..1)を返す＝bge-m3 の圧縮分布でも上位ティアに届く（校正の配線） | cosine=0.60 になるベクトルを idea/doc に直接 upsert（`entity_embeddings`・fake-embed モデル名） | `similarity.EmbeddingProvider().score(...)` | score＝`_rescale(0.60)`（生値より大）／`coins_for(0.60)=3` に対し `coins_for(score)>3`（生値では+3止まりが上位ティアへ） | R.2／A-2／設計§4.1a |

## 3. 機会/脅威/影響率＋方針まわりの語像（R.4／R.4b・Step4）

> 役割分担＝関連度＝キーワード（決定的・`derive.token_cosine`）／機会・脅威＝人手（`info_items.impact_class`）。母集団＝当該経営資料とトークン関連度が**閾値以上**（会社別 `auto_link_threshold` 流用・既定0.12）の **curated（非アーカイブ）情報**。専用テーブルは持たず `GET /strategy-documents/{id}` の read で集計（設計§4.2・API R.4）。影響率＝母集団/全 curated・機会率/脅威率＝母集団のうち `opportunity`/`threat` の割合。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R-TC-110 | api | 詳細 read に影響率/機会率/脅威率を同梱＝母集団（関連度≥閾値の curated 情報）で集計・非関連/非curated は除外 | 資料1件（**ユニーク語**の tokens）＋curated 情報〔機会・関連／脅威・関連／その他・非関連〕＋raw 情報〔関連だが非curated〕をシード（ユニーク語で母集団を投入分に限定＝共有DB非依存） | admin `GET /strategy-documents/{id}` | 200・`impact.related_count=2`・`opportunity_count=1`・`threat_count=1`・`opportunity_rate=0.5`・`threat_rate=0.5`・`threshold=0.12`・`impact_rate=round(related/info_total,3)`（整合）／非関連・非curated は母集団外 | R.4／§5.33／設計§4.2 |
| R-TC-111 | int | 集計の端（資料トークン空／母集団0）はゼロ除算せず率0を返す（例外なし） | 資料1件（tokens を永続しない） | `application._impact_rates(ts, doc, company)` | `related_count=0・impact_rate=0.0・opportunity_rate=0.0・threat_rate=0.0`（例外なし・`info_total`は全 curated 件数） | R.4／設計§4.2 |
| R-TC-114 | api | この方針まわりの語像（R.4b・§7＝集約UI）＝関連情報＋関連アイデア＋関連コンセプトの語を頻度集約・weight 正規化／認可 | 資料（ユニーク語 tokens）＋関連 判定済情報／関連アイデア(idea_alignment)／関連コンセプト（いずれも同ユニーク語＋各固有語 tokens）をシード | admin `GET /{id}/word-cloud`／一般 `GET`／不明 ID | 200・共有語は weight=1.0（3owner で最頻）・各固有語も tokens に出る・`related_count=3`／一般=403／不明=404 | R.4b／設計§7 |
| R-TC-115 | int | 語像の端（関連 0）は空 tokens・related_count=0（例外なし） | 資料1件（ユニーク語 tokens・関連なし） | `application._word_cloud(ts, doc, company)` | `tokens=[]・related_count=0`（例外なし） | R.4b／設計§7 |

## 4. Markdown エクスポート（R.5・Step5）

> `GET /strategy-documents/{id}/export.md`（管理者スコープ）＝経営資料本体（ISO56001 項目立て）＋関連度上位のアイデア（idea_alignment）＋関連情報（機会/脅威ラベル・R.4 母集団）＋関連コンセプト（トークン重なり）を**構造化 Markdown** に束ねて返す。**利用者の明示操作でのみ・外部送信しない**（生成は利用者が任意 LLM に貼る＝データ主権・§8/§10）。決定的。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R-TC-112 | api | export.md が構造化 Markdown を返す（本体＋関連情報の機会/脅威ラベル）／認可 | 資料1件（tokens）＋curated 機会情報〔関連〕をシード | admin `GET /{id}/export.md`／一般 `GET`／admin で不明 ID `GET` | 200・`content-type: text/markdown`・`# タイトル`＋ISO 見出し（意図/方針/戦略/重点領域/目標）＋関連情報の見出しに機会情報タイトル＋「機会」ラベル／一般=403／不明=404 | R.5／§8 |
| R-TC-113 | int | ビルダーが関連アイデア/コンセプトを載せ・パイプをエスケープ・未記入/該当なしを埋める（決定的） | 資料1件＋quest＋idea＋idea_alignment＋concept（tokens）をシード・intent 空 | `export.build_markdown(ts, doc, company, related_info=[パイプ入りタイトル])` | idea/ concept タイトルが表に出る／`\|` エスケープ／intent は「（未記入）」／関連情報の分類は「機会」 | R.5／§8 |



## 5. Phase2 in-app 生成（iso_generate・R.6・FR-44 Phase2・設計 §8）

> `POST /strategy-documents/{id}/generate`（管理者）＝経営資料＋関連の構造化 Markdown（export 再利用）を文脈に **AIジョブ基盤（FR-45）へ `iso_generate` を投入**（文脈は strategy 層で用意し input に載せる＝worker は strategy 非依存・LLM 物理は基盤に閉じる＝データ主権）。`GET /{id}/generation`＝最新生成の状態＋ドラフト。LLM は FakeChat（決定的）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R-TC-120 | int | 生成縦1本＝資料→`iso_generate` 投入→worker(FakeChat)→succeeded→生成取得 | company_account_admin・資料1件 | `POST /{id}/generate`→`process_ai_jobs_once`→`GET /{id}/generation` | generate=202・queued／生成前は generation.status=queued・result_text=null／worker後 succeeded≥1／generation.status=succeeded・result_text 非空 | R.6／FR-45／設計§8 |
| R-TC-121 | api | 生成は管理者のみ（一般は 403） | 資料1件・一般ユーザー | 一般で `POST /{id}/generate` | 403（require_company_account_admin） | R.6／R.0 |
