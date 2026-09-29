# ローカルLLM連携 — 設計ドラフト（LLMゲートウェイ × AIジョブ基盤 × 処理状況画面）

> 状態: **ドラフト（2026-09-29 起票・同日に §3〜§5 の3論点をユーザー合意）**。ローカル/オンプレ LLM をアプリに安全・低コストで組み込み、**将来はクラウドの生成AI API へも同一の口で差し替える**ための横断インフラ設計案。
> 合意済みの芯（2026-09-29）＝(1) 本番 LLM 路線は **両建て**（`task_type` 単位でモデルを使い分け）、(2) 抽象化層は **自前の薄いゲートウェイ**（OpenAI 互換を共通語）、(3) ジョブ基盤は **既存 outbox＋ポーリングワーカーを踏襲**しつつ、**将来のクラウドAI連携ではポーリングが不要になり得る**ため「状態管理」と「実行方式」を分離して差し替え可能にする。加えて **割り込みキャンセル（§5.5）・進捗表示（§5.6）・機能側からの LLM 指定（§3.4 論理モデルキー）・モデルピッカーUIの初版作り込み（§9.2）・会社単位のモデルON/OFF＋課金（§4.2）を採用**。初版の最初の task_type＝**`info_summarize`**（§3.3）、prod 高品質日本語生成＝**Qwen3 Swallow**（§4・§4.1）を確定。
> 参照表記は [ドキュメント作成規約](../規約/ドキュメント作成規約.md) 準拠。
> 関連正本＝[コーディング規約](../規約/コーディング規約.md) §2（セキュリティ）・§3.4（バックエンド4層）／[API設計 README](../API設計/README.md) §1.8（一覧）・§1.9（冪等性）・§1.12（リアルタイム）／[データモデル](../データモデル.md)（`notifications`・`*_outbox`・監査/論理削除の共通列）／[本番デプロイ要件](../本番デプロイ要件.md)（インフラ・ワーカー運用）。
> 本書を土台に使う（LLM を必要とする）機能＝[経営資料整合・自動関連付け 設計](経営資料整合・自動関連付け_設計.md) §2/§8（Phase2 生成）・[情報インプット機能 設計](情報インプット機能_設計.md)（LLM 要約・矛盾検出 Phase2）・[コンセプト機能 ISO56001 再設計](コンセプト機能_ISO56001_再設計.md)（前提の自動検証 Phase2）。

## 0. 位置づけ・狙い

- 複数機能（経営資料整合の ISO 文書生成、情報インプットの LLM 要約、コンセプトの前提検証 …）が **今後それぞれ LLM を必要とする**。各機能が個別に LLM クライアントを直叩きすると、モデル差し替え・並列制御・データ保護・監査が**機能ごとにバラバラ**になる。→ **LLM 呼び出しと非同期実行を横断インフラに一本化**する（[横断標準を個別画面より先に決める]方針）。
- **設計判断の芯**＝アプリのドメイン層は「**どの LLM が動くか**」も「**同期か非同期か**」も知らないでよい状態にする。呼び出し側は `task_type` と入力を渡して**ジョブID を受け取るだけ**。どのモデルで・何件ずつ・いつ実行するかは基盤側の関心事に閉じる。
- **前提条件（ユーザー要件）**＝応答は数分許容／初版はバックグラウンド専用／最小スペックサーバーで **LLM 必要リクエストは N 件ずつ順次**／完了は画面に通知／**処理待ち・実行中・完了が分かる画面**を用意し、**完了選択で該当画面へ遷移**／LLM は**日本語に強い・商用可・無料**／dev は軽量でよい／**LLM 切替の仕組みを間に挟む**／将来は各種 LLM・生成AI API 連携も視野。

## 1. 要件の分解（ユーザー要望 → 設計要素）

| ユーザー要望 | 対応する設計要素 | 本書の節 |
| --- | --- | --- |
| LLM 必要リクエストを N 件ずつ順次 | AIジョブ基盤（状態機械＋実行方式）・同時実行 N（既定1） | §5 |
| 処理が終わったら画面に通知 | 既存 `notifications`＋WebSocket を再利用（`type=ai_task_done`） | §8 |
| 待ち/実行中/完了が分かる画面／完了選択で遷移 | 新規「AI処理状況」画面（DataTable＋`ref_*` 遷移） | §9 |
| LLM 切替の仕組みを間に挟む | 自前の薄い **LLMゲートウェイ**（OpenAI 互換共通語・アダプタ差し替え） | §3 |
| 日本語に強い・商用可・無料 | dev=軽量 Qwen 等／prod=**両建て**（多言語 Apache 系 × 国産日本語特化） | §4 |
| 将来いろいろな LLM・生成AI API | provider アダプタ追加のみ／`task_type→model` ルーティング設定 | §3 |
| 将来クラウド連携でポーリング不要になり得る | 「状態管理」と「実行方式（dispatcher）」を分離・差し替え可能 | §5.2 |
| 機能側で使う LLM を指定できる | 論理モデルキーで呼び出し上書き（既定＋override）・`GET /ai-models` | §3.4 |
| モデル選択UIを作り込む（候補1でも常設） | 機能内ピッカーを初版から常設・`GET /ai-models` 駆動 | §9.2 |
| 会社単位で LLM を ON/OFF | カタログ×会社有効化の2階層・管理画面 | §4.2・§9.3 |
| 有料 LLM/API を ON にしたら課金 | 課金方式A（メータリングのみ・実請求なし）＋予算上限。**B/C 算出根拠の使用量は恒久保持**（`ai_usage_events`・単価スナップショット） | §4.2・§6.3 |

## 2. アーキテクチャ全体像

```
[ドメイン各機能]                      呼び出し側は task_type と入力を渡すだけ
  strategy / info / concepts ...
        │ enqueue_ai_job(task_type, input, ref_*)
        ▼
 ┌─────────────────────────────┐
 │ AIジョブ基盤 (tenant/ai_jobs)                                      │
 │  ai_jobs テーブル(会社DB): queued→running→succeeded/failed/canceled │
 │  ┌──────────── 実行方式(dispatcher) は task_type/provider で選択 ──┐│
 │  │ (a) queued-worker   : ローカル/最小スペック向け                  ││
 │  │      compose "workers" に llm_worker を追加・ポーリング・N件制御   ││
 │  │ (b) immediate/async : 高速な外部API向け(将来)・ポーリング背圧なし  ││
 │  └───────────────────────────────────────┘│
 └──────────────┬──────────────────────────────┘
                │ gateway.complete(task_type, messages, *, model=<論理キー|None>, ...)
                ▼
 ┌─────────────────────────────┐
 │ LLMゲートウェイ (infra/llm) ＝ 自前の薄い層                          │
 │  registry : 論理モデルキー → {provider, model, params, external, enabled} │
 │  routing  : model指定あれば優先 / 無ければ task_type既定キー          │
 │  providers/openai_compat.py → Ollama / vLLM / llama.cpp / OpenAI  │
 │  providers/anthropic.py(将来) → Claude 等                          │
 └──────────────┬──────────────────────────────┘
                ▼ 成否確定
 ┌─────────────────────────────┐
 │ 通知(既存) notifications + realtime(WebSocket/Redis Pub/Sub)         │
 │  type=ai_task_done / ref_* に遷移先 → SC-02 通知・AI処理状況画面へ    │
 └─────────────────────────────┘
```

