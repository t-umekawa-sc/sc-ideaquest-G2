# R. 経営資料・整合（strategy_documents・整合率・機会/脅威率・エクスポート・FR-44）

> 横断規約＝[API設計 README](README.md)（§1.x＝認可 §1.8・カーソル §1.8・DataTable §1.8.1・Idempotency §1.9・画像 §1.10）。データモデル＝[§5.54 strategy_documents](../データモデル.md)・[§5.55 idea_alignment](../データモデル.md)・[§5.36b entity_tokens](../データモデル.md)。設計元＝[経営資料整合・自動関連付け 設計](../設計ドラフト/経営資料整合・自動関連付け_設計.md)。画面＝SC-80（一覧）/SC-81（登録・編集）/SC-82（詳細）・SC-22（整合バッジ）。
>
> **状態＝整合率は `SimilarityProvider`（会社別 keyword/embedding/hybrid・A-2 実装済 2026-09-29）**。意味方式は**LLM 基盤の embeddings 経由**（モデルは基盤側＝backend 非焼込・データ主権）＝方式 B（LLM 判定・生成）は別要件（横断 LLM ゲートウェイ）。生成（ISO意図/方針）は**構造化 Markdown エクスポート**のみ（外部委譲・自動送信なし・R.5）。

## R.0 アクター・認可スコープ

| 操作 | 権限 | 補足 |
| --- | --- | --- |
| 経営資料 CRUD（登録/編集/アーカイブ/削除） | **`company_account_admin` / `system_admin`** | 機微資料＝会社管理者スコープ（§10 データ保護）。一般/クエスト権限では不可（403） |
| 経営資料 一覧/詳細（管理・read） | company_account_admin / system_admin | 全項目・機会脅威率・関連アイデア等の**管理詳細**は管理者のみ（機微） |
| 経営資料 **選択用一覧**（read） | **クエスト作成権限者**（owner/quest_admin＝クエスト作成/編集ができる人） | クエストに適用する資料を選ぶための**軽量一覧**（`id`/`title`/`doc_kind`/`period_from`/`period_to`/`status=active` のみ・全文/機会脅威率は返さない）。§R.1 の `?for=selection` |
| 整合バッジ（アイデア詳細に同梱・SC-22） | アイデア可視者 | 率＋獲得コインの表示のみ（read）。算出はサーバー権威 |
| Markdown エクスポート | company_account_admin / system_admin | 利用者の明示操作でのみ生成（自動外部送信しない・§10） |

- テナント分離＝会社 DB 内（§1.5）。クロステナントは存在秘匿の 404。変更系は CSRF 必須（A.0）。

## R.1 経営資料 CRUD

