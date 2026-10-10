# 会社別 AI 動作ポリシー（公開時 自動評価の会社別 ON/OFF）設計ドラフト

- 日付: 2026-10-10
- 対象: AI の「挙動を制御する設定」のうち、デプロイ単位 env だったものを**会社単位**に移す第一歩。
- 関連正本: [データモデル §5.60](../データモデル.md)／[API設計 S.5b](../API設計/S_AIジョブ・LLM連携.md)／[画面 SC-94](../画面設計/screens/SC-94_会社のLLM設定.md)／[FR-45](../要件定義/README.md)・[FR-50]／関連ドラフト [アイデアLLM自動評価_設計](アイデアLLM自動評価_設計.md)。

## 1. 背景・動機

AI の挙動を制御する設定を棚卸しした結果、3層に分かれた（2026-10-10 調査）。

1. **基盤配線（env 据え置きが正）**＝`llm_base_url`/`llm_api_key`/`llm_timeout_seconds`・`alignment_embed_*`・`llm_model_light`/`_swallow`（論理→物理解決）・ワーカー調整（`llm_worker_*`/`llm_job_*`）・校正値（`alignment_embed_score_floor`/`_ceil`）。物理は基盤側に焼かない／論理キーは dev/prod 同一／モデル校正はモデル別、という設計方針の核。**会社別化しない**（運用者が調整できず面を増やすだけ）。
2. **既に会社別**＝`alignment_method`・`auto_link_threshold`（control `companies`）／`company_ai_model_settings`（モデル ON/OFF・月次予算・**`max_output_tokens`＝会社別の生成上限**）。会社ポリシーの置き場は既にある。
3. **env だが本来は会社ポリシー**＝`llm_auto_evaluate_on_publish`（公開時の自動 AI 評価 ON/OFF）。`llm_max_tokens` も候補だったが、**`company_ai_model_settings.max_output_tokens` で会社別＆ company>env フォールバック済み**（`gateway.py` が会社値優先・無ければ env `llm_max_tokens` を技術ガード）＝追加実装不要。

→ **本ドラフトのスコープ＝`llm_auto_evaluate_on_publish` の会社別化のみ**。

## 2. 決定

- **(D1) 公開時 自動評価を会社単位で ON/OFF にする。** 純然たる会社の業務ポリシー（この会社は人間評価だけで回す／AI も自動で回す）であり、デプロイ全体で一律にするのは不適切。
- **(D2) 置き場＝AI・LLM 設定画面（SC-94・admin/ai-settings）に寄せる**（ユーザー指示 2026-10-10）。モデル ON/OFF・予算と同じ画面に「AI 動作ポリシー」セクションを足す。別画面に散らさない。
- **(D3) 格納＝会社横断の値なので per-model の `company_ai_model_settings` ではなく、会社単位シングルトン `company_ai_settings`（会社 DB・§5.60）を新設。** 将来の会社横断 AI ポリシー（既定モデル・外部送信方針 等）の受け皿も兼ねる。
- **(D4) 解決順＝会社設定 > env フォールバック。** `auto_evaluate_on_publish` は **nullable**（NULL＝デプロイ既定 `llm_auto_evaluate_on_publish` を継承）。これで「env＝全社フォールバック既定」を厳密に満たす（②の既存作法と同じ）。
- **(D5) F6（再評価ボタン表示条件）はこれで自然に解ける**＝自動評価 ON の会社では公開時に AI 評価が付く→`IdeaDetailView` の AI 評価ブロック＋再評価ボタンが出る。表示条件自体の改修は不要になる見込み（F6 は本件完了後に再評価）。

## 3. データモデル（§5.60 company_ai_settings・会社DB・シングルトン）

| 物理名 | 型 | 制約/既定 | 説明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | |
| `auto_evaluate_on_publish` | boolean | NULL可 | 公開時 自動 AI 評価。**NULL＝デプロイ既定（env `llm_auto_evaluate_on_publish`）を継承**／true/false＝明示上書き |
| `updated_by_id` | uuid | FK→users, NULL可 | 最終変更者（監査） |
| `created_at`/`updated_at` | timestamptz | NOT NULL | 共通監査列 |

- **シングルトン**＝会社 DB に1行。migration で1行 seed（`auto_evaluate_on_publish=NULL`）＝GET は常に値を返せる。repository は `limit(1)` 取得＋upsert。
- **なぜ専用テーブル**＝会社横断（モデル非依存）の AI ポリシーの受け皿。per-model の §5.58 とは粒度が違う。

## 4. API（S.5b・company_account_admin / system_admin）

| メソッド/パス | 説明 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /admin/ai-policy` | 会社の AI 動作ポリシー取得 | — | `{auto_evaluate_on_publish: bool|null, effective: bool, deploy_default: bool}` |
| `PATCH /admin/ai-policy` | 同 変更 | `{auto_evaluate_on_publish: bool|null}` | 200・同上（null＝デプロイ既定へ継承リセット） |

- 認可＝`require_company_account_admin`（SC-94 と同じ・サーバー強制）。変更系は CSRF/Origin 必須（A.0）。テナント分離＝会社 DB 内。
- `effective`＝`coalesce(company 値, deploy_default)`。`deploy_default`＝env `llm_auto_evaluate_on_publish`（UI の注記用）。

## 5. 実行時の結線

- `ideas/application.py:_enqueue_idea_ai_evaluation`＝現状 `if not get_settings().llm_auto_evaluate_on_publish: return`。これを **会社値 coalesce env** に差し替え（会社 DB から `company_ai_settings` を読む）。graceful は維持（読めない/未設定は env 既定）。

## 6. 画面（SC-94 §新「AI 動作ポリシー」）

- モデル一覧カードの上（または下）に `.card` で1セクション。既存 `.setting-row`/`.switch` 踏襲（新規 UI を作らない）。
- トグル「アイデア公開時に AI が自動評価する」＝`effective` を表示。変更は `PATCH /admin/ai-policy` に明示 bool を送る（成功/失敗 snackbar）。
- 注記＝「未設定時はシステム既定（{deploy_default}）に従います」。

## 7. テスト（S・red-green）

- S-TC-215 `GET /admin/ai-policy`＝既定（seed NULL）で `effective==deploy_default`。
- S-TC-216 `PATCH`＝true/false 明示で `auto_evaluate_on_publish` と `effective` が変わる・監査 `updated_by_id`。
- S-TC-217 `PATCH null`＝継承リセットで `effective==deploy_default`。
- S-TC-218 認可＝一般ユーザーは 403。
- S-TC-219（ideas 結線）＝会社 ON で公開時に `idea_evaluate` が enqueue／会社 OFF で env ON でも enqueue されない（会社値優先）。

## 8. 正本反映の想定先

データモデル §5.60／API設計 S.5b／SC-94 §／FR-50（自動評価の粒度注記）／テスト S。バックログ台帳は実装完了時に残があれば起票（完了すれば F6 を再評価して更新）。
</content>
</invoke>