- **新規に足すのは実質「LLMゲートウェイ(`infra/llm/`)」「AIジョブ基盤(`tenant/ai_jobs/`)」「LLMワーカー(`app/llm_worker.py`)」「AI処理状況画面」だけ**。通知・リアルタイム・DataTable・冪等ヘッダ・監査列はすべて既存機構を流用する（**なぜ**＝既存に非同期の型〔outbox＋ワーカー〕・通知の型〔`ref_*` 多態＋WebSocket〕が確立しており、新インフラ〔Celery/RQ 等〕の追加は API設計 README の既定方針から逸脱するため）。

## 3. LLMゲートウェイ（抽象化層）＝自前の薄い層

**決定（2026-09-29）＝自前の薄いゲートウェイ**。OpenAI 互換プロトコルを**内部の共通語**に据え、`providers/` 配下に薄いアダプタを足す。

**なぜ自前・薄く**＝
- Ollama・vLLM・llama.cpp(llama-server) は**すべて OpenAI 互換エンドポイントを持つ**ため、ローカル LLM の載せ替えは**設定変更だけ**で済み、アダプタは薄くて足りる。
- 既存 `infra/`（`storage.py`=MinIO・`cache.py`=Redis・`mail.py`=SMTP）と**同格の副作用インフラ**として置ける＝[コーディング規約](../規約/コーディング規約.md) §3.4 の層責務・DRY に自然に収まる。
- 外部OSSプロキシ（LiteLLM 等）を挟む案は**不採用**（**なぜ**＝運用対象と外部依存が1つ増える／現時点の必要は「切替の口」だけで薄アダプタで足りる）。ただし**インターフェースは LiteLLM 互換を意識**しておき、多プロバイダ対応が本当に必要になったら差し替えられる余地を残す（§12）。

### 3.1 共通インターフェース

- 配置＝`app/infra/llm/`
  - `gateway.py`＝provider 非依存の呼び出し口。`complete(task_type, messages, *, model=None, json_schema=None, timeout, ...) -> LLMResult`。ドメインはこれ**だけ**を知る。`model` は**論理モデルキー**（後述 §3.4）で、機能側が使う LLM を指定できる口。
  - `registry.py`＝**論理モデルキー → {provider, model, params(温度/最大トークン/timeout), external, capabilities, enabled}** の台帳。機能側・UI が触るのは**キーだけ**で、provider/base_url 等の物理は隠す。
  - `routing.py`＝キー解決の優先順位（§3.4）＝**呼び出し指定 model ＞ task_type 既定キー ＞ グローバル既定**。**設定（env/設定ファイル）で解決**しコード分岐に散らさない。
  - `providers/base.py`＝アダプタ IF（`chat(messages, model, params) -> text/usage`）。
  - `providers/openai_compat.py`＝Ollama/vLLM/llama.cpp/OpenAI を1本で（`base_url`・`api_key`・`model` の差だけ）。
  - `providers/anthropic.py`＝**将来**。Claude 等（例：`claude-opus-4-8`／`claude-sonnet-4-6`／`claude-haiku-4-5`）。
- 出力の構造化＝可能な限り **JSON Schema 制約**（vLLM/Ollama の structured output・OpenAI の response_format）で受け、ドメインでのパース事故を減らす。

### 3.2 プロバイダ差し替えの単位

- **provider**（どのサーバー/API か）と **model**（そのサーバー上の重み）を分離し、両者を **1つの論理モデルキー**（例 `qwen3-swallow-32b`）に束ねて registry で管理。機能側・UI はキーだけを扱う。
- 環境差（dev/prod）は registry の設定差で吸収＝**アプリ無改修で dev=Ollama、prod=vLLM/クラウドに切替**。同じキー `qwen3-swallow-32b` が dev では Ollama の小型、prod では vLLM の 32B を指す、といった対応も設定で表せる。

### 3.3 `task_type` 一覧（初期）

| task_type | 用途（由来機能） | 想定モデル階層 | 実行方式(既定) |
| --- | --- | --- | --- |
| `strategy_align_semantic` | 意味的整合スコア＋根拠文（経営資料整合 Phase2） | 軽〜中量 | queued-worker |
| `iso_generate` | ISO56001 意図/方針/戦略のたたき台生成 | **高品質**（日本語特化） | queued-worker |
| `info_summarize` | 情報インプットの LLM 要約（Phase2） | 軽量 | queued-worker |
| `info_contradiction` | 情報の矛盾/反証の自動検出（Phase2） | 中量 | queued-worker |
| `concept_premise_check` | コンセプト前提の自動検証（Phase2） | 中量 | queued-worker |

**初版で最初に通す task_type（決定・2026-09-29）＝`info_summarize`**。理由＝入力が単一本文で完結・出力が短文で検証容易・Phase1 抽出型要約という比較基準/フォールバックがある・失敗しても補助情報で影響小・軽量モデルで最小スペック実証向き＝**基盤の縦1本を最小リスクで通せる**。`iso_generate`（価値最大・重い）は2本目に載せる。

### 3.4 機能側からの LLM 指定（論理モデルキー・2026-09-29 追加要件）

**要件（2026-09-29）＝ローカルLLMを使う機能側で、どの LLM を使うか指定できる**。中央の task_type 既定（§3.3）を保ったまま、**呼び出し側が上書きできる口**を足す。抽象化を壊さないため、指定は **registry に登録された論理モデルキー**で行う（provider/base_url を機能側に露出しない）。

- **指定の口**＝
  - コード（機能ドメイン）＝`enqueue_ai_job(task_type, input, *, model=<論理キー>|None)` / `gateway.complete(..., model=...)`。
  - API＝`POST /ai-jobs`（及び各機能の enqueue）に任意項目 `model`（論理キー）。
  - UI（機能ごと）＝その機能の画面に**モデル選択ピッカー**を置く。候補は `GET /ai-models?task_type=...`（**その会社で有効な**論理キー＝表示名/説明/`external`/`billing`(free/paid)/既定フラグ）で供給。
