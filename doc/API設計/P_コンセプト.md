# ドメイン P. コンセプト創造・検証（テナントプレーン）＝設計ドラフト（2026-09-24）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可〔クエスト内6権限〕・§1.8 一覧・§1.9 冪等・§1.12 リアルタイム）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)、クエスト/パーティー/権限・状態機械/凍結は [`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md)、アイデアは [`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md)、チャットは [`E_チャット・リアクション・魔法発動.md`](./E_チャット・リアクション・魔法発動.md)、評価は [`F_評価.md`](./F_評価.md)、通知は [`H_通知.md`](./H_通知.md)、情報インプットは [`N_情報インプット.md`](./N_情報インプット.md)。

対象＝**ISO 56002 ②コンセプトの創造＋③コンセプトの検証**（原本 §8.3.3/§8.3.4）を担う新ドメイン。現行アプリのアイデア段（①機会の特定＋選別）の**次段**を、**クエスト（＝1イノベーション・イニシアチブ／検証プールの単位）配下**に積む。要件＝**FR-42**（[要件定義 README](../要件定義/README.md)）／正本＝[コンセプト機能 ISO56002 再設計](../設計ドラフト/コンセプト機能_ISO56002_再設計.md)。データモデル §5.38〜5.45・§3（`concept_status`/`concept_decision`/`assumption_verdict`/`concept_criticality`/`concept_eval_aspect`/`concept_chat_scope_kind`）。すべて**テナントAPI**（会社DB）。テスト接頭辞＝**P-TC**。

**設計方針（DRY・[コーディング規約](../規約/コーディング規約.md) §2.3）**＝ループ機構（議論/評価/情報リンク/版）はアイデア段と同型を一般化して共有し、**中身（入力項目 §3.3・評価観点 §3.6）だけコンセプト固有に設計**する。

**この分割レビューで確定（2026-09-24）**:
- **ドメインレター＝P**（A〜O は使用済み＝M 共通シェル・N 情報インプット・O システムログ）。
- **チャットは P にスコープ単位EP を新設**＝`/concept-chat-scopes/{scope_id}/messages`。メッセージ/リアクション機構（`chat_messages`/`reactions`）は再利用、**E（アイデアチャット）は無改修**（データモデル §5.45 の最小侵襲拡張に対応）。
- **情報リンクは各 read に委譲**（N.1 委譲方針と同じ＝横断EPを増やさない）＝`GET /concepts/{id}`・`GET /assumptions/{id}` の合成に含める。
- **第一版は XP/コイン付与なし**（コンセプト評価/選定に報酬を付けるかは実装時に確定＝データモデル §5.43 の申し送り）。

## P.0 アクター・認可スコープ（門番＝パーティー所属＋クエストグループ所属）

**アクセスの門番＝パーティー所属 AND クエストグループ所属**（ドメイン C.0/D.0/E.0/F.0 と同一・`can_access_quest`）。コンセプト・前提はいずれも**クエスト配下**なので、当該クエストの `quest_members`（`removed_at IS NULL`）に行が無い／クエストグループ非所属のユーザーは、閲覧・入力いずれも **404 `not_found`**（存在秘匿・§1.6・可視範囲＝パーティー内）。

| 操作 | 必要な権限（`permission_type`・データモデル §5.9） | 補足 |
| --- | --- | --- |
| コンセプト/前提/評価集計の閲覧 | **パーティー所属**（＋評価は各 `visibility` に従う） | 可視範囲＝パーティー内 |
| コンセプトの作成・編集・削除 | 作成者本人 ＋ `owner`/`quest_admin` | アイデア（D）の作成者＋管理者と同型 |
| コンセプトの選定（`is_selected`）・状態遷移（activate/archive）・判定（`decision`） | `owner`/`quest_admin` | 勝ち残り選定・ライフサイクルは管理側 |
| 前提の作成・編集・削除・検証イベント追記 | `owner`/`quest_admin`（＝**検証プール所有**） | 共有前提を個別コンセプト owner が勝手に変えない（§3.5） |
| コンセプト↔前提リンクの追加/重要度変更/解除 | 作成者本人 ＋ `owner`/`quest_admin` | リンクはコンセプト側の編集の一部 |
| コンセプト評価の入力 | `evaluator`（作成者は既定で評価者・付与は owner/quest_admin） | F 評価と同型 |
| コンセプトチャットの投稿 | `comment` 権限 | E チャットと同型 |