| メソッド / パス | 説明 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /strategy-documents` | 一覧（DataTable 契約・§1.8.1・管理者） | `q`/`status`/`doc_kind`/`sort`/`page`/`per_page`/`pin_ids` | `{data:[StrategyDocListItem], page_info}` |
| `GET /strategy-documents?for=selection` | **選択用 軽量一覧**（クエスト作成権限者・§R.0） | `status=active`（既定）・`q` | `{data:[{id,title,doc_kind,period_from,period_to}]}`（全文/率は返さない） |
| `POST /strategy-documents` | 登録（管理者） | `{title, doc_kind, intent?, policy_commitment?, strategy?, focus_areas?[], objectives?, body_md?, period_from?, period_to?}` | 201＋詳細。`body_text` 連結＋`entity_tokens` 同期再生成（owner_type=strategy_doc） |
| `GET /strategy-documents/{id}` | 詳細 | パス: `id` | `StrategyDocDetail`（全項目＋率集計＋関連アイデア/情報＋ワードクラウド上位） |
| `PATCH /strategy-documents/{id}` | 編集（差分・管理者） | 変更フィールドのみ | 200＋詳細。`body_text` 再連結＋トークン再永続化＋配下アイデアの整合率再計算（許容バッチ） |
| `POST /strategy-documents/{id}/archive` | **アーカイブ（論理削除）**＝status=archived | — | 200。選択候補（active）から外れる・**レコードは残す（監査保持）** |
| `POST /strategy-documents/{id}/unarchive` | **復元**（archived→active・誤アーカイブの復元） | — | 200。選択候補に戻る |

- **削除方式＝論理削除（アーカイブ）に統一**（プロジェクト慣例＝基本は論理削除・監査保持）。**物理削除 EP は設けない**（機微文書・参照〔quest_strategy_documents/idea_alignment〕を黙って壊さない）。「使わなくする」＝アーカイブ／「戻す」＝復元。

- 検証（§4.7）＝`title` 必須・`doc_kind` はホワイトリスト（`midterm_plan`/`policy`/`strategy`/`other`）・`period_from<=period_to`・`focus_areas` は文字列配列。
- `body_text` ＝ `intent`＋`policy_commitment`＋`strategy`＋`focus_areas`＋`objectives`＋`body_md` を連結（トークン化/検索の素材・§5.54）。

## R.1b クエストへの適用資料の選択（母集合の決定・C ドメイン連携）

- **クエスト作成/編集**（`POST/PATCH /quests`・C ドメイン）に **`strategy_document_ids[]`**（0..N）を追加＝適用する経営資料を作成者が手動選択（参加グループ `quest_group_ids[]` と同型）。中間表 `quest_strategy_documents`（§5.56）へ reconcile。
- 選択元＝`GET /strategy-documents?for=selection`（active 資料の軽量一覧・クエスト作成権限者）。日付範囲による自動割当はしない（作成者が該当年度の有効資料を選ぶ）。
- **版履歴**＝選択は**クエスト定義スナップショット**（`quest_revisions`・§3.1）に `strategy_document_ids` として含める＝**選択変更で quest_revision を1版追加**（categories／参加グループと同様）。
- **選択変更時の再計算**＝配下アイデア × 変更後集合で `idea_alignment` を再計算（率は動く）。**コインは維持**（付与し直さない・§R.3）。

## R.2 整合率（アイデア↔経営資料）

- **算出＝`SimilarityProvider`（会社別方式・A-2・2026-09-29 実装）**＝`companies.alignment_method`（`keyword`/`embedding`/`hybrid`・既定 keyword・SC-92 で選択）。
  - `keyword`＝`derive.token_cosine`（[[entity_tokens]] の永続トークン・決定的・オフライン）。
  - `embedding`＝`entity_embeddings`（§5.36c）の cosine＝**意味的一致**。ベクトルは**LLM 基盤の OpenAI 互換 `/embeddings`**（Ollama/vLLM 等・モデルは基盤側＝backend に焼き込まない＝データ主権）で本文保存時に生成・永続。埋め込み欠損/モデル不一致は **keyword フォールバック**（例外なく算出）。**生 cosine は 0..1 へ線形リスケールしてからティア適用**（bge-m3 は分布が圧縮＝生値では 0.70/0.90 ティアが死ぬ・実測 2026-09-30）＝`clamp((cos-floor)/(ceil-floor))`・config `alignment_embed_score_floor`/`_ceil`（既定 0.42/0.62・モデル別に可変）＝整合率(%) が直感的になる（無関係≈0%・強い一致≈100%）。詳細/Why＝[経営資料整合・自動関連付け 設計 §4.1a](../設計ドラフト/経営資料整合・自動関連付け_設計.md)。
  - `hybrid`＝`w·keyword + (1-w)·embedding`（w＝config `alignment_hybrid_keyword_weight`・既定 0.5・会社 UI には式を出さない）。
  - **方式 B（LLM 判定・生成）は別要件**（横断 LLM ゲートウェイ＋AIジョブ基盤）＝整合率は決定的が要る（コインの公平性）ため埋め込み（A）を採用。
- **保存**＝`idea_alignment(idea_id, strategy_document_id, score, method, matched_tokens)`（upsert・§5.55）。`method` は選択方式を記録。`matched_tokens` は**方式に依らず keyword 由来**（意味方式でも説明可能性を担保）。
- **母集合＝アイデアの所属クエストが選択した経営資料**（`quest_strategy_documents`・§5.56）＝**1アイデア N資料**。全 active 資料ではない。未選択クエストは整合行なし＝バッジ非表示。
- **契機**＝(1) アイデア公開/更新（当該アイデア×自クエストの選択資料を再計算）／(2) クエストの資料選択変更（配下アイデア×変更後集合）／(3) 経営資料 登録/更新（当該資料×関係アイデアを再計算・バッチ許容）。
- **read（アイデア詳細/SC-22 同梱）**＝`GET /ideas/{id}` に `alignment` を同梱（別 read も可）:
  - `alignment = {best_score, best_strategy:{id,title}, matched_tokens[], tier, coins_awarded}`。
  - **複数経営資料時は最大採用**＋`matched_tokens`（効いた方針の上位語）で「どの方針に効いたか」を提示。
  - **ラベルは「方針との関連度（キーワードベース）」と正直表記**（厳密な意味的整合ではない旨・過信防止）。

## R.3 整合率→コイン（ゲーミフィケーション・§G 連携）

- アイデア公開（or 版更新）時に整合率（best_score）を計算し、**段階閾値超えでコイン付与**＝`ledger.grant(kind=COIN_GAIN, amount, reason='idea_alignment', ref_type='ideas', ref_id=idea_id)`。
- **段階（合意 2026-09-29）**＝関連度 **≥50% → +3／≥70% → +7／≥90% → +15**（best_score 基準）。
- **冪等・初回のみ・下げない**＝`exists_ref('ideas', idea_id, reason='idea_alignment')` で二重付与防止（コンセプト投票 XP と同型）。再計算で率が上がっても**初回付与額のまま**（稼ぎ直し防止）。率が下がってもコインは取り消さない。
- **会社の方式変更時の差分付与（A-2・2026-09-29）**＝`companies.alignment_method` を変更すると、資料紐づけのある全クエストの配下公開アイデアを**再計算＋差分コイン付与**（初回超えのみ・下げない＝方式変更で整合率が上がり初めてティアを越えた分だけ付与）。`update_company_settings`→`strategy.recompute_all_for_company`（別 Tenant Tx・**best-effort**＝会社DB 未プロビジョニングでも設定保存は成功）。
- 表示＝SC-22 の方針整合バッジ（関連度 %＋獲得コイン）。**軽い加点**（順位を厳密に決める指標にしない）。

## R.4 機会/脅威/影響率（情報の集計・read）＝実装済（2026-09-30・Step4）

- **役割分担**＝関連度＝キーワード（決定的・`derive.token_cosine`）／機会・脅威＝人手（既存 `info_items.impact_class`＝curator トリアージ・§5.33）。
- 母集団＝当該経営資料と**関連度が閾値以上**の **curated（非アーカイブ）情報**（＝キーワードで効いている情報）。閾値は会社別 `auto_link_threshold`（N.6 と同じ「効いている」基準を流用・既定 0.12）。
- `GET /strategy-documents/{id}`（管理者スコープ）の `impact` に同梱（create/update/archive では `null`）:
  - **影響率**（`impact_rate`）＝母集団サイズ / 全 curated 情報（方針に触れる情報がどれだけ入っているか・0..1）。
  - **機会率**（`opportunity_rate`）＝母集団のうち `impact_class='opportunity'` の割合。**脅威率**（`threat_rate`）＝`threat` の割合（いずれも母集団＝`related_count` が分母・0..1）。
  - 併せて `info_total`／`related_count`／`opportunity_count`／`threat_count`／`threshold`（説明可能性）を返す。母集団 0 でもゼロ除算せず率 0。
- 専用テーブルは持たず read で集計（I ダッシュボード同方針・§5.55 補足）。**表示**＝経営資料 編集画面（SC-81）上部の読み取り専用「情報の影響」カード（編集時のみ・複製は出さない）。テスト＝R-TC-110（api）/111（int）。

## R.4b 方針まわりの語像（ワードクラウド・集約でのみ UI 化・設計§7）＝実装済（2026-09-30）

| メソッド / パス | 説明 | レスポンス |
| --- | --- | --- |
| `GET /strategy-documents/{id}/word-cloud`（管理者スコープ） | 当該資料に**関連する情報・アイデア・コンセプト**に現れる語を頻度集約（read） | `{tokens:[{token,count,weight}], related_count}` |

- **集約対象**＝(1) 関連情報（R.4 母集団＝トークン関連度≥`auto_link_threshold` の判定済情報）／(2) 関連アイデア（`idea_alignment` を持つ非削除アイデア）／(3) 関連コンセプト（トークン重なり≥閾値）。これらの `entity_tokens` を合算し `weight`＝最頻値を 1.0 とした正規化（フォントサイズ用）。関連 0 は空。
- **設計§7 準拠**＝単体（1アイデア等）のワードクラウドは作らず、**集約（経営資料・クエスト・情報一覧）でのみ UI 化**。本 EP は「経営資料」の集約。
- backend＝`application._word_cloud`（`export.related_concept_ids`／`repository.idea_ids_for_doc`／`_related_curated_info` を再利用）。frontend＝SC-81 編集画面「☁️ この方針まわりの語像」（編集時のみ）。テスト＝R-TC-114（api）/115（int）。

## R.5 AI 用 Markdown エクスポート（生成は外部委譲・§8）＝実装済（2026-09-30・Step5）

| メソッド / パス | 説明 | レスポンス |
| --- | --- | --- |
| `GET /strategy-documents/{id}/export.md`（管理者スコープ） | 経営資料＋関連アイデア/情報/コンセプトを**構造化 Markdown** に束ねて返す（コピー/ダウンロード） | `text/markdown; charset=utf-8`（ISO56001 の項目立てに対応した見出し構成・`Content-Disposition: inline`） |

- **利用者の明示操作でのみ生成**（自動外部送信しない・§10）。生成（意図/戦略/方針のたたき台）は利用者が任意の LLM に貼って行う＝データ主権を保持。
- 出力構成＝(1) 経営資料本体（意図/方針/戦略/重点領域/目標＝ISO 4/5.1・5.2・6.1・6.2／未記入は「（未記入）」・補足は本文がある時のみ）／(2) 関連度上位のアイデア（`idea_alignment` の score 降順・上位10）／(3) 関連情報（R.4 母集団＝機会/脅威ラベル付き・score 降順・上位20）／(4) 関連コンセプト（トークン重なり≥閾値・score 降順・上位10）。テーブルセルはパイプをエスケープ。**決定的**（整合率キャッシュ＋トークン重なり）。
- backend＝`app/tenant/strategy/export.py`（`build_markdown`）＋`application.export_markdown`。frontend＝SC-81 編集画面の「🤖 AI 用にエクスポート」（📋 コピー／⬇ ダウンロード .md・編集時のみ）。テスト＝R-TC-112（api）/113（int）。
- **in-app 生成（プロバイダ差し替え式・オンプレ無料 LLM 既定）は Phase2**（横断 LLM ゲートウェイ）。

## R.6 セキュリティ / データ保護

- 経営資料は**機微**＝会社 DB テナント分離・管理者スコープ・**外部送信は既定オフ**（LLM 連携は明示 opt-in＋会社設定・Phase2）。
- 手動主義＝サーバーは外部 URL を取りに行かない（SSRF 面を増やさない・情報インプットと同じ）。変更系 CSRF・監査（B.6 相当）。