- **解決の優先順位**（高→低）＝**① 呼び出しの明示 `model`（機能/ユーザー指定）＞ ② task_type の既定キー（§3.3・設定）＞ ③ グローバル既定**。指定が無ければ従来どおり task_type 既定で動く（後方互換）。
- **ガードレール**（application 層で検証）＝
  - 指定キーが registry に存在し `enabled` であること（不正キーは 422）。
  - **会社で有効**＝そのキーが会社単位でON（§4.2）であること。OFF のキーは選択不可（422）。
  - **データ主権**＝`external=true` のキーは、その task_type / テナントのポリシーで許可されている場合のみ選択可（機微 task で外部モデルを勝手に選べない・§10）。不許可なら 422（明示コード）。
  - **課金**＝`billing=paid` のキーは、会社がON済み（＝課金合意済み・§4.2）かつ予算上限内（設定時）でのみ実行。上限超過は 422/保留。
  - capability 検査（例：JSON Schema 構造化出力が必要な task に非対応キーを弾く）。
- **記録**＝`ai_jobs.requested_model`（機能/ユーザーが指定した論理キー・NULL=既定使用）を保存し、**実際に実行した** `provider`/`model`（物理）＋利用量/コスト（§4.2・§6）を別途監査記録。「何を指定し・何で実行し・いくら掛かったか」を追える。
- **なぜキー方式**＝機能側が provider/base_url/量子化などの物理を知ると抽象化（§3）が崩れ dev/prod 差で壊れる。論理キーなら**機能側は“どの LLM か”だけを選び**、物理は registry（インフラ設定）に閉じる。**なぜ既定を残す**＝全機能に指定を強制すると呼び出しが煩雑。既定＋上書きが最小の変更で両立する。
- **UIピッカーは初版から作り込む**（2026-09-29）＝`info_summarize` を含む対象機能に**最初からピッカーを常設**する。**候補が1つ（無料ローカルのみ有効）なら1件だけ表示**され、会社が有料モデルをON（§4.2）にすると候補が増える。**なぜ**＝会社ON/OFFで候補数が動的に変わる前提なので、後付けより最初から `GET /ai-models` 駆動のピッカーを置く方が手戻りが無い（候補1でも同じ部品でよい）。既定キーを初期選択にする。

## 4. LLM 選定 — 両建て（`task_type` で使い分け）

**決定（2026-09-29）＝両建て**。軽量タスクは多言語 Apache 系、高品質生成（ISO 文書等）は国産日本語特化、と `task_type` 単位でモデルを割り当てる（割り当ては §3.1 routing 設定）。**なぜ**＝「日本語に強い」を満たしつつ、頻度の高い軽量処理は最小スペックで速く安く回すため（品質とコストのバランスを task 粒度で最適化できる）。

| 用途 | 第一候補 | ライセンス | 位置づけ・理由 |
| --- | --- | --- | --- |
| **ローカル開発（軽量）** | Qwen3 小型（〜4B級）を Ollama で | Apache 2.0 | 最も手軽・日本語も実用・CJK で Llama 系に勝る。dev は軽量でよい要件に合致。 |
| **本番・軽量/中量タスク** | Qwen3（中量/MoE）を vLLM で | Apache 2.0 | 商用制限なし・ツール成熟・スループット確保。多言語で扱いやすい。 |
| **本番・高品質日本語生成** | **Qwen3 Swallow**〔東京科学大/AIST・2026-02・Apache 2.0〕を第一候補 | Apache 2.0 | 日本語 MT-Bench 8B=7.54 / 32B-A3B=7.82 で GPT-4o(7.29) 超え・同規模SOTA。**Qwen3ベース＝軽量層の素の Qwen3 と同ファミリ**。ISO 文書生成など日本語品質が効くタスクに割当。 |

- **推奨＝高品質層に Qwen3 Swallow・軽量層に素の Qwen3**（両方 Apache 2.0）。**なぜ**＝両建てを**同一ファミリ（Qwen3系）に寄せられ**、トークナイザ・ランタイム・量子化手順が共通＝「両建て」でも**運用系統が実質1つ**（ゲートウェイは `model` を差し替えるだけ）。
- **対抗**＝純国産・データ来歴最重視なら Sarashina2.2〔SB Intuitions・**MIT**・0.5/1/3B の軽量版あり〕。自然な日本語生成重視なら CyberAgentLM3（CALM3-22B・Apache 2.0）。
- **第一候補から外す**＝PLaMo 2（PLaMo Community License＝独自条項）・ELYZA（Llama コミュニティライセンス＝MAU制限等）。**なぜ**＝Apache/MIT より商用制約があり「商用可・無料を法務リスク最小」の条件で劣後。
- 実行ランタイム＝**dev は Ollama**（0.32 系で単発デコードは vLLM 並み）、**prod でスループットが要れば vLLM**。いずれも OpenAI 互換＝**ゲートウェイのおかげで載せ替えはアプリ無改修**（§3.2）。
- モデルの最終選定・量子化・必要 VRAM は [本番デプロイ要件](../本番デプロイ要件.md) 側でベンチの上で確定（本書は「両建て＋差し替え可能」の枠組みまで）。**Apache/MIT の中から実測1位**で始められる。

### 4.1 論理モデルキー registry（初期・§3.4 が参照）

機能側（§3.4）が指定に使う**論理キー**の初期登録。物理（provider/base_url/実モデル名）は環境設定で解決し、キーは dev/prod で同一に保つ。

| 論理キー | 位置づけ | dev（Ollama） | prod（vLLM） | external | billing | 会社既定 | 主な既定割当 task_type |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `qwen3-light` | 軽量・高速（自社ホスト） | Qwen3 小型（〜4B級） | Qwen3 中量 | false | **free** | **ON（常時）** | `info_summarize`（初版既定） |
| `qwen3-swallow` | 高品質日本語生成（**決定・2026-09-29**・自社ホスト） | Qwen3 Swallow 8B | Qwen3 Swallow 32B(-A3B) | false | **free** | ON | `iso_generate`（2本目） |
| （将来）`claude-sonnet` 等 | 外部クラウド高精度 | — | Anthropic API | true | **paid** | 既定OFF（会社がON＝課金合意） | opt-in の task のみ（§3.4/§4.2/§10） |

