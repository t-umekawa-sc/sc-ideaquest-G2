# S. AIジョブ・LLM連携（ai_jobs・LLMゲートウェイ・会社モデル設定/課金・FR-45）

> 横断規約＝[API設計 README](README.md)（§1.x＝認可 §1.8・カーソル §1.8・DataTable §1.8.1・Idempotency §1.9・リアルタイム §1.12）。データモデル＝[§5.57 ai_jobs](../データモデル.md)・[§5.58 company_ai_model_settings](../データモデル.md)・[§5.59 ai_usage_events](../データモデル.md)・[§5.24 notifications](../データモデル.md)。設計元＝[ローカルLLM連携 設計](../設計ドラフト/ローカルLLM連携_設計.md)。画面＝SC-04（AI処理状況）/SC-94（会社のLLM設定）＋各機能内のモデルピッカー。
>
> **設計の芯**＝呼び出し側（ドメイン各機能）は `task_type`＋入力を渡して**ジョブID を受け取るだけ**（同期/非同期・どの LLM かは基盤に閉じる）。**通常は各機能側の EP が内部で enqueue** し、本ドメインの汎用口（`POST /ai-jobs`）は管理/デバッグ用。**enqueue は 202 相当＝結果を同期で待たない**（初版はバックグラウンド専用）＝UI はジョブ画面/通知で完了を追う。**画面が状態の正**（通知取りこぼしがあっても画面で回復）。

## S.0 アクター・認可スコープ

| 操作 | 権限 | 補足 |
| --- | --- | --- |
| ジョブ enqueue / 一覧 / 詳細 / summary / cancel | **依頼者本人**（＋運用向けに `system_admin`） | 他人のジョブは見えない（存在秘匿の 404）。`requested_by_id` スコープ |
| 会社内 running の進捗（`GET /ai-jobs/running`・S.1a） | 認証済みユーザー | **会社内**の実行中ジョブの**進捗率のみ**を返す（**自分は除外**・匿名）。依頼者・入力・タスク種別は返さない＝占有スロットの可視化に限定（§S.7 データ主権と整合） |
| モデル一覧（`GET /ai-models`） | 認証済みユーザー | **その会社で有効な**論理キーのみ返す（会社 ON/OFF・ポリシー・`enabled` で絞込済＝候補1件のこともある） |
| 会社のモデル ON/OFF・予算（`/admin/ai-models`） | **`company_account_admin` / `system_admin`** | `paid` を ON＝**課金合意**（確認ダイアログ）＋`external` の外部送信解禁も同操作（§S.7） |
| 会社の利用量/コスト（`GET /admin/ai-usage`） | company_account_admin / system_admin | 会社×モデル×月の集計（請求元数値の可視化） |

- テナント分離＝会社 DB 内（§1.5）。クロステナントは 404。変更系は CSRF 必須（A.0）・enqueue は `Idempotency-Key`（§1.9）必須。
- **LLM 物理（provider/base_url/モデル名/量子化）は API に露出しない**＝機能側・UI が扱うのは**論理モデルキー**だけ（設計 §3.4）。

## S.1 ジョブ（enqueue / 一覧 / 詳細 / summary / cancel）

