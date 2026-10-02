# S. AIジョブ・LLM連携 テストパターン（FR-45・API設計 S・データモデル §5.57-5.59）

> トレーサビリティ＝設計書→本 md（TC-ID・`根拠` 列）→テストコード（テスト規約 §5）。TC-ID は `S-TC-1xx`（api/int）・`S-TC-2xx`（e2e/unit）で採番。設計元＝[ローカルLLM連携 設計](../設計ドラフト/ローカルLLM連携_設計.md)。
>
> **状態＝TC 先出し（実装未着手・FR-45 Phase1）**。各 Step 着手時に本 md へ TC 行（`根拠` 付き）を追加してからテストコードを書く（md 無しでコード書かない・CLAUDE.md）。**LLM 呼び出しはテストを不安定化**＝ゲートウェイは Fake プロバイダ（決定的スタブ・外部未接続）で差し替える（R ドメインの FakeEmbeddings と同方針）。初版の縦1本＝`info_summarize`（enqueue→worker→gateway→result→通知→画面遷移）。

## 1. ジョブ状態機械・N件制御・冪等・孤児回収（S.1・§5・データモデル §5.57）

> 状態＝`queued→running→succeeded/failed/canceled`（実行方式に依らず共通）。取り出し＝`status='queued'` を `created_at` 昇順、`FOR UPDATE SKIP LOCKED LIMIT N`（既定 N=1）。冪等＝`Idempotency-Key`（§1.9）。孤児回収＝`running` 無更新は再 queued。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| S-TC-101 | api | enqueue＝202＋ジョブ生成（queued）・自分のジョブに出る | 認証済み | `POST /ai-jobs`（task_type=info_summarize, input）＋Idempotency-Key | 202・`{id,status:"queued"}`／`GET /ai-jobs` の data に出る（requested_by=自分） | S.1／§5.57 |
| S-TC-102 | api | 冪等＝同一 Idempotency-Key の二重投入で1件のみ | 認証済み | 同一キーで `POST /ai-jobs` ×2 | 2回目は同じ id を返す・ジョブは1件（重複作成しない） | S.1／§1.9 |
| S-TC-103 | int | ワーカー取り出し＝queued を1件だけ running・Fake gateway で succeeded＋result 保存 | queued ジョブ1件・Fake gateway | worker dispatch 1 サイクル | status=succeeded・result 非null・started_at/finished_at 記録・input_tokens/output_tokens 記録 | §5.3／§5.57 |
| S-TC-104 | int | 同時実行 N=1＝2件 queued でも1件ずつ running（SKIP LOCKED で二重取得しない） | queued 2件・多重ワーカー模擬 | 並行 dispatch | 同時 running は最大1・両方最終 succeeded（順次） | §5.3 |
| S-TC-105 | int | 失敗リトライ＝attempts 上限まで再 queued・恒久失敗（入力不正）は即 failed | gateway が一時失敗を返すジョブ／入力不正ジョブ | dispatch | 前者＝attempts 増で再 queued→上限で failed／後者＝即 failed（error.code） | §5.4 |
| S-TC-106 | int | タイムアウト＝超過で failed（error.code='timeout'） | gateway が遅延するジョブ・短 timeout | dispatch | status=failed・error.code='timeout'・finished_at 記録 | §5.4 |
| S-TC-107 | int | 孤児回収＝running のまま無更新は再 queued（started_at/heartbeat 判定） | running で古い started_at のジョブ | reaper 実行 | status=queued に戻る（再実行可）・attempts は保持 | §5.4 |
| S-TC-108 | api | 認可＝他人のジョブは見えない（404） | user2 のジョブ | user1 で `GET /ai-jobs/{id}` | 404（存在秘匿・requested_by スコープ） | S.0 |
| S-TC-109 | api | summary＝待ち/実行中/直近完了・失敗の件数 | queued/running/succeeded/failed を各種 | `GET /ai-jobs/summary` | `{queued,running,recent_done,recent_failed}` が状態と一致 | S.1 |
| S-TC-129 | int | 待ちジョブの順番待ち位置＝会社全体の queued を priority→created_at 順に並べた rn（自分の順位）＋前方件数(実行中＋rn-1)からの概算ETA（履歴あれば） | running1件＋queued複数（会社全体） | `list_jobs` の queued 行 | 先頭 queued は queue_position=1・古い順に増える／実行中があると eta は running を織り込む／完了/失敗/実行中の行は position/eta とも null | S.1／§5.3 |
| S-TC-130 | api | 会社内 running の進捗＝`GET /ai-jobs/running` は**自分を除外**した会社内 running の `ratio` のみを処理順で返す（匿名＝依頼者/入力/タスク種別を含まない） | user1 の running1件＋user2 の running2件（ratio 各種・会社全体） | user1 で `GET /ai-jobs/running` | `{data:[{ratio}]}`＝user2 の2件のみ（user1 自身は出ない）・`ratio` は 0..1 or null・`requested_by`/`input`/`task_type` 等のキーを含まない／running 以外（queued/succeeded）は出ない | S.1a／S.0／S.7 |