- **決定（2026-09-29）**＝`iso_generate` 等の高品質日本語生成は既定 **`qwen3-swallow`**。軽量層 `qwen3-light` と**同ファミリ（Qwen3系）**なので運用系統は実質1つ（§4 推奨のとおり）。
- 機能側は上表の**キー名だけ**を `model` に渡す（§3.4）。物理の 8B/32B・Ollama/vLLM 差は registry 設定に閉じる。
- **`billing`**＝`free`（自社ホストのローカルLLM＝追加課金なし）/`paid`（外部有料API等＝利用量に応じ課金・§4.2）。自社ホストは電力/GPU の固定費だが**従量課金は発生しない**ので free 扱い。
- registry は**システム全体のカタログ**＝どの論理キーが存在し得るか（provider/物理/pricing/capabilities）。**会社ごとに実際に使えるか**は §4.2 の ON/OFF で決まる（2階層）。

### 4.2 会社単位のモデル有効化・課金（2026-09-29 追加要件）

**要件（2026-09-29）＝会社単位で使用できる LLM を ON/OFF したい。有料の LLM/API を ON にした時は課金したい**。→ **カタログ（§4.1 registry・システム全体）× 会社の有効化（ON/OFF）** の2階層＋**利用量メータリング**で実現する。

- **2階層**＝
  - **カタログ（registry・§4.1）**＝プラットフォームが提供し得る全キー。`system_admin`／設定で管理（新規プロバイダ追加はここ）。
  - **会社の有効化（`company_ai_model_settings`・§6）**＝会社アカウント管理者（`company_account_admin`）が、カタログのうち自社で使うキーを **ON/OFF**。`GET /ai-models`・§3.4 のガードレール・ピッカー候補は**この有効集合**で決まる。
- **既定**＝`billing=free` の自社ホスト（`qwen3-light`/`qwen3-swallow`）は既定 ON、`billing=paid` の外部キーは**既定 OFF**。**なぜ**＝勝手に課金が始まらない安全側。ON にする操作＝課金への合意（UI で明示・確認ダイアログ）。
- **課金方式＝A（内部メータリングのみ・初版／決定 2026-09-29）**＝初版は**利用量・コストの記録＋会社別可視化＋予算上限**まで。**実請求/決済連携（請求書・決済代行API）は行わない seam（将来）**。**なぜ A**＝実決済は契約/経理要件が絡み範囲が大きい。まず「使った量と費用が見える・上限で止められる」を確立する。
  - **B（原価パススルー）/C（マークアップ・定額枠＋従量）の算出根拠となる使用量は恒久保持**（決定 2026-09-29）。**なぜ**＝将来 B/C を選べるように、後から再計算できる**生の基礎データ**を今から欠かさず残す。具体的には **`ai_usage_events`（追記専用台帳・§6.3）** に実行1回ごとに保存する：
    - **生の使用量**＝入力/出力トークン（＋あれば cached/reasoning トークン・リクエスト数など課金単位）。
    - **実行時点の単価スナップショット**＝`registry.pricing`（入出力単価・通貨・`pricing_version`）を**その時の値で凍結**。**なぜスナップショット**＝カタログ単価は後で変わるので、生トークンだけだと過去の原価を復元できない。
    - 集計軸＝会社 / モデルキー / provider・物理モデル / task_type / 依頼者 / 期間（月）。
    - **A の `cost_micros` は「その時の単価×トークン」の便宜値**。B は同台帳の原価そのまま、C は保持した**単価前の使用量**にマークアップ/定額枠を後付け適用＝**いずれも台帳から再計算可能**。
  - **保持ポリシー**＝`ai_usage_events` は**論理削除しない／ジョブ（`ai_jobs`）が論理削除・整理されても消さない**（課金基礎は独立に残す・§6.3）。
- **予算上限（推奨）**＝会社ごとに月次の**コスト上限（予算）**を設定可能に。上限到達で `paid` キーの enqueue を保留/拒否（§3.4 ガードレール）。**なぜ**＝最小スペック運用・想定外の課金暴走を止める安全弁。無料ローカルキーは上限の対象外（止めない）。
- **権限**＝ON/OFF・予算設定は `company_account_admin`。利用量/コストの閲覧も管理者（一般ユーザーはピッカーで「有料」表示を見るのみ）。

## 5. AIジョブ実行基盤

### 5.1 状態機械（実行方式に依らず共通）

```
queued ──(取得)──▶ running ──(成功)──▶ succeeded
   │                  │
   │(利用者キャンセル)  └─(失敗・リトライ上限)──▶ failed
   ▼
canceled
```

- **状態管理は実行方式に依らず共通**＝画面（§9）と通知（§8）は「今いくつ待ち/実行中/完了/失敗」だけを見る。**なぜ分離するか**＝§5.2。

### 5.2 実行方式（dispatcher）の分離 ＝ 将来のクラウド連携でポーリング不要にする

**ユーザー指摘（2026-09-29）＝将来クラウド AI と連携する時はポーリングが不要になり得る**。これに備え、**「ジョブの状態管理（DB＋画面＋通知）」と「実行方式（どうやって running にし、いつ推論を走らせるか）」を分離**し、`task_type`／provider ごとに実行方式を選べるようにする。

| 実行方式 | 対象 | 仕組み | ポーリング |
| --- | --- | --- | --- |
| **(a) queued-worker** | ローカル/オンプレ・最小スペック（初版の既定） | `ai_jobs` を **既存 outbox パターン踏襲**でポーリングし、`FOR UPDATE SKIP LOCKED` で N 件だけ `running` にして順次推論。compose `workers` プロファイルに **`llm_worker` を3本目**として追加。 | あり（N 件で背圧をかけるのが目的） |
| **(b) immediate / async-callback** | 高速な外部生成AI API（将来） | enqueue 時に**その場でディスパッチ**（同期 or 短命 async）。外部が速い/自前でスロットリング不要なら**ポーリング背圧は不要**。Webhook/コールバックがあるプロバイダは完了通知で `succeeded` に。 | **不要** |

- **共通点**＝どちらの方式でも `ai_jobs` 行は必ず作る（画面・通知・監査の一貫性のため）。違うのは「running への遷移トリガと同時実行の背圧をどこが持つか」だけ。
- **切替単位**＝`routing` に `execution=queued|immediate` を持たせ、provider の性質で選ぶ（ローカルLLM=queued、クラウド高速API=immediate）。**なぜこの粒度**＝ローカルは最小スペックで N 件制御が必須、外部APIは自前キューイングがむしろ遅延要因になり得るため、同じジョブ台帳のまま実行戦略だけ差し替えたい。
- **不採用**＝「常にポーリングワーカー経由」（**なぜ**＝外部高速APIまでポーリング間隔ぶんの遅延と常駐ワーカーを強いるのは無駄）。「外部APIはジョブ台帳を通さず直叩き」（**なぜ**＝画面・通知・監査の一貫性が崩れる）。