| メソッド / パス | 説明 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /ai-jobs` | ジョブ投入（汎用口＝管理/デバッグ・通常は各機能 EP が内部 enqueue） | `{task_type, input, model?, ref?}`＋`Idempotency-Key`（§1.9） | 202＋`{id, status:"queued"}`。`model`＝論理キー（省略時 task_type 既定・§S.2） |
| `GET /ai-jobs` | 自分のジョブ一覧（AI処理状況画面 SC-04 の主データ） | DataTable 契約（§1.8.1）＝`status`/`task_type`/`sort`/`page`/`per_page` | `{data:[AiJobListItem], page_info}`（新着降順） |
| `GET /ai-jobs/summary` | 待ち/実行中/完了の件数（ヘッダーバッジ用の軽量集計） | — | `{queued, running, recent_done, recent_failed}`（`notifications/unread-count` と同発想） |
| `GET /ai-jobs/running`（S.1a） | **他ユーザ含む会社内 running の進捗**（SC-04 上部＝同時実行の占有スロット可視化・決定 2026-10-02） | — | `{data:[{ratio}]}`＝**自分を除外**・**進捗率のみ**（依頼者/入力/タスク種別は出さない＝匿名・§S.0/§S.7）。`ratio`＝0..1 or null（開始直後）・処理順 |
| `GET /ai-jobs/{id}` | ジョブ詳細 | パス: `id` | `AiJobDetail`＝`{status, progress, result?, error?, requested_model?, provider?, model?, usage:{input_tokens,output_tokens,cost_micros}, ref, started_at, finished_at}` |
| `POST /ai-jobs/{id}/cancel` | キャンセル | — | 200。`queued` は即 `canceled`／`running` は**協調キャンセル**（§S.4） |

- **`input` は本文複製を最小化**＝可能な限り参照(ID)で持ち、ワーカーが実行直前に会社DBから読み出してプロンプト化（機微本文の滞留を減らす・§S.7）。
- **状態機械**＝`queued→running→succeeded/failed/canceled`（実行方式に依らず共通）。実行方式(dispatcher)は `task_type`/provider で選択＝(a) queued-worker（ローカル・ポーリング・`FOR UPDATE SKIP LOCKED` で N 件〔既定1〕）／(b) immediate（外部高速API・将来・ポーリング不要）＝設計 §5.2。
- **冪等**＝`Idempotency-Key` で同一操作の二重投入を防ぐ。**タイムアウト**超過は `failed`（`error.code='timeout'`）・**リトライ**は `attempts` 上限まで再 `queued`・**孤児回収**＝`running` のまま無更新は再 `queued`（設計 §5.4）。

## S.2 モデル指定・選択（論理モデルキー・GET /ai-models）

| メソッド / パス | 説明 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /ai-models` | 選択可能なモデル一覧（機能内ピッカーの供給源・SC-04/各機能） | `?task_type=`（任意） | `{data:[{key, label, description, external, billing, is_default}]}` |

- **解決の優先順位**（高→低）＝**① 呼び出しの明示 `model`（機能/ユーザー指定）＞ ② task_type の既定キー（設計 §3.3）＞ ③ グローバル既定**。指定が無ければ従来どおり task_type 既定（後方互換）。
- **ガードレール**（application 層で検証・違反は 422＋明示コード）＝(1) 指定キーが registry に存在し `enabled`／(2) **会社で有効**（§S.5 の ON）／(3) **データ主権**＝`external=true` はその task_type/テナントのポリシーで許可時のみ（機微 task で外部を勝手に選べない・§S.7）／(4) **課金**＝`billing=paid` は会社 ON 済み（課金合意）かつ予算内／(5) capability（例：JSON Schema 構造化出力が必要な task に非対応キーを弾く）。
- **記録**＝`ai_jobs.requested_model`（指定した論理キー・NULL=既定）＋実行した `provider`/`model`（物理・監査）を保存＝「何を指定し・何で実行し・いくら掛かったか」を追える。
- **ピッカーUIは初版から常設**（候補1でも同じ部品・会社 ON/OFF で候補が動的増減・`billing=paid` は「有料」バッジ）＝設計 §9.2。

## S.3 モデル指定なしの既定挙動（後方互換）

- `model` 省略＝`task_type` 既定キー（設計 §3.3・§4.1）で実行。**初版の最初の task_type＝`info_summarize`**（既定 `qwen3-light`）／`iso_generate`（既定 `qwen3-swallow`）は2本目。
- registry（論理キー→{provider, model, params, external, billing, enabled}）は**システム全体のカタログ＝コード/設定側**。dev/prod の物理差は設定で吸収し、キー名は同一に保つ（アプリ無改修で載せ替え・設計 §3.2）。

## S.4 進捗・キャンセル（リアルタイム連携・§L）

- **進捗**（設計 §5.6）＝段階（3/5 セクション）進捗を主軸＋トークン比の概算＋部分プレビュー（任意）。OpenAI 互換 `stream:true`（SSE）でワーカーがトークンを受けつつ、進捗イベントを **Redis Pub/Sub `ai_jobs:{user_id}` → WebSocket（§L・§1.12）→ 画面**へ。併せて `ai_jobs.progress` 列に最新値を書く（再読込/WS 取りこぼし時の**復元源＝画面が状態の正**）。
- **キャンセル**（設計 §5.5・協調）＝`POST /ai-jobs/{id}/cancel` が `cancel_requested=true`＋実行中ワーカーへ Redis Pub/Sub で即通知→ワーカーは**トークン境界でフラグ確認→LLM 接続を abort**→`status=canceled`・`finished_at` 記録。`queued`（未着手）は即 `canceled`。強制 kill はしない（他の同時ジョブを巻き込むため）。
- **書き込みは REST 維持・WS は配信専用**（§1.12＝ドメイン層を迂回しない）。進捗/キャンセルの状態遷移は通常の REST/ワーカー経路を通す。