## 2. モデル指定・ガードレール・GET /ai-models（S.2/S.3・設計 §3.4）

> 解決＝明示 model ＞ task_type 既定 ＞ グローバル既定。ガードレール（422）＝不正/無効キー・会社 OFF・external ポリシー違反・paid 予算超過・capability 不足。`GET /ai-models` は会社で有効なキーのみ。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| S-TC-110 | api | 既定挙動＝model 省略で task_type 既定キーが使われる（後方互換） | info_summarize 既定=qwen3-light | `POST /ai-jobs`（model 省略）→実行 | ジョブの provider/model が既定キーの物理に解決・requested_model=null | S.3／§3.3 |
| S-TC-111 | api | 明示 model 指定＝requested_model に記録・優先される | 会社で有効な別キー | `POST /ai-jobs`（model=有効キー） | requested_model=指定キー・解決結果がそのキーの物理 | S.2／§3.4 |
| S-TC-112 | api | 不正/無効キーは 422 | registry に無いキー | `POST /ai-jobs`（model=bogus） | 422（明示コード・field=model） | S.2 |
| S-TC-113 | api | 会社 OFF のキーは選択不可（422） | paid キーが会社 OFF | `POST /ai-jobs`（model=OFFキー） | 422（会社無効） | S.2／§4.2 |
| S-TC-114 | api | external ポリシー違反＝機微 task で外部キーは 422 | external=true キー・task ポリシー禁止 | `POST /ai-jobs`（機微 task＋external キー） | 422（データ主権・§10） | S.2／S.7 |
| S-TC-115 | api | GET /ai-models＝会社で有効なキーのみ返す（候補1もあり得る） | 無料ローカルのみ ON | `GET /ai-models?task_type=info_summarize` | data に有効キーのみ・既定フラグ・billing 付き・OFF/未許可は出ない | S.2／§4.2 |

## 3. 進捗・協調キャンセル（S.4・§5.5/§5.6）

> 進捗＝段階（phase）主軸＋ratio＋partial・`ai_jobs.progress` に最新値（画面が状態の正）。キャンセル＝協調（queued は即 canceled／running はフラグ→トークン境界で abort）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| S-TC-116 | int | 進捗＝実行中に progress（phase/ratio）が更新される・復元源になる | 多段 Fake gateway（3/5 等） | dispatch 中に `GET /ai-jobs/{id}` | progress.phase/ratio が段階的に進む・再読込で復元 | §5.6 |
| S-TC-117 | api | queued キャンセル＝即 canceled | queued ジョブ | `POST /ai-jobs/{id}/cancel` | status=canceled・finished_at 記録・ワーカーは取り出さない | S.4／§5.5 |
| S-TC-118 | int | running 協調キャンセル＝フラグ→次トークン境界で停止 | running ジョブ（ストリーム Fake） | cancel→worker が境界でフラグ確認 | cancel_requested=true→status=canceled（強制 kill せず他ジョブに影響なし） | §5.5 |
| S-TC-119 | e2e | SC-04＝実行中に進捗バー・行キャンセル・完了で対象へ遷移 | 自分のジョブ（実行中→完了） | SC-04 で進捗確認→キャンセル別ジョブ→完了行クリック | 進捗バー表示／キャンセルで canceled 反映／完了行の ref_* で対象画面へ | SC-04／S.1/S.4 |
| S-TC-207 | e2e | SC-04 上部＝他ユーザの実行中ジョブの進捗率が匿名で出る（自分の running は上部に出ない＝下の一覧） | user2 の running（進捗あり）＋user1 の running | user1 で SC-04 を開く | 上部セクションに user2 の実行中が進捗率付きで表示・依頼者名/内容は出ない／user1 自身の running は上部に出ず一覧側に出る | SC-04 §3／S.1a |
| S-TC-208 | e2e | SC-04 待機行＝「前に N 件待機」を表示し、見込み時間（約M分後）は出さない | 会社全体で自分の前に queued が複数・自分も queued | user で SC-04 を開く | 自分の待機行に「前に N 件待機」（N=queue_position−1）が出る／「約◯分後」等の ETA 時間表記は出ない | SC-04 §3/§4.1 |
| S-TC-209 | e2e | 共通ヘッダーに AIジョブ導線＝`/ai-jobs` へのリンク＋自分の active（queued+running）件数バッジ | 自分の active ジョブ>0 | 任意画面でヘッダーを見る→導線クリック | ベル近傍に AIジョブ導線があり件数バッジが出る／クリックで `/ai-jobs`（SC-04）へ遷移 | SC-04 §1/§5 |

## 4. 会社 ON/OFF・課金メータリング・予算上限（S.5・§4.2・データモデル §5.58/§5.59）