### 5.3 同時実行 N（最小スペック前提）

- 既定 **N=1**（最小スペックで1件ずつ）。env（例 `LLM_WORKER_CONCURRENCY`）で増やせる。
- 取り出し＝`status='queued'` を `created_at` 昇順、`FOR UPDATE SKIP LOCKED LIMIT N`（多重ワーカーでも二重取得しない）。
- 背圧＝待ち行列は `ai_jobs(queued)` の件数そのもの。画面（§9）にそのまま出す。

### 5.4 タイムアウト・リトライ・冪等

- **タイムアウト**＝ジョブ単位（`task_type` 既定＋上限）。超過は `failed`（理由 `timeout`）。
- **リトライ**＝`attempts` を持ち、上限まで再 `queued`（`mail_outbox` と同発想）。恒久失敗（入力不正等）は即 `failed`。
- **冪等**＝enqueue に既存 `Idempotency-Key`（[API設計 README](../API設計/README.md) §1.9）を流用し、同一操作の二重投入を防ぐ。
- **孤児回収**＝`running` のまま一定時間更新が無い行（ワーカー異常終了）は再 `queued`（`started_at` と heartbeat で判定）。

### 5.5 割り込みキャンセル（採用・2026-09-29）

`queued` だけでなく **`running` 中のジョブも中断できる**（採用）。方式は **協調キャンセル（cooperative cancellation）**。

- `POST /ai-jobs/{id}/cancel` が **キャンセル要求フラグ**を立てる（`ai_jobs.cancel_requested=true`＋実行中ワーカーへ Redis Pub/Sub で即通知）。
- ワーカーは**トークン受信ループの各ステップ（§5.6 のストリーム）でフラグを確認**し、立っていれば **LLM への HTTP 接続を abort**（Ollama/vLLM は接続切断で生成停止）→ `status=canceled`・`finished_at` を記録。
- `queued`（未着手）は即 `canceled`。
- **なぜフラグ方式（協調）**＝推論はストリームなので「区切りで安全に抜ける」のが確実。ワーカープロセスの kill は**他の同時ジョブを巻き込む**ため不採用。強制中断ではなく「次のトークン境界で止める」ので、最悪でも数トークン分の猶予で停止する。

### 5.6 進捗表示（採用・2026-09-29）

進捗を出す（採用）。OpenAI 互換サーバーは `stream:true`（SSE）で**トークンを逐次返せる**ため、ワーカーがストリームを受けながら進捗イベントを **Redis Pub/Sub → WebSocket → 画面**へ流す（既存リアルタイム基盤を再利用・§8）。「正確な %」は総トークン数が事前不明なので、次の**併用**で出す。

| 方式 | 仕組み | 精度 | 向き |
| --- | --- | --- | --- |
| **① 段階（ステージ）進捗**（主軸） | 生成を**複数サブ呼び出しに分割**し「3/5 セクション完了」で出す（例：`iso_generate` を 意図→方針→戦略→目標→重点領域 の5コールに割る） | 正確・意味がある | 構造化生成（ISO文書等） |
| **② トークン比の概算** | `生成済みトークン / max_tokens` を % 換算 | 粗い（早期終了でズレる＝"進んでる感"用） | 単発の長文生成 |
| **③ 部分テキストのライブプレビュー** | ストリーム途中経過のテキストをそのまま画面へ | %でないが体験良好 | 要約・チャット的生成 |

- **推奨＝構造化タスクは①を主軸**・補助に②・任意で③。**なぜ①**＝正確なだけでなく、**セクション単位で JSON Schema 制約をかけられる**（1コール=1フィールド）ので §3.1 の構造化出力・検証しやすさと噛み合う。①はコール回数が増え総時間はやや延びるが、数分許容なので問題にしない。
- **配線**＝`worker(stream受信) → 進捗イベント{job_id, phase, partial?} を publish → Redis Pub/Sub(ai_jobs:{user_id}) → WebSocket → 画面が進捗バー/プレビュー更新`。併せて `ai_jobs.progress` 列に最新値を書く（**なぜ**＝再読込やWS取りこぼし時も画面で復元できる＝画面が状態の正）。
- 進捗ストリームは §5.5 のキャンセル判定と**同じループ**に乗る（相性が良い）。

## 6. データモデル案（会社DB・既存規約準拠）

### 6.1 `ai_jobs`（新規・会社DB）

**なぜ会社DB**＝入力/出力に会社の業務データ（アイデア・経営資料等）が載るため、既存のテナント物理分離と同じ場所に置くのが自然（管理DBには置かない）。

| 物理名 | 論理名 | 型 | 制約/既定 | 説明 |
| --- | --- | --- | --- | --- |
| `id` | ID | uuid | PK | ジョブID（通知 `ref` の対象にもなる） |
| `task_type` | タスク種別 | text | NOT NULL | `iso_generate` 等（論理 enum・§3.3） |
| `status` | 状態 | text | NOT NULL, default `queued` | `queued`/`running`/`succeeded`/`failed`/`canceled` |
| `execution` | 実行方式 | text | NOT NULL, default `queued` | `queued`（ワーカー）/`immediate`（外部即時）＝§5.2 |
| `requested_by_id` | 依頼者 | uuid | FK→users | 完了通知の宛先 |
| `input` | 入力 | jsonb | NOT NULL | プロンプト材料。**機微本文は極力"参照(ID)"で持ち本文の複製を避ける**（§10） |
| `result` | 出力 | jsonb | NULL可 | 構造化結果（成功時） |
| `error` | 失敗理由 | jsonb | NULL可 | `{code, detail}`（RFC7807 風・§1.7 と整合） |
| `requested_model` | 指定モデル | text | NULL可 | 機能/ユーザーが指定した**論理モデルキー**（§3.4）。NULL=task_type 既定を使用 |
| `provider` | 実行provider | text | NULL可 | 実際に使った provider（物理・監査） |
| `model` | 実行model | text | NULL可 | 実際に使ったモデル名（物理・監査）。`requested_model`（論理）を registry で解決した結果 |
| `input_tokens` | 入力トークン | int | NULL可 | LLM usage（課金メータリング・§4.2） |
| `output_tokens` | 出力トークン | int | NULL可 | LLM usage（同上） |
| `cost_micros` | コスト | bigint | NULL可 | 概算コスト（通貨最小単位×10^-6 等の整数保持）。`billing=paid` のみ非0 |
| `attempts` | 試行回数 | int | NOT NULL, default 0 | リトライ制御 |
| `progress` | 進捗 | jsonb | NULL可 | `{phase:"3/5", ratio:0.6, partial?}`＝§5.6。再読込/WS取りこぼし時の復元源 |
| `cancel_requested` | キャンセル要求 | boolean | NOT NULL, default false | §5.5 協調キャンセルのフラグ |
| `priority` | 優先度 | int | NOT NULL, default 0 | 取り出し順の将来拡張余地（既定は created_at 順） |
| `ref_idea_id` | 遷移先(アイデア) | uuid | NULL可, FK | 完了→該当画面へ（多態 ref・`notifications` と同型） |
| `ref_quest_id` | 遷移先(クエスト) | uuid | NULL可, FK | 〃 |
| `ref_strategy_document_id` | 遷移先(経営資料) | uuid | NULL可, FK | 〃 |
| `ref_info_item_id` | 遷移先(情報) | uuid | NULL可, FK | 〃（対象機能の追加に応じて ref を増やす） |
| `started_at` | 開始時刻 | timestamptz | NULL可 | running 遷移時刻（孤児回収に使用） |
| `finished_at` | 終了時刻 | timestamptz | NULL可 | 完了/失敗時刻 |
| （共通監査6列） | | | | `created_at/by/program`・`updated_at/by/program`（既存規約） |
| （論理削除2列） | | | | `deleted_at`・`deleted_by_id`（既存規約） |