- **クエスト完了（`quest_status=completed`）で書き込み凍結**（全体像の単一正＝C.5 を踏襲）: コンセプト/前提の作成・編集・削除・状態遷移・選定・判定・評価入力・チャット投稿/編集/削除/リアクションは **409 `conflict`（`invalid_state`）**。既読更新（P.6）は読み取り系副作用のため凍結対象外（E と同じ）。
- 認可失敗＝**403 `forbidden`**／範囲外＝**404 `not_found`**／未認証＝**401 `unauthenticated`**。
- **`my_permissions`（作成/編集/選定/評価/コメント可否）はサーバーが算出して返す**（フロントは再実装しない・コーディング規約 §1）。UX 便宜で、実アクションは各 EP で再検証。

---

## P.1 コンセプトの取得（一覧・詳細）

| メソッド/パス | 概要 | リクエスト | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /quests/{quest_id}/concepts` | クエスト配下のコンセプト一覧（SC-xx 一覧） | パス: `quest_id`／クエリ: §1.8（`q`/ソート/フィルタ・`status`）＋**自分の `draft` を含む** | `items[]`＝`{id, title, status, decision, is_selected, source_idea_count, assumption_count, eval_summary〔提出数/推奨内訳〕, author, updated_at}`・カーソル |
| `GET /concepts/{concept_id}` | コンセプト詳細（合成） | パス: `concept_id` | `concept`（§3.3 全項目＝problem/value_proposition/target/differentiation/solution_form/`viability`〔jsonb〕/decision/decision_rationale/status/is_selected）・`source_ideas[]`〔title/評価平均/選定〕・`assumptions[]`〔リンク＝`{assumption, criticality, is_stale}`・現在判定〕・`evaluation`（集計要約＝P.5）・`chat_scopes[]`（P.6）・`related_info[]`（**採用/裏付け/反証の情報リンク**＝`info_links` `target_type='concepts'`・N 委譲）・`my_permissions` |

- 一覧は**サーバー委譲契約**（DataTable・§1.8.1・列 flags ホワイトリスト）。`draft` は本人のみ一覧に含める（D アイデアと同型）。
- 詳細の `related_info` は N の read 合成を流用（採否〔disposition〕表示も FR-41 Phase2 と同型）。

## P.2 コンセプトの登録・編集・状態遷移・選定・判定

| メソッド/パス | 概要 | リクエスト（主なボディ） | レスポンス |
| --- | --- | --- | --- |
| `POST /quests/{quest_id}/concepts` | コンセプト作成（既定 `draft`） | `{title(必須), source_idea_ids[]〔由来・同一クエストの選別済み〕, problem?, value_proposition?, target?, differentiation?, solution_form?, viability?〔jsonb〕}` | 作成された `concept`。**作成時に総合ルーム（`overall`）を自動生成**（§3.7・§5.45） |
| `PATCH /concepts/{concept_id}` | 内容編集（作成者＋owner/quest_admin） | 上記フィールドの部分更新＋`source_idea_ids[]` の差し替え | 更新後 `concept`（公開後は版として記録＝版管理は §3.8・第一版は `current_revision` のみ） |
| `DELETE /concepts/{concept_id}` | 論理削除（作成者＋owner/quest_admin） | — | 204（`deleted_at`・監査保持） |
| `POST /concepts/{concept_id}/activate` | `draft→active`（owner/quest_admin） | — | `status=active`。以後パーティーに可視（議論/評価の対象） |
| `POST /concepts/{concept_id}/archive` | `active→archived`（owner/quest_admin） | — | `status=archived`（論理・監査保持） |
| `POST /concepts/{concept_id}/select` ／ `DELETE …/select` | 勝ち残り選定/解除（owner/quest_admin・**複数可**） | — | `is_selected` 変更（→将来のソリューション段の入力）。取消でも履歴は残す |
| `PUT /concepts/{concept_id}/decision` | 総合判定 Go/Pivot/Kill（owner/quest_admin） | `{decision: go\|pivot\|kill\|undecided, decision_rationale?}` | 更新後 `concept`。**"Go/Pivot/Kill" は当社ラベル**（ISO は反復検証＋選定・§3.3） |

- **由来アイデア（`source_idea_ids`）は同一クエストのアイデアに限定**（範囲外は 422）。選別済み（`is_selected`）を推奨サジェストするが必須ではない（発散中からの昇華も許容）。
- `viability` は jsonb（価値実現モデル・§5.38）。**確定運用（active 化や decision=go 時に viability 必須）はサーバー検証**（第一版の必須境界は実装時に確定）。
- **選定（`is_selected`）と判定（`decision`）は別操作**（コンセプト自身の Go 判定と、owner の勝ち残り選定は別概念・§3.3）。

## P.3 前提＝検証プール（クエスト単位・第一級）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /quests/{quest_id}/assumptions` | 検証プール一覧（クエスト単位） | クエリ: §1.8（`verdict` フィルタ等） | `items[]`＝`{id, statement, current_verdict, validation_count, linked_concept_count, latest_validated_on}`・カーソル |
| `POST /quests/{quest_id}/assumptions` | 前提の作成（owner/quest_admin＝プール所有） | `{statement(必須)}` | 作成された `assumption`（`current_verdict=inconclusive`） |
| `GET /assumptions/{assumption_id}` | 前提詳細（検証履歴＋リンク先） | パス: `assumption_id` | `assumption`・`validations[]`（P.3 追記の履歴・時系列）・`linked_concepts[]`〔`{concept, criticality, is_stale}`〕・`related_info[]`（`info_links` `target_type='assumptions'`）・`my_permissions` |
| `PATCH /assumptions/{assumption_id}` ／ `DELETE …` | 記述編集/削除（プール所有） | `{statement}` | 更新後／204（削除は未リンクのみ許可・リンク有りは 409 で先に解除を促す） |
| `POST /assumptions/{assumption_id}/validations` | **検証イベント追記**（プール所有・追記型） | `{method(必須), result?, verdict(必須), validated_on(必須), scale?}` | 追記後 `validation`＋更新後 `assumption.current_verdict`。**`verdict=refuted` は反証波及を発火**（P.7） |
| `GET /assumptions/{assumption_id}/validations` | 検証イベント履歴 | — | `items[]`（`validated_on` 降順・最新＝現在判定） |

