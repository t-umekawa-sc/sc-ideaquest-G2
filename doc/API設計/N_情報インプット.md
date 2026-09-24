# ドメイン N. 情報インプット（外部情報の知識レイヤ・テナントプレーン）＝設計ドラフト（2026-09-18）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可・§1.8/§1.8.1 一覧/DataTable・§1.9 冪等・§1.10 添付・§1.11 全文検索）を参照。
> 設計の正＝[情報インプット機能 設計](../設計ドラフト/情報インプット機能_設計.md)（残論点は §11 で確定）。データモデル＝[データモデル](../データモデル.md) §5.33〜5.37・§3（`info_*` enum）。要件＝[FR-41](../要件定義/README.md#6-機能要件)。

対象画面＝**情報インプット 一覧/登録/詳細（SC-xx 新規・未採番）＋各成果物（アイデア/コンセプト/クエスト）の「関連情報」パネル**。すべて**テナントAPI**（会社DB＝`info_items`/`info_item_categories`/`info_links`/`info_tokens`/`info_curators`）。**サーバは外部 URL を取りに行かない（手動貼付のみ＝SSRF 対象外・§N.7）**。

## N.0 アクター・認可スコープ

**情報プールは会社（テナント）横断の知識レイヤ**＝クエスト門番（`can_access_quest`）ではなく、**会社内の active ユーザーなら閲覧可**。書き込みは**フィールド群ごとにオーナーが違う**（2026-09-21 確定・従来の「curated 後は curator のみ編集」を上書き）:

| フィールド群 | 編集できる人 | 備考 |
| --- | --- | --- |
| **内容**（`title`/`body_html`/`source_url`/参考資料） | **作成者のみ**（`status` 非依存・**curator も不可**） | raw/curated 問わず作成者が編集可。**内容の編集履歴を保持**（版・編集者・日時＝Phase C）。低摩擦登録も作成者＝会社内 active 全員が新規作成可 |
| **キュレーション**（属性値・情報判定 `triage`/`triaged_on`/`triage_reason`・`status` 遷移 raw→curated→archived・アーカイブ/解除・カテゴリ #8） | **`info_curator` のみ** | 属性/triage 付与で raw→curated。archive/unarchive も curator（物理削除なし・監査保持） |
| **関連リンク（情報側）** | **会社内 active ユーザー全員**（`status` 非依存・**curator 管轄外**） | 追加（`POST /info-links`）・種別変更（関連/裏付け/反証）・自分が付けた分の棄却。低摩擦で関連を“発生”させる層 |
| **リンクの採否・統制** | **成果物側の管理権限者**（quest_admin／アイデア作成者／コンセプト所有者 等） | 貼られたリンクをどう取り込む/却下するかは成果物側で判断（成果物側の採否ワークフロー＝各ドメイン C/D/コンセプトの別スコープ）。反証の要再評価の受領も成果物側 |
| **`info_curator` の付与/剥奪** | 会社アカウント管理者（`company_account_admin`）／`system_admin` | §N.5。**管理者に情報の上書き編集権は無い**（必要なら自分に curator を付与） |

- **編集可否はサーバーが `can` で返す**（`can.edit_content`＝作成者／`can.curate`＝curator／`can.add_link`＝全員）＝フロントは表示/UX 出し分けのみ・`PATCH`/リンク EP で**必ず再検証**（越権は 403）。
- 認可失敗＝**403 `forbidden`**／他テナントは**404**（存在秘匿）／未認証＝**401 `unauthenticated`**。

---

## N.1 情報の取得（一覧・詳細・ワードクラウド）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /info-items` | 情報一覧（会社横断の知識プール） | クエリ: `q`（title/body_text 全文＝PGroonga §1.11・平文を索引。**画面 SC-50 では「🔍 全文検索」タブ由来**〔クエスト SC-12 と同じ体裁・対象セレクト=すべて/タイトル/本文/要約〕＝一覧タブ DataTable の標準横断検索/列フィルタとは別建て・本文まで探すのは `q` の役割）／`status`（`raw\|curated\|archived`・既定は `archived` 除外）／分類フィルタ（多値可）＝`priority`/`source`/`classification`/`scope`/`target_business`/`impact_class`/`impact_level`/`impact_timing`/`triage`／`category`（#8・多値）／`roots_only`（続報を束ねて根のみ表示・§12-1）／`sort`（`-created_at`〔新着〕/`priority`/`-impact_level`/`due_date`）／`limit`/`cursor`。**DataTable 契約（§1.8.1）**＝列 flags は backend ホワイトリスト一致・カーソル型・`?format=csv`/`?pin_ids=` 対応 | `data`=情報カード配列（`id`/`title`/`summary`〔一覧の抜粋・§12-3〕/`match_snippet`〔**`q` 指定時のみ**＝title＋本文からキーワード周辺を切り出した一致抜粋・両端 …・literal 不在時 null＝要約に出ない一致も可視化・§1.11〕/`status`/`priority`/`impact_class`/`categories[]`/`source`/`source_url`/`due_date`/`created_by`/`created_at`＋`link_count`＋`parent_info_id`/`follow_up_count`〔続報スレッド・§12-1〕）。`page_info.{next_cursor,has_next}` |
| `GET /info-items/{id}` | 情報詳細（全属性＋カテゴリ＋関連リンク＋続報スレッド） | パス: `info_id` | 全属性（§5.33・`body_html`〔サニタイズ済リッチ〕/`summary`）＋`categories[]`（#8）＋`links[]`（`id`/`target_type`/`target_id`/`target_title`/`kind`/`origin`/`score`/`rejected`）＋`tokens_top[]`（ワードクラウド上位）＋`attachments[]`（参考資料・§5.33＝`id`/`original_name`/`size_bytes`/`mime_type`/`uploaded_by`/`uploaded_at`/`url`〔短TTL 署名〕）＋`thread`（**根基準**＝`parent`〔開いているのが続報のとき根／根を開いていれば null〕/`follow_ups[]`〔**根の全続報**・時系列・§12-1〕＝続報を開いても 根→続報… 全体を辿れる・SC-50 §80）＋`can`（`edit_content`〔作成者＝内容編集〕/`curate`〔curator＝属性/triage/status/archive〕/`add_link`〔全員＝関連リンク〕/`follow_up`〔続報登録〕の可否＝サーバー算出）＋`content_revisions[]`〔内容の編集履歴・版/編集者/日時＋`changed_fields`〔前版比で変わったフィールド＝`title`/`body_html`/`source_url`/`attachments`・初版は空・§85〕・Phase C〕 |
| `GET /info-items/{id}/revisions/{revision}/diff` | 版差分（🕘 更新履歴の変更内容・§85＝アイデア D.4 と同型） | パス: `info_id`/`revision`／クエリ: `from`〔既定は `revision-1`〕 | `from_revision`/`to_revision`＋`fields`〔変わったフィールドのみ〕。`title`/`body_html`は`kind=text`＝`segments[]`〔`op`=equal/add/del＋`text`・`body_html`はプレーン化して比較〕、`source_url`/`attachments`は`kind=scalar`＝`old`/`new`〔参考資料は表示名を「・」連結〕。範囲外の版=404・`from>revision`=422。読取専用（会社内 active 全員・N.0） |
| `GET /info-items/word-cloud` | ワードクラウド（保存済みトークン頻度集計・§5.36） | クエリ: 上記の分類フィルタ（絞り込み後の集計）／`limit`（上位語数） | `tokens[]`（`token`/`count`/`weight`）。会社全体 or 絞り込み範囲 |
| `POST /info-items/word-cloud-preview` | **入力ダイアログ内プレビュー**（草稿本文の同期トークン化・§12-2） | ボディ: `body_html`（草稿・サニタイズ後の平文抽出で janome）／`limit` | `tokens[]`（`token`/`count`）。**永続しない ephemeral**＝保存前の可視化用（トリガ＝本文 blur/ボタン） |

- **成果物→関連情報パネル**（動的リンクの表示）は各ドメインに委譲＝`GET /ideas/{id}/related-info`（D）・`GET /quests/{id}/related-info`（C）・`GET /concepts/{id}/related-info`（コンセプト段）。一致度上位 N＋`kind` バッジ／`rejected` は除外。**別個の横断 EP を N に増やさない**（成果物側の read として実装・I ダッシュボード §I.3 と同方針）。

## N.2 情報の登録・編集・状態遷移

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /info-items` | 低摩擦登録（全ユーザー）／**続報登録** | ボディ: `title`（必須）・`body_html?`（リッチ＝保存時に nh3 サニタイズ・§N.7）・`source_url?`（http/https のみ＝422 `invalid_url`）・`parent_info_id?`（**続報＝§12-1**）。ヘッダ `Idempotency-Key`（§1.9） | 作成した情報（`status=raw`）。保存時に **`body_html` サニタイズ→`body_text` 派生→`info_tokens` 再生成→抽出要約 `summary` 生成（すべて同期・§12-2/12-3）**＋類似度で auto `info_links`（既定 `kind=related`）を生成（§N.6）。**`parent_info_id` 指定時は親の未棄却 `info_links` を `origin=auto` でスナップショット複製**（§12-1） |
| `POST /info-items/images` | **貼付画像の再ホスト**（リッチテキスト・§12-4） | multipart: `file`（画像・マジックバイト検証＝§1.10/§N.7）。エディタの paste ハンドラが blob を送る | `{ url }`＝自社ホスト（MinIO）署名 URL。エディタが `img src` をこの URL に置換（外部参照を持ち込まない） |
| `POST /info-items/{id}/attachments` | **参考資料の追加**（内容群・§5.33） | multipart: `files`（複数可・拡張子 allowlist＋サイズ〔1件20MB〕＋マジックバイト検証＝§1.10/§5.12）。**作成者のみ**（curator も不可）・1情報10件まで | 追加後の `attachments[]`（`id`/`original_name`/`size_bytes`/`mime_type`/`uploaded_by`/`uploaded_at`/`url`〔短TTL 署名〕）。不正1件で部分保存しない（先行全件検証） |
| `DELETE /info-items/{id}/attachments/{attachment_id}` | **参考資料の削除**（内容群・§5.33） | — | 204。**作成者のみ**。DB 行＋MinIO オブジェクトを削除（同一 UoW）。他情報配下の id は 404 |

> **フロント UX（登録/詳細とも「保存でまとめて反映」・2026-09-21・アイデア D.3 と同仕様）**＝参考資料の追加/削除は**その場で即時コミットせず**、追加は未アップロードでステージ・既存削除は「削除予定」マーク（元に戻せる）とし、**「保存する」/「登録する」で確定**（追加=`POST attachments`／削除=`DELETE`）。**参考資料の変更も「変更あり」に含める**＝内容/属性が無変更でも添付だけ変えれば保存が走り、完了でダイアログを閉じる。キャンセルなら無変更。※本 EP 自体は単発の add/remove として不変（バッチ化はフロントのまとめ送信）。
| `PATCH /info-items/{id}` | 内容編集（作成者）／キュレーション（curator） | ボディ（部分更新・**フィールド群でオーナー別**）＝**内容＝作成者のみ**（`title`/`body_html`/`source_url`／`status` 非依存・curator も不可）／**キュレーション＝`info_curator` のみ**（`priority`/`source`/`classification`/`scope`/`target_business`/`impact_level`/`impact_class`/`impact_timing`/`triaged_on`/`triage`/`triage_reason`＋`categories[]`〔#8 全置換〕）。curated 属性を付けると `status=raw→curated`。越権フィールドは 403 | 更新後の情報。`body_html`/`title` 変更時は **サニタイズ→`body_text` 派生→`info_tokens`→要約 `summary` 再生成→関連 `score` 再計算**（同期・§N.6・§12-3）＋**内容変更は編集履歴に記録**（Phase C） |
| `POST /info-items/{id}/archive` | アーカイブ（論理削除） | — | `status=archived`＋`archived_at`。**`info_curator` のみ**・物理削除なし（監査保持） |
| `POST /info-items/{id}/unarchive` | アーカイブ解除 | — | `status` を curated（or raw）へ戻す。`info_curator` のみ |
| `DELETE /info-items/{id}` | 削除（本人の未判定のみ） | — | **`status=raw` かつ登録者本人**のみ物理削除可（casual 登録の取消）。curated 済みは 409 `invalid_state`（→ archive を使う） |

- **本文サニタイズ**＝`body`/`title` はユーザー持込テキスト＝**保存はそのまま・表示時に無害化**（フロント/バック both・§N.7）。`source_url` は登録/更新時に http/https 検証（`javascript:` 等は 422）。

## N.3 関連リンク（自動/手動・種別変更・棄却）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /info-links` | 手動リンク追加 | ボディ: `info_item_id`・`target_type`（`ideas\|concepts\|quests\|assumptions`）・`target_id`・`kind?`（既定 `related`）。`origin=manual` | 作成した `info_link`。**active な同一 `(info,target,type)` は 409 `conflict`**（既存を返す/更新に誘導）。**棄却済み（`rejected_at` 有り）の同一組は 409 とせず復活**＝既存行の `rejected_at`→NULL・指定 `kind`/`origin=manual`/`created_by_id` で上書き（UNIQUE 制約で INSERT 不可のため既存行を再活性・成果物側の逆向きピッカーは棄却行を知らずに再追加するため 409 を避ける・N-TC-223） |
| `PATCH /info-links/{id}` | 種別変更（関連↔裏付け↔反証） | ボディ: `kind`（`related\|supporting\|refuting`） | 更新後の `info_link`。**related/supporting→`refuting` への遷移で post-commit＝「根底を揺さぶる」通知 `info_refuting_raised`**（宛先＝成果物の作成者/所有者＋評価者〔投票者〕＋クエスト管理者〔owner/quest_admin〕・付けた本人は除外・§N.6）。`POST /info-links` で `kind=refuting` 起票時も同通知。**要再評価は通知のみ（MVP・成果物側の再評価フラグ/リセットは今後）**。**`disposition != pending`（採用/不採用済み）のリンクは 409 `conflict`（採否ロック・§N.3-採否）** |
| `POST /info-links/{id}/reject` | 自動リンクの棄却 | — | `rejected_at` セット（パネル非表示・**行は残す**）。auto リンクを人が「不要」と判断＝**以後の再計算でも復活しない**（§N.6 の upsert が既存行の `rejected_at` を尊重）。棄却は物理削除でなく論理（監査・再学習の材料に残す）。**`disposition != pending` のリンクは 409 `conflict`（採否ロック）** |
| `POST /info-links/{id}/unreject` | 棄却の取消 | — | `rejected_at` を NULL に。**`disposition != pending` のリンクは 409 `conflict`（採否ロック）** |

- **情報側のリンク操作（追加/種別変更/棄却）は会社内 active ユーザー全員**（`can.add_link`・`info_curator` 管轄外・`status` 非依存・N.0）＝低摩擦で関連を“発生”させる層。**追加は情報側（SC-50/52）だけでなく成果物側（SC-12/SC-22 の「＋ 関連情報を追加」）からも同 `POST /info-links` で行う**（逆向きピッカー＝既存情報を `GET /info-items` で探して選ぶ・双方向・`created_by_id` に関連付けた人を記録）。**貼られたリンクの採否・統制は成果物側の管理権限者に委任**（成果物側の採否ワークフロー＝各ドメイン C/D の別スコープ・下記「採否」参照・反証の要再評価の受領も成果物側）。

### N.3-採否（成果物側の disposition＝FR-41 Phase2）

- **採否は成果物側の管理権限者が「貼られた各リンクをどう扱ったか」を記録する**＝`info_links.disposition`（`pending` 未処理 / `adopted` 採用 / `declined` 不採用）＋`disposition_note`（どう処理・反映したか）＋`disposed_by_id`/`disposed_at`。EP は成果物ドメインに置く（権限が成果物側のため）＝**`PATCH /quests/{id}/related-info/{link_id}`（C.8b）**・**`PATCH /ideas/{id}/related-info/{link_id}`（D）**。
- **設定できるのは管理権限者のみ**＝クエスト: owner/quest_admin／アイデア: 作成者 or 所属クエスト owner/quest_admin（read の門番と同じ可視性＋書込権）。**閲覧は成果物が見える人全員**（状態・メモは透明化）。
- **ロック**＝`disposition != pending` の間は当該リンクの**棄却/棄却解除/種別変更を 409 で拒否**（処理済みの解除→再関連付けで蒸し返るのを防ぐ）。管理者が `disposition=pending` に戻すとロック解除（状態は管理者が随時変更可）。
- **表示への影響**＝related-info read は `declined` も返す（棄却 `rejected_at` は除外）。クライアントは既定パネルで `declined` を隠して件数のみ表示・全画面で未処理/採用/不採用にグループ化。**採用（`adopted`）は情報＋処理メモをクエスト「🏁 結果」タブ（クエスト＋配下アイデア集約・C.8）に載せる**。**採用の「反映」自体は人手**（自動でアイデア化しない）。
- **自動リンク生成は EP を持たない**＝情報保存/成果物保存の内部トリガでサーバーが類似度計算し `info_links(origin=auto, kind=related, score)` を upsert（§N.6）。**通知は出さない**（低コミット・閾値＋上位 N）。
- **`impact_class=threat` は per-link `kind` の初期サジェスト**に使うだけ（自動発火しない）。**要再評価の発火は per-link `refuting`（manual）のみ**（誤爆防止・設計 §11-⑤）。

## N.4 情報カテゴリ（#8・複数可）

- 独立 EP は設けず、**`PATCH /info-items/{id}` の `categories[]` で全置換**（`info_item_categories` を差分適用・`info_curator`）。取得は `GET /info-items/{id}` の `categories[]`。

## N.5 情報判定権限（`info_curator`）の付与/剥奪

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /info-curators` | 情報判定権限の一覧 | — | `data`=`{account_id, display_name, granted_by, granted_at}` の配列（未剥奪のみ・付与日時降順）。**会社アカウント管理者/system_admin のみ**・セッション会社スコープ固定 |
| `POST /info-curators` | 付与 | ボディ: `account_id` | 付与後の一覧 `data`（`UNIQUE(user_id) WHERE revoked_at IS NULL`＝二重付与は 409／会社にいない account は 404 存在秘匿）。会社アカウント管理者/system_admin |
| `DELETE /info-curators/{account_id}` | 剥奪 | — | 204・`revoked_at` セット（論理剥奪・行は残す・監査）。未付与/会社外は 404 |

- **識別子＝`account_id`（管理面の自然キー・2026-09-21 実装）**＝会社アカウント管理は account 中心（`info_curators.user_id` へはサーバーが `account_id→会社DB users` で解決）。スコープ＝**会社（テナント）単位**（設計 §11-①）＝`company_id` は受けずセッション会社固定。quest 系権限（C.0 の6権限）とは別軸。**付与導線＝会社アカウント管理（SC-93 `/admin/accounts`）に同居**＝`InfoCuratorSection`。**UI はクエストグループ管理（SC-90）と同構成**＝付与済みユーザーの**一覧（DataTable・行の ⋯ メニューから「情報判定権限を剥奪」）**＋**「＋ 権限を付与する」ボタン→ メンバー追加ダイアログ風**（会社ディレクトリ検索＋もっと見る＋各行の「付与」で連続付与）。**配置＝アカウント一覧の次**（SC-92 と統一）。**加えて、system_admin が“自社”を SC-92 会社詳細（`/admin/companies/{id}`）で開いたとき（セッション会社＝表示中会社）にも同セクションを表示する（2026-09-21 B 対応）**＝session-scoped API がそのまま自社に効くため新 EP 不要。**他社（表示中会社≠セッション会社）では非表示**（クロステナント付与は未対応）。

## N.6 類似度・ワードクラウド（派生・内部処理）

- **トークン化＝`janome`**（FR-39 チャット要約で導入済み・純Python・MIT を再利用＝DRY）。**`body_text`（平文）**をストップワード除去→`info_tokens`（§5.36）。**保存時に同期**（単一情報は軽量＝バックグラウンド不要・§12-2）。一覧ワードクラウド＝保存済みトークンの集計／入力ダイアログのプレビュー＝`POST /info-items/word-cloud-preview`（草稿を同期トークン化・永続しない）。
- **要約＝抽出型 `summarize_text`（`app/tenant/quests/summarize.py`・janome・オフライン・無料・決定的）を再利用**（§12-3）。`body_text` から**保存時に同期生成**し `summary` へ。外部送信ゼロ＝内部情報でも privacy 問題なし。LLM 生成は将来 seam（`summarize_text` 差替え・要約用途は `claude-haiku-4-5` 適・内部データ外部送信ポリシーは Phase2）。
- **一致度（類似度）**＝情報本文と アイデア/コンセプト本文の**キーワード重なり／TF-IDF**。**閾値＋上位 N**。**事前計算して `info_links.score` に保存**（都度計算しない・§5.35）。
- **再計算トリガ**＝情報の追加/更新（`POST`/`PATCH /info-items`）／アイデア・コンセプトの保存（D/コンセプト段）。auto リンクは **upsert（既存行を尊重）**＝既定 `kind=related`・**人が変えた種別（`kind`）を保持**し、**棄却（`rejected_at`）も保持する**。すなわち **一度棄却した auto リンクは再計算で復活しない**（`(info_item_id, target_type, target_id)` UNIQUE の既存行に対し `score` だけ更新し、`rejected_at`/`kind` は上書きしない）。新規の (info,target) 組だけ新たに auto 生成する。
- **反証の揺さぶり（実装済み・2026-09-21）**＝`info_links.kind=refuting` への遷移（`PATCH`）または `refuting` 起票（`POST`）で post-commit＝H 通知 **`info_refuting_raised`**（新設・catalog 追加済）を dispatch。宛先＝ideas なら作成者＋評価者（投票者）＋クエスト管理者（owner/quest_admin）／quests なら owner＋quest_admin／concepts・assumptions は未実装ドメイン＝宛先なし（no-op）。付けた本人は除外・棄却済みは揺さぶらない。ref は ideas→`ref_idea_id`／quests→`ref_quest_id`（通知から成果物へ遷移）。**要再評価は通知のみ（MVP）**＝成果物側の再評価フラグ/リセット（コンセプト機能 §3.5）は今後。1 情報の反証 → 1 前提 → 複数コンセプトへ波及。
- **MVP＝キーワード/TF-IDF**／**Phase2＝埋め込みベクトル（意味的類似）・矛盾の自動検出（LLM 支援は別途コスト/データ保護判断）**。

## N.7 エラー・セキュリティ

- **SSRF＝対象外**（サーバフェッチ無し・手動貼付のみ）。
- **`source_url` は http/https のみ**（それ以外は 422 `invalid_url`）。
- **リッチテキストのサニタイズ（最重要・§12-4）**＝`body_html` は**保存時＋表示時に許可リスト方式で無害化**（`nh3`〔Rust製〕推奨・新規依存）。許可タグ例＝p/br/h1-3/strong/em/ul/ol/li/a(href http(s))/blockquote/code/table 系/img（**自社ホスト src のみ**）。on* 属性・style・script・`javascript:` は全弾き。派生 `body_text` は平文（表示は素の HTML でなくサニタイズ済 `body_html`）。（XSS・コーディング規約 §2.2・[セキュリティ対策一覧](../WEBアプリ開発時のセキュリティ対策一覧.md)）。
- **画像＝MinIO 再ホスト**（§12-4）＝`POST /info-items/images` で自社ホストへアップロード（マジックバイト検証＝§1.10）。外部 `img src` はサニタイズで除去/再ホスト（許可 src は自社ホストのみ＝トラッキング/referer 漏れ防止）。
- **削除ガード**＝curated 済みの物理削除は 409 `invalid_state`（archive を使う）。
- **著作権/PII**＝外部本文の保存・保持期間の方針は運用で定める（出典 URL 明記で引用性・トレーサビリティ）。
- **テナント分離**＝会社DB（会社横断の知識プール・他テナント参照不可＝404）。

## N.8 画面対応（SC-xx 新規・未採番）

- **情報インプット 一覧**（`GET /info-items`＝DataTable サーバー委譲）／**登録**（`POST`＝低摩擦・全ユーザー）／**詳細**（`GET /info-items/{id}`＝属性付与〔`info_curator`〕・ワードクラウド・関連リンク）。
- 各成果物（アイデア/コンセプト/クエスト）画面の**「関連情報」パネル**＝`GET /{artifact}/related-info`（一致度上位＋`kind` バッジ・手動追加/棄却）。
- 情報判定権限の付与＝会社アカウント管理（SC-90 系）に同居。

## N.9 MVP 境界・Phase2

- **MVP**＝手動貼付＋属性（低摩擦=全ユーザー／curated=`info_curator`）／キーワード類似の**自動リンク（既定=related）**／手動種別変更＋手動追加/棄却／**反証→通知＋要再評価（per-link）**／XSS・URL 検証／ワードクラウド。**＋2026-09-19 追加（§12）**＝続報（`parent_info_id`・親リンクをスナップショット複製）／ワードクラウド同期化＋ダイアログ内プレビュー（`POST /info-items/word-cloud-preview`）／要約（抽出型 `summarize_text` を保存時同期生成）／リッチテキスト（`body_html`+`body_text`・nh3 サニタイズ・画像 `POST /info-items/images` で MinIO 再ホスト）。
- **Phase2**＝埋め込み類似・矛盾の自動検出・**LLM 生成要約**（`summarize_text` 差替え・内部データ外部送信ポリシー要）・enum の会社ごと拡張（#7/#8）・重複統合（MVP は同一 URL 警告のみ）。