- インデックス＝`(status, created_at)`（取り出し用）・`(requested_by_id, created_at desc)`（画面一覧用）。
- **outbox 併存の是非**＝初版は `ai_jobs` 自身をポーリング対象にする（`mail_outbox` と同様に「テーブル＝キュー」）。別 outbox は設けない（**なぜ**＝二重管理を避け、状態機械を1テーブルに集約して画面と一致させる）。

### 6.2 `company_ai_model_settings`（新規・会社DB・§4.2 会社ON/OFF）

会社アカウント管理者が、カタログ（§4.1 registry）のうち自社で使うモデルを ON/OFF・予算設定する台帳。

| 物理名 | 論理名 | 型 | 制約/既定 | 説明 |
| --- | --- | --- | --- | --- |
| `id` | ID | uuid | PK | |
| `model_key` | 論理モデルキー | text | NOT NULL, UNIQUE | registry（§4.1）のキー |
| `enabled` | 有効 | boolean | NOT NULL, default false | 会社での ON/OFF（`free` は初期 ON・`paid` は初期 OFF＝§4.2） |
| `monthly_budget_micros` | 月次予算上限 | bigint | NULL可 | `paid` の暴走防止（NULL=無制限・§4.2）。到達で保留/拒否 |
| `enabled_by_id` | 変更者 | uuid | FK→users | 課金合意の記録（誰が ON にしたか） |
| `enabled_at` | 変更時刻 | timestamptz | NULL可 | 同上 |
| （共通監査6列） | | | | 既存規約 |

- **なぜテーブルで持つ**＝会社ごとに違い・監査（誰がいつ ON＝課金に合意したか）が要るため。未登録キー＝registry の既定（`free`=ON/`paid`=OFF）にフォールバック。
- 参照＝`GET /ai-models`・§3.4 ガードレール・§4.2 予算判定がこれを読む。

### 6.3 `ai_usage_events`（新規・会社DB・追記専用・§4.2 課金基礎の恒久保持）

課金方式は初版 **A（内部メータリングのみ）** だが、**将来の B/C 算出根拠となる使用量は恒久保持**（決定 2026-09-29）。実行1回ごとに**単価スナップショット付き**で1行 append する台帳。**`ai_jobs` の tokens/cost は便宜の denormalize で、課金基礎の正はこの台帳**（ジョブが論理削除・整理されても残す）。

| 物理名 | 論理名 | 型 | 制約/既定 | 説明 |
| --- | --- | --- | --- | --- |
| `id` | ID | uuid | PK | |
| `job_id` | ジョブ | uuid | FK→ai_jobs（NULL可） | 由来ジョブ（ジョブ削除後も本行は残す） |
| `occurred_at` | 実行時刻 | timestamptz | NOT NULL | |
| `period_ym` | 対象月 | text/int | NOT NULL | `202609` 等（集計/予算判定キー） |
| `model_key` | 論理キー | text | NOT NULL | registry（§4.1） |
| `provider` / `model` | 物理 | text | NOT NULL | 実行した provider・実モデル名 |
| `task_type` | タスク種別 | text | NOT NULL | 集計軸 |
| `requested_by_id` | 依頼者 | uuid | FK→users | 集計軸（部門別等の将来余地） |
| `billing` | 課金区分 | text | NOT NULL | `free`/`paid`（スナップショット） |
| `input_tokens` | 入力トークン | int | NOT NULL, default 0 | **生の使用量**（B/C の基礎） |
| `output_tokens` | 出力トークン | int | NOT NULL, default 0 | 同上 |
| `extra_units` | 追加課金単位 | jsonb | NULL可 | cached/reasoning トークン・リクエスト数・画像枚数など provider 固有単位 |
| `rate_snapshot` | 単価スナップショット | jsonb | NOT NULL | 実行時点の `{input_rate, output_rate, currency, pricing_version}`（**後から原価復元可能に**） |
| `cost_micros` | 概算原価 | bigint | NOT NULL, default 0 | `rate_snapshot × 使用量`＝A の可視化/予算判定値。`free`=0 |
| `created_at` | 監査 | timestamptz | NOT NULL | 追記のみ（更新/論理削除しない） |

- **free も記録**＝`free` は `cost_micros=0`・`rate 0` でも使用量（トークン）は残す。**なぜ**＝将来 C（定額枠＋従量）でローカル利用も課金対象にし得るため、基礎は全実行で欠かさない。
- **A/B/C の関係**＝A＝`cost_micros` を会社×`period_ym` で SUM して可視化・予算判定。B＝同 `cost_micros`（＝原価）をそのまま請求元に。C＝保持した**使用量＋`rate_snapshot`前の生値**にマークアップ/定額枠を後付け＝**いずれも本台帳から再計算**（アプリ改修だけで方式変更でき、過去分も遡及計算可能）。
- **集計**＝会社×モデル×月は本台帳の read 集計（I ダッシュボード同方針）。規模が出たら月次ロールアップ（キャッシュ）を追加（実装時判断）。
- **予算判定**＝`GET`/enqueue 時に当月 `SUM(cost_micros)` と `company_ai_model_settings.monthly_budget_micros` を比較（§3.4 ガードレール・§4.2）。