- **前提の現在判定＝最新イベント**（`current_verdict` はキャッシュ・§5.40/§5.41）。再検証は**新イベント追記**で履歴保持（イベントの編集/削除は不可＝監査・訂正は新イベントで上書き）。
- **検証実施日（`validated_on`）・規模（`scale`）を残す**＝エビデンスの古さ・強さの材料（§3.5・ISO56002 §9 継続的モニタリング）。

## P.4 コンセプト↔前提リンク（M:N＋重要度・§3.5）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /concepts/{concept_id}/assumptions` | 前提をコンセプトにリンク（重要度付き） | `{assumption_id(必須・同一クエスト), criticality?(既定 major)}` | 作成された link。既存前提の再利用が基本（プールから選ぶ・§3.5 DRY） |
| `PATCH /concepts/{concept_id}/assumptions/{assumption_id}` | 重要度変更／**要再評価(stale)の解除** | `{criticality?, is_stale?(false で再評価済み)}` | 更新後 link。**`is_stale=false` は再評価の記録**（評価者が反証を織り込んだ後） |
| `DELETE /concepts/{concept_id}/assumptions/{assumption_id}` | リンク解除 | — | 204（前提本体・エビデンスは残る＝単一ソース） |

- **重要度はリンク単位**（同じ前提でもコンセプトごとに致命/補助が違う・§3.5）。エビデンス（方法/結果/判定）は前提側の単一ソースを共有。
- 新規前提の作成＋リンクは 2 ステップ（`POST /quests/{id}/assumptions` → `POST /concepts/{id}/assumptions`）。UI は連続操作で吸収。