## S.5 会社のモデル ON/OFF・課金（管理・company_account_admin）

| メソッド / パス | 説明 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /admin/ai-models` | カタログ＋自社設定一覧 | — | registry 全キー＋`{enabled, billing, monthly_budget_micros, current_month:{tokens, cost_micros}}` |
| `PATCH /admin/ai-models/{key}` | ON/OFF・予算変更 | `{enabled?, monthly_budget_micros?}` | 200。**`paid` を ON＝課金合意**（確認ダイアログ・§S.7）。`enabled_by`/`enabled_at` を記録 |
| `GET /admin/ai-usage` | 会社の利用量/コスト | `?period_ym=`/`?model_key=`（任意） | 会社×モデル×月の集計（`ai_usage_events` の read 集計・§5.59）＋予算消化率 |

- **2階層**＝カタログ（registry・システム全体）× 会社の有効化（`company_ai_model_settings`・§5.58）。**`free` 既定 ON／`paid` 既定 OFF**（勝手に課金が始まらない安全側）。未登録キーは registry 既定にフォールバック。
- **課金方式＝A（内部メータリングのみ・実請求/決済なし）**＝利用量・コストの記録＋会社別可視化＋予算上限。**B/C 算出根拠の使用量は恒久保持**（`ai_usage_events`＝生トークン＋単価スナップショット・追記専用・§5.59）＝方式変更は後からアプリ改修だけで過去分も遡及可。
- **予算上限**＝当月 `SUM(cost_micros)`（`ai_usage_events` の `period_ym`）が `monthly_budget_micros` 到達で `paid` の enqueue を**保留/拒否**（§S.2 ガードレール）。無料ローカルキーは対象外（止めない）。

## S.6 通知・リアルタイム（既存を再利用・§H/§L）

- **完了通知**＝既存 `notifications` に `type='ai_task_done'`（失敗は `ai_task_failed`）を1件作り、`ref_*` に遷移先（idea/quest/strategy_document/info_item）を入れる＝SC-02 通知一覧・既読/未読・ベル未読数は**無改修で流用**（§H・データモデル §3 `notification_type`）。本文は既存カタログに文言追加（受信者 locale でレンダリング）。
- **ライブ更新**＝WebSocket に `ai_jobs:{user_id}` トピックを追加し、`queued→running→succeeded` の遷移で件数と対象を push＝AI処理状況画面（SC-04）が即時更新（§L）。信頼性＝通知は post-commit best-effort（at-most-once）・**画面が状態の正**なので取りこぼしても回復。

## S.7 セキュリティ / データ主権

- **既定はローカル/オンプレで完結**＝機微な経営資料・アイデアを外部に出さない（[経営資料整合 設計](../設計ドラフト/経営資料整合・自動関連付け_設計.md) §2 と整合）。
- **外部（クラウドAI）送信は opt-in ゲート**＝`external=true` のモデルは**会社での ON（§S.5）＋ task_type ポリシー**に従う（既定 OFF）。有料 ON＝課金合意（§S.5）と同じ管理者操作で外部送信も解禁される＝**課金合意とデータ主権の解禁が同一操作に集約**。routing 設定で「この task は external 禁止」も表現できる。
- **`input` の本文複製を最小化**＝参照(ID)で持ち、ワーカーが実行直前に会社DBから読み出す（ジョブ台帳への機微本文の滞留・漏洩面を減らす）。
- **プロンプトインジェクション**＝外部由来テキスト（情報インプット等）を材料にする task は system 指示と外部本文を明確に分離し、出力を JSON Schema で受ける（設計 §3.1）。
- **監査**＝`provider`/`model`/`attempts` と入出力の要約を[本番デプロイ要件](../本番デプロイ要件.md) のシステムログ機構に相関ID付きで記録。変更系 CSRF。