## 7. API 設計案（[API設計 README](../API設計/README.md) 準拠）

| メソッド/パス | 用途 | 備考 |
| --- | --- | --- |
| `POST /ai-jobs` | ジョブ投入（enqueue） | 通常は**各機能側のエンドポイントが内部で enqueue** し、ジョブID を返す。汎用口は管理/デバッグ用。任意項目 **`model`＝論理モデルキー**（§3.4・省略時は task_type 既定）。`Idempotency-Key`（§1.9）必須。 |
| `GET /ai-models` | 選択可能なモデル一覧 | `?task_type=` で、**その会社で有効な**論理キー（`key`・表示名・説明・`external`・`billing`(free/paid)・既定フラグ）を返す。§3.4 のUIピッカー供給源。会社ON/OFF（§4.2）＋ポリシー＋`enabled` で絞り込み済＝**候補1件のこともある**。 |
| `GET /ai-jobs` | 自分のジョブ一覧 | DataTable クエリ契約（§1.8.1）。`status`/`task_type` フィルタ・新着降順。AI処理状況画面の主データ。 |
| `GET /ai-jobs/summary` | 待ち/実行中/完了の件数 | ヘッダやバッジ用の軽量集計（`notifications/unread-count` と同発想）。 |
| `GET /ai-jobs/{id}` | ジョブ詳細 | 進捗（`progress`）/結果/エラー/遷移先 ref/利用量。 |
| `POST /ai-jobs/{id}/cancel` | キャンセル | `queued` は即 `canceled`／`running` は**協調キャンセル**（§5.5）。 |
| **管理**（`company_account_admin`）| | §4.2 会社ON/OFF・課金 |
| `GET /admin/ai-models` | カタログ＋自社設定一覧 | registry 全キー＋`enabled`/`billing`/`monthly_budget_micros`/現在の月次利用・コスト。 |
| `PATCH /admin/ai-models/{key}` | ON/OFF・予算変更 | `paid` を ON＝**課金合意**（確認ダイアログ）。`enabled_by`/`enabled_at` 記録。 |
| `GET /admin/ai-usage` | 会社の利用量/コスト | 会社×モデル×月の集計（§6.3）。請求元数値の可視化。 |

- 認可＝依頼者本人＋（運用向けに）システム管理者。他人のジョブは見えない。ON/OFF・予算・利用量は `company_account_admin`（[コーディング規約](../規約/コーディング規約.md) §2）。
- **各機能の enqueue は「同期で結果を待たない」**＝POST は即 202 相当でジョブID を返し、UI はジョブ画面/通知で完了を追う（初版はバックグラウンド専用の要件に合致）。

## 8. 通知・リアルタイム（既存を再利用）

- **完了通知**＝既存 `notifications` に `type='ai_task_done'`（失敗は `ai_task_failed`）を追加し、`ref_*` に遷移先を入れて1件作るだけ。SC-02 通知一覧・既読/未読・ベル未読数は**無改修で流用**。
- **本文**＝既存 catalog に `ai_task_done` の文言を追加（受信者 locale でレンダリング）。
- **ライブ更新**＝既存 WebSocket（[API設計 README](../API設計/README.md) §1.12・Redis Pub/Sub）に `ai_jobs:{user_id}` トピックを追加し、`queued→running→succeeded` の遷移で件数と対象を push。AI処理状況画面（§9）はこれで即時更新。
- 信頼性＝通知は既存同様 post-commit best-effort（at-most-once）。**画面（§9）が状態の正**なので、通知取りこぼしがあっても画面で回復できる。

## 9. クライアント画面

### 9.1 「AI処理状況」画面（新規・SC番号は採番後）

- **1画面**で「処理待ち件数 / 実行中 / 直近完了・失敗」を提示。土台は**新規UIを作らず**、SC-02 通知一覧＋共有 **DataTable（サーバー委譲・§1.8）** を踏襲。
- 列＝タスク種別（日本語ラベル＋アイコン）・状態（バッジ）・**進捗（実行中は進捗バー＝§5.6 の `progress`）**・依頼時刻・完了時刻・対象。状態フィルタ（待ち/実行中/完了/失敗）。
- **実行中の操作**＝行から**キャンセル**（§5.5）。実行中はライブで進捗バー/（任意で）部分プレビューが伸びる。
- **完了選択→遷移**＝行の `ref_*` から該当画面へ（通知クリックと同じ動線）。「内容を参照する」導線＝完了ジョブ→生成結果を反映した対象画面へ。
- **ライブ**＝WebSocket `ai_jobs:{user_id}` で待ち件数/実行中をリアルタイム反映（ポーリング不要。§5.2(b) の外部即時実行でも同じ画面で見える）。
- 入口＝ヘッダのベル近傍にバッジ（`GET /ai-jobs/summary` の実行中/待ち件数）を置く案（詳細はデザイン標準に沿って画面設計で確定）。

### 9.2 機能内のモデル選択ピッカー（初版から作り込む・2026-09-29）

- LLM を使う各機能（初版は `info_summarize` の画面）に**モデル選択ピッカーを最初から常設**する。候補は `GET /ai-models?task_type=`（会社で有効なキー・§4.2）で供給し、既定キーを初期選択。
- **候補が1つ（無料ローカルのみ有効）なら1件だけ表示**され、会社が有料モデルを ON にすると候補が増える。有料キーは「有料」バッジ（`billing=paid`）を表示。
- **なぜ初版から**＝会社 ON/OFF で候補数が動的に変わる前提のため、`GET /ai-models` 駆動のピッカーを最初から置く（候補1でも同じ部品）＝後付けの手戻りを避ける（§3.4）。デザイン標準に沿った標準セレクトで実装。

### 9.3 管理画面「会社のLLM設定」（新規・`company_account_admin`・§4.2）

- カタログ（§4.1）を一覧し、モデルごとに **ON/OFF トグル**・**月次予算上限**を設定。土台は既存の管理系一覧/設定UIを踏襲（新規UIを作らない）。
- **有料（`paid`）を ON にする操作＝課金合意**なので**確認ダイアログ**（§4.2・デザイン標準の確認モーダル）。誰が ON にしたか（`enabled_by`）を記録。
- **利用量/コストの可視化**＝会社×モデル×月の利用トークン・概算コスト（`GET /admin/ai-usage`）。予算に対する消化率も表示。

## 10. セキュリティ・データ主権