> 2階層（カタログ×会社有効化）。free 既定 ON／paid 既定 OFF（ON=課金合意）。課金 A＝cost_micros 集計＋予算上限。B/C 基礎＝ai_usage_events（生トークン＋単価スナップショット・追記専用・論理削除しない）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| S-TC-120 | api | 会社 ON/OFF＝admin のみ・paid ON は enabled_by/at 記録 | company_account_admin／一般 | `PATCH /admin/ai-models/{key}`（enabled=true）・一般でも試行 | admin=200・enabled_by/at 記録／一般=403 | S.5／§5.58 |
| S-TC-121 | int | 使用量記録＝実行1回ごとに ai_usage_events を append（単価スナップショット付き） | Fake gateway が usage 返す | dispatch 1件 | ai_usage_events 1行・input/output_tokens・rate_snapshot（pricing_version 含む）・cost_micros・period_ym | §4.2／§6.3 |
| S-TC-122 | int | free も使用量は記録（cost_micros=0） | free キーのジョブ | dispatch | ai_usage_events 1行・billing=free・cost_micros=0・トークンは非0 | §6.3 |
| S-TC-123 | int | 課金基礎の独立保持＝ジョブ論理削除後も ai_usage_events は残る | 実行済ジョブ＋usage 行 | ai_jobs を論理削除 | ai_usage_events 行は残る（job_id は保持 or SET NULL・集計から消えない） | §6.3／§5.59 |
| S-TC-124 | int | 予算上限＝当月 SUM(cost_micros) 到達で paid の enqueue を保留/拒否・free は対象外 | 予算 ≒ 当月消化 | paid で enqueue／free で enqueue | paid=保留/422（予算超過）／free=通常 queued（止めない） | §4.2／S.2 |
| S-TC-125 | api | 利用量可視化＝会社×モデル×月の集計・予算消化率 | usage を複数月/モデル | `GET /admin/ai-usage?period_ym=` | 集計が ai_usage_events と一致・消化率＝SUM/budget | S.5／§6.3 |

## 5. 通知・遷移（S.6・§8・データモデル §5.24）

> 完了通知＝既存 notifications 再利用（ai_task_done/ai_task_failed・ref_* 遷移）。ライブ＝WS ai_jobs:{user_id}。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| S-TC-126 | int | 完了で ai_task_done 通知＋ref_* に遷移先 | succeeded ジョブ（ref_idea_id 付き） | dispatch 完了 | notifications 1件・type=ai_task_done・ref_idea_id=対象・宛先=依頼者 | S.6／§8 |
| S-TC-127 | int | 失敗で ai_task_failed 通知（params.error） | failed ジョブ | dispatch 失敗 | type=ai_task_failed・params.error に理由 | S.6 |
| S-TC-128 | e2e | SC-02 通知の ai_task_done から対象画面へ遷移（通知クリック動線） | ai_task_done 通知あり | SC-02 で通知クリック | ref_* の対象画面（生成結果反映）へ遷移 | S.6／SC-02/SC-04 |

## 6. LLMゲートウェイ・registry・routing（unit・infra/llm・設計 §3）

> ゲートウェイ＝自前の薄い層（OpenAI 互換共通語）。registry＝論理モデルキー→物理（provider/model/params/external/billing/enabled）。routing＝解決優先順位（明示 model ＞ task_type 既定 ＞ グローバル既定）。テストは `FakeChat`（決定的・外部未接続）で差し替える。物理モデル名は config（dev/prod で env 可変）＝キーは dev/prod 同一。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| S-TC-201 | unit | registry＝Phase1 の論理キー（qwen3-light/qwen3-swallow）が存在・free・enabled・物理は config 由来 | 既定 config | `registry.get('qwen3-light')`／`get('qwen3-swallow')` | provider='openai_compat'・billing='free'・enabled=True・model が config 値・external=False | 設計 §3.1/§4.1 |
| S-TC-202 | unit | routing 優先順位＝明示 model ＞ task_type 既定 ＞ グローバル既定 | 既定 config | `resolve_key('info_summarize', None)`／`resolve_key('info_summarize','qwen3-swallow')`／`resolve_key('unknown_task', None)` | 順に qwen3-light（task既定）／qwen3-swallow（明示優先）／グローバル既定キー | 設計 §3.4 |
| S-TC-203 | unit | ガードレール＝registry に無いキーは LLMConfigError（呼び出し側で 422 に写像） | 既定 config | `resolve_key('info_summarize','bogus')` | LLMConfigError（不正キー・enabled=False も同様に拒否） | 設計 §3.4 |
| S-TC-204 | unit | FakeChat＝決定的な要約テキスト＋usage（tokens）を返す（外部未接続） | FakeChat 注入 | `gateway.complete('info_summarize', messages)` | text 非空・input_tokens/output_tokens>0・provider/model が解決結果と一致・finish_reason='stop' | 設計 §3.1／§5.57 |
| S-TC-205 | unit | 実プロバイダ到達不能は LLMUnavailable（呼び出し側でリトライ/failed へ） | OpenAICompatibleChat（未接続 base_url） | `client.complete(...)` | LLMUnavailable（例外型で分岐可能） | 設計 §5.4／embeddings 同流儀 |
| S-TC-206 | unit | list_models＝会社の有効集合で論理キーを返す（task_type 絞り・既定フラグ） | 全 free ON | `registry.list_models(task_type='info_summarize', enabled_keys=...)` | qwen3-light を含む・is_default 正・billing/external 付き・OFF/未許可は出ない | S.2／設計 §3.4 |