## P.5 コンセプト評価（自分・集計・upsert／F 評価と同型）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /concepts/{concept_id}/evaluation/me` | 自分の評価/下書き | パス: `concept_id` | `{status, scores〔{aspect:score}〕, comments〔{aspect:comment}〕, overall_comment, recommendation, visibility, submitted_at}`。未作成は空 |
| `GET /concepts/{concept_id}/evaluation` | 評価集計（visibility 適用） | パス: `concept_id` | `aspects`〔観点別平均〕・`overall_avg`・`evaluator_count`・`recommendations`〔Go/Pivot/Kill の内訳〕・`evaluators[]`〔可視分のみ〕・`my_evaluation` |
| `PUT /concepts/{concept_id}/evaluation` | upsert（下書き/確定） | `{status: draft\|submitted, scores{中核5必須・補助3任意}, comments?, overall_comment, recommendation, visibility?}` | 更新後の自分の評価。**`submitted` で中核5(1..5)＋総評＋`recommendation` 必須をサーバー検証** |

- **観点＝中核5（desirability/feasibility/viability/assumption_strength/differentiation）必須＋補助3（novelty/sustainability/ip）任意**（§3.6・ISO §8.3.3 b 準拠・`concept_eval_aspect`）。集計の重み付けは実装時。
- **`recommendation`（評価者の Go/Pivot/Kill 推奨）**＝候補比較・選定の道具（§3.6）。集計 `recommendations` で分布を可視化。
- `visibility`（party/limited）は F と同 enum・同挙動（limited は範囲外に完全非表示・集計分母から除外）。
- **XP/コイン付与は第一版では行わない**（アイデア評価と同型にするかは実装時＝F の XP+30/コイン連動を踏襲するか要判断）。

## P.6 コンセプト議論チャット（スコープ単位・E を一般化）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /concepts/{concept_id}/chat-scopes` | ルーム一覧（総合/グループ/前提スレッド） | パス: `concept_id` | `items[]`＝`{scope_id, kind, label, assumption_id?, position, unread_count}`（未読はスコープ別＋コンセプト単位ロールアップ・§3.7） |
| `POST /concepts/{concept_id}/chat-scopes` | グループ・ルーム作成（owner/quest_admin・3〜5 の範囲） | `{kind: group, label}` | 作成された scope。`overall` は自動・`assumption` は前提リンク時に生成 |
| `GET /concept-chat-scopes/{scope_id}/messages` | メッセージ取得（カーソル・`unread` 同梱） | クエリ: `before`/`after`（E.1 と同形） | `items[]`（`chat_messages` 形＝本文/添付/メンション/リアクション/引用）・カーソル |
| `POST /concept-chat-scopes/{scope_id}/messages` | 投稿（単一 multipart・`Idempotency-Key` 必須） | `{body, mentions[]?, quotes[]?, files[]?}` | 作成メッセージ。**機構は E.3 と共有**（`chat_messages` に `concept_chat_scope_id` で紐付け・§5.45） |
| `POST /concept-chat-scopes/{scope_id}/read` | 既読位置更新（完了後も許可） | `{last_read_message_id}` | 204（`chat_reads`・§5.31・E.7 と同型） |