- **既定はローカル/オンプレで完結**＝機微な経営資料・アイデアを外部に出さない（[経営資料整合 設計](経営資料整合・自動関連付け_設計.md) §2 の「機微資料は既定で外部送信しない」と整合）。
- **外部（クラウドAI）送信は opt-in ゲート**＝`external=true` のモデルは、**会社での ON/OFF（§4.2）＋ task_type ポリシー**に従う（既定 OFF）。送信範囲を明示し、routing 設定で「この task は external 禁止」も表現できる。有料 ON＝課金合意（§4.2）と同じ操作で外部送信も解禁されるため、**課金合意とデータ主権の解禁が同じ管理者操作に集約**される。
- **`input` は本文複製を最小化**＝可能な限り参照(ID)で持ち、ワーカーが実行直前に会社DBから読み出してプロンプト化（**なぜ**＝ジョブ台帳への機微本文の滞留・漏洩面を減らす）。
- **プロンプトインジェクション**＝外部由来テキスト（情報インプット等）を材料にする task は、system 指示と外部本文を明確に分離し、出力を JSON Schema で受ける（§3.1）。
- **監査**＝`provider`/`model`/`attempts` と入出力の要約をログ（[本番デプロイ要件](../本番デプロイ要件.md) のシステムログ機構に相関ID付きで）。

## 11. 段階導入（Phase 切り）

| | Phase 1（初版・ローカル専用・バックグラウンド） | Phase 2（拡張） |
| --- | --- | --- |
| ゲートウェイ | `openai_compat` アダプタ1本＋**論理モデルキー registry＋機能側 `model` 指定**（§3.4） | `anthropic` 等クラウドアダプタ追加 |
| 実行方式 | queued-worker（N=1・ポーリング） | 外部高速APIは immediate（ポーリング不要）§5.2 |
| task_type | `info_summarize`（決定）で縦に通す | `iso_generate` ほか残タスクを順次 |
| 画面/通知 | AI処理状況画面＋`ai_task_done` 通知＋**割り込みキャンセル（§5.5）＋進捗表示（§5.6）＋機能内モデルピッカー（§9.2）** | 優先度制御・部分プレビューの高度化 |
| 会社設定/課金 | **会社ON/OFF（free既定ON・paid既定OFF）＋課金方式A（メータリングのみ）＋予算上限＋管理画面（§4.2/§9.3）＋B/C基礎データ恒久保持（`ai_usage_events`・§6.3）** | B/C 料金ポリシー実装・請求/決済連携（seam）・外部paidキー解禁 |
| データ主権 | ローカル完結（外部送信なし＝paid/external 既定OFF） | external opt-in 解禁（会社ON＝課金合意と同操作・§10） |

- **推奨＝Phase 1 で1 task_type をエンドツーエンドに通す**（enqueue→worker→gateway→Ollama→result→通知→画面遷移）。**なぜ**＝基盤の縦の1本を先に確立すれば、以降の task 追加は routing とプロンプトだけで増やせる（[backend接続は1画面単位ループ]の発想を task 単位に適用）。

## 12. 未決事項・次段の落とし込み

- **決定済（2026-09-29）**＝
  - (1) 初版に最初に通す task_type＝**`info_summarize`**（§3.3）。
  - (2) prod 高品質日本語生成の第一候補＝**Qwen3 Swallow（Apache 2.0）**・軽量層は素の Qwen3（§4・§4.1）。VRAM/速度/精度の実測確定は [本番デプロイ要件](../本番デプロイ要件.md) 側だが、キー `qwen3-swallow` として先行登録。
  - (3) `running` 割り込みキャンセル＝**採用**（§5.5 協調キャンセル）。
  - (4) 進捗表示＝**採用**（§5.6 段階進捗を主軸＋トークン比＋部分プレビュー）。
  - (5) **機能側からの LLM 指定**＝**採用**（§3.4 論理モデルキー・呼び出し上書き・`GET /ai-models`・`ai_jobs.requested_model`）。
  - (6) **モデルピッカーUIは初版から作り込む**＝候補1件でも常設（§9.2）。
  - (7) **会社単位のモデル ON/OFF ＋課金**＝**採用**（§4.2）＝2階層（カタログ×会社有効化）・`company_ai_model_settings`・予算上限・管理画面（§9.3）。有料 ON＝課金合意。
  - (8) **課金方式＝A（内部メータリングのみ・実請求なし）**（§4.2）。ただし **B（原価パススルー）/C（マークアップ・定額+従量）の算出根拠となる使用量は恒久保持**＝追記専用台帳 **`ai_usage_events`**（生トークン＋**単価スナップショット**・全実行・論理削除しない・§6.3）。方式変更は後からアプリ改修だけで、過去分も遡及計算可能。
- **未決（後段でよい）**＝Sarashina2.2/CALM3 を対抗として実測比較するか・**料金ポリシー B/C の具体設計（単価表・定額枠・マークアップ率）**（§4.2・基礎データは §6.3 で確保済）・**請求/決済連携の実装**（seam・§4.2）・外部 `external=true` キーの task 別解禁ポリシー詳細（§10）。
- **次段（各正本への反映）**＝
  - [データモデル](../データモデル.md) に `ai_jobs`（`requested_model`・tokens/`cost_micros`・`progress`・`cancel_requested` 含む）・**`company_ai_model_settings`**・**`ai_usage_events`（追記専用・論理削除しない＝課金基礎）** を追記（監査/論理削除の共通列に合わせる）。
  - [API設計 README](../API設計/README.md) にドメイン節（AIジョブ）を追加（`model` 指定・`GET /ai-models`・**管理系 `GET/PATCH /admin/ai-models`・`GET /admin/ai-usage`** 含む）、`§1.x` に「非同期AIジョブ」の横断規約（enqueue は 202・状態は画面が正）を1項追記するか検討。
  - `notifications` の `type` に `ai_task_done`/`ai_task_failed` を追加（catalog 文言）。
  - 画面設計に「AI処理状況」SC・**「会社のLLM設定」管理SC**（§9.3）を採番・[画面遷移図](../画面設計/画面遷移図.md) に動線追加（進捗バー・キャンセル導線・モデルピッカー §9.2 含む）。
  - テスト＝[テスト規約](../規約/テスト規約.md) に沿い `doc/テスト/<ドメイン>_*.md` に TC 行を先出し（状態機械・N件制御・冪等・孤児回収・**協調キャンセル・進捗イベント・モデル指定の優先順位/ガードレール・会社ON/OFF・課金メータリング・予算上限**・通知/遷移）。