- **リアクションは E の `POST/DELETE /chat-messages/{id}/reactions` をそのまま流用**（メッセージ単位＝アイデア/コンセプト両対応・通常/魔法とも）。編集/削除も E の `PATCH/DELETE /chat-messages/{id}` を流用（本人＋owner/quest_admin）。
- **リアルタイム配信**＝L のトピックを `chat:{concept_chat_scope_id}` へ拡張（§1.12・購読門番＝P.0）。イベントカタログ（`chat.message.*`/`chat.reaction.*`）は E と共通（L 参照）。
- 前提スレッド（`kind=assumption`）は前提リンク（P.4）時に生成し、`assumption_id` で前提に紐付く（前提1件=1スレッド・§3.7）。

## P.7 反証波及・通知連携（ドメイン H 連携点）

- **前提の反証（`POST /assumptions/{id}/validations` の `verdict=refuted`）**＝post-commit で:
  1. その前提にリンクする**全 `concept_assumption_links.is_stale=true`**（要再評価・§5.42）。
  2. リンク先**各コンセプトの作成者＋評価者へ通知**（要再評価）。既存の per-link 反証発火（[`N_情報インプット.md`](./N_情報インプット.md) §N.3・§5.35）と**同じ通知経路**。
- **情報リンクの反証（`info_links.kind=refuting`・`target_type='concepts'/'assumptions'`）**＝N の発火をそのまま利用（情報 → 前提/コンセプトへ通知＋要再評価）。1情報の反証 → 1前提 → 複数コンセプトの波及が繋がる（§3.5）。
- 通知種別は H に追加（例 `concept_assumption_refuted`＝要再評価／宛先＝作成者＋評価者）。**生成は P が post-commit で H の `notify()` を呼ぶ**（H の責務境界・§H.0）。

## P.8 エラー・セキュリティ

- 認可はサーバー強制（§1.6・コーディング規約 §1）。範囲外は存在秘匿の 404（P.0）。
- `viability`（jsonb）・各テキストは**保存時＋表示時サニタイズ**（XSS・コーディング規約 §2.2・N と同方針。将来リッチ化するなら nh3）。
- チャット本文・メンションは E のサニタイズ/検証を流用。冪等（投稿は `Idempotency-Key` 必須・§1.9）。
- 由来アイデア・前提・リンク対象の**同一クエスト帰属をサーバー検証**（越境は 422／範囲外は 404）。

## P.9 画面対応（SC-xx 新規・未採番）

- **コンセプト一覧**（クエスト詳細 SC-12 のタブ or 新規 SC-xx）＝P.1 一覧。
- **コンセプト詳細**（新規 SC-xx）＝P.1 詳細＝成果物スキーマ（§3.3）＋前提リンク＋評価＋議論ルーム＋関連情報。
- **前提（検証プール）ビュー**＝クエスト単位の一覧＋前提詳細（検証履歴）。
- 画面は本 API 確定後に画面設計（`doc/画面設計/screens/SC-xx`）で起こす（フロントエンド実装フロー規約＝モック先行）。

## P.10 MVP 境界・Phase2・他ドメイン境界

- **MVP**＝コンセプト CRUD＋由来＋前提/検証＋M:N リンク（重要度・stale）＋評価（中核5＋補助3）＋議論チャット（総合/グループ/前提スレッド）＋反証波及。
- **Phase2**＝版管理テーブル（`concept_revisions`・アイデア §5.14 同型）／コンセプト評価の XP・コイン連動／集計の重み付け（criticality × 前提判定）／複数コンセプトの比較ビュー／（将来）ソリューション段への昇格。
- **他ドメイン境界**＝台帳（XP/コイン）は G／通知は H／リアルタイムは L／情報リンクは N／全文検索（コンセプト本文）は将来 J 拡張。**関連リンク対象ピッカーへ `concepts`/`assumptions` を追加**（N の `search_link_candidates` が現状 else→[]・[コンセプト機能 ISO56002 再設計](../設計ドラフト/コンセプト機能_ISO56002_再設計.md) §4 ⚠️・本ドメイン実装と同時に対応）。
