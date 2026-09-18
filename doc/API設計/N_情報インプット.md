# ドメイン N. 情報インプット（外部情報の知識レイヤ・テナントプレーン）＝設計ドラフト（2026-09-18）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可・§1.8/§1.8.1 一覧/DataTable・§1.9 冪等・§1.10 添付・§1.11 全文検索）を参照。
> 設計の正＝[情報インプット機能 設計](../設計ドラフト/情報インプット機能_設計.md)（残論点は §11 で確定）。データモデル＝[データモデル](../データモデル.md) §5.33〜5.37・§3（`info_*` enum）。FR は要件定義へ起票予定（設計 §10-4）。

対象画面＝**情報インプット 一覧/登録/詳細（SC-xx 新規・未採番）＋各成果物（アイデア/コンセプト/クエスト）の「関連情報」パネル**。すべて**テナントAPI**（会社DB＝`info_items`/`info_item_categories`/`info_links`/`info_tokens`/`info_curators`）。**サーバは外部 URL を取りに行かない（手動貼付のみ＝SSRF 対象外・§N.7）**。

## N.0 アクター・認可スコープ

**情報プールは会社（テナント）横断の知識レイヤ**＝クエスト門番（`can_access_quest`）ではなく、**会社内の active ユーザーなら閲覧可**。書き込みは段階権限:

| アクター | できること |
| --- | --- |
| 会社内の active ユーザー全員 | **低摩擦登録**（`title`＋任意 `body`/`source_url`＝`status=raw`）／一覧・詳細の閲覧／**自分視点の手動リンク追加・棄却**（成果物への関連付け） |
| `info_curator`（データモデル §5.37） | 上記に加え **属性付与・情報判定（triage）・`status` 遷移（raw→curated→archived）・アーカイブ**／自動リンクの種別変更（関連↔裏付け↔反証） |
| 会社アカウント管理者（`company_account_admin`）／`system_admin` | **`info_curator` の付与/剥奪**（§N.5） |

- 低摩擦登録の属性（title/body/source_url）以外の**属性付与・判定・アーカイブは `info_curator` のみ**（サーバー再検証・raw→curated）。**登録者本人は自分の raw を編集/削除**できるが、curated 後は `info_curator` のみ編集可（設計 §3/§11-③）。
- 認可失敗＝**403 `forbidden`**／他テナントは**404**（存在秘匿）／未認証＝**401 `unauthenticated`**。

---

## N.1 情報の取得（一覧・詳細・ワードクラウド）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /info-items` | 情報一覧（会社横断の知識プール） | クエリ: `q`（title/body 全文＝PGroonga §1.11）／`status`（`raw\|curated\|archived`・既定は `archived` 除外）／分類フィルタ（多値可）＝`priority`/`source`/`classification`/`scope`/`target_business`/`impact_class`/`impact_level`/`impact_timing`/`triage`／`category`（#8・多値）／`sort`（`-created_at`〔新着〕/`priority`/`-impact_level`/`due_date`）／`limit`/`cursor`。**DataTable 契約（§1.8.1）**＝列 flags は backend ホワイトリスト一致・カーソル型・`?format=csv`/`?pin_ids=` 対応 | `data`=情報カード配列（`id`/`title`/`status`/`priority`/`impact_class`/`categories[]`/`source`/`source_url`/`due_date`/`created_by`/`created_at`＋`link_count`）。`page_info.{next_cursor,has_next}` |
| `GET /info-items/{id}` | 情報詳細（全属性＋カテゴリ＋関連リンク） | パス: `info_id` | 全属性（§5.33）＋`categories[]`（#8）＋`links[]`（`id`/`target_type`/`target_id`/`target_title`/`kind`/`origin`/`score`/`rejected`）＋`tokens_top[]`（ワードクラウド上位）＋`can`（編集/判定/アーカイブ可否＝サーバー算出） |
| `GET /info-items/word-cloud` | ワードクラウド（トークン頻度集計・§5.36） | クエリ: 上記の分類フィルタ（絞り込み後の集計）／`limit`（上位語数） | `tokens[]`（`token`/`count`/`weight`）。会社全体 or 絞り込み範囲 |

- **成果物→関連情報パネル**（動的リンクの表示）は各ドメインに委譲＝`GET /ideas/{id}/related-info`（D）・`GET /quests/{id}/related-info`（C）・`GET /concepts/{id}/related-info`（コンセプト段）。一致度上位 N＋`kind` バッジ／`rejected` は除外。**別個の横断 EP を N に増やさない**（成果物側の read として実装・I ダッシュボード §I.3 と同方針）。

## N.2 情報の登録・編集・状態遷移

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /info-items` | 低摩擦登録（全ユーザー） | ボディ: `title`（必須）・`body?`・`source_url?`（http/https のみ＝422 `invalid_url`）。ヘッダ `Idempotency-Key`（§1.9） | 作成した情報（`status=raw`）。保存時に `info_tokens` 再生成＋類似度で **auto `info_links`（既定 `kind=related`）**を生成（§N.6） |
| `PATCH /info-items/{id}` | 属性付与・編集 | ボディ（部分更新）＝raw の本人＝`title`/`body`/`source_url` のみ／`info_curator`＝全属性（`priority`/`source`/`classification`/`scope`/`target_business`/`impact_level`/`impact_class`/`impact_timing`/`triaged_on`/`triage`/`triage_reason`＋`categories[]`〔#8 全置換〕）。curated 属性を付けると `status=raw→curated` | 更新後の情報。`body`/`title` 変更時は `info_tokens`＋関連 `score` を再計算（§N.6） |
| `POST /info-items/{id}/archive` | アーカイブ（論理削除） | — | `status=archived`＋`archived_at`。**`info_curator` のみ**・物理削除なし（監査保持） |
| `POST /info-items/{id}/unarchive` | アーカイブ解除 | — | `status` を curated（or raw）へ戻す。`info_curator` のみ |
| `DELETE /info-items/{id}` | 削除（本人の未判定のみ） | — | **`status=raw` かつ登録者本人**のみ物理削除可（casual 登録の取消）。curated 済みは 409 `invalid_state`（→ archive を使う） |

- **本文サニタイズ**＝`body`/`title` はユーザー持込テキスト＝**保存はそのまま・表示時に無害化**（フロント/バック both・§N.7）。`source_url` は登録/更新時に http/https 検証（`javascript:` 等は 422）。

## N.3 関連リンク（自動/手動・種別変更・棄却）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /info-links` | 手動リンク追加 | ボディ: `info_item_id`・`target_type`（`ideas\|concepts\|quests\|assumptions`）・`target_id`・`kind?`（既定 `related`）。`origin=manual` | 作成した `info_link`。同一 `(info,target)` 重複は 409 `conflict`（既存を返す/更新に誘導） |
| `PATCH /info-links/{id}` | 種別変更（関連↔裏付け↔反証） | ボディ: `kind`（`related\|supporting\|refuting`） | 更新後の `info_link`。**`kind=refuting` へ変更（manual）で post-commit＝「根底を揺さぶる」通知＋要再評価 flag**（成果物の作成者＋評価者・§N.6・コンセプト機能 §3.5） |
| `POST /info-links/{id}/reject` | 自動リンクの棄却 | — | `rejected_at` セット（パネル非表示・行は残す）。auto リンクを人が「不要」と判断 |
| `POST /info-links/{id}/unreject` | 棄却の取消 | — | `rejected_at` を NULL に |

- **自動リンク生成は EP を持たない**＝情報保存/成果物保存の内部トリガでサーバーが類似度計算し `info_links(origin=auto, kind=related, score)` を upsert（§N.6）。**通知は出さない**（低コミット・閾値＋上位 N）。
- **`impact_class=threat` は per-link `kind` の初期サジェスト**に使うだけ（自動発火しない）。**要再評価の発火は per-link `refuting`（manual）のみ**（誤爆防止・設計 §11-⑤）。

## N.4 情報カテゴリ（#8・複数可）

- 独立 EP は設けず、**`PATCH /info-items/{id}` の `categories[]` で全置換**（`info_item_categories` を差分適用・`info_curator`）。取得は `GET /info-items/{id}` の `categories[]`。

## N.5 情報判定権限（`info_curator`）の付与/剥奪

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /info-curators` | 情報判定権限の一覧 | — | `data`=`{user_id, display_name, granted_by, granted_at}` の配列。**会社アカウント管理者/system_admin のみ** |
| `POST /info-curators` | 付与 | ボディ: `user_id` | 付与済み（`UNIQUE(user_id) WHERE revoked_at IS NULL`＝二重付与は 409）。会社アカウント管理者/system_admin |
| `DELETE /info-curators/{user_id}` | 剥奪 | — | `revoked_at` セット（論理剥奪・行は残す・監査） |

- スコープ＝**会社（テナント）単位**（設計 §11-①）。quest 系権限（C.0 の6権限）とは別軸。付与導線は会社アカウント管理（SC-90 系）に同居させる想定（画面は §N.8）。

## N.6 類似度・ワードクラウド（派生・内部処理）

- **トークン化＝`janome`**（FR-39 チャット要約で導入済み・純Python・MIT を再利用＝DRY）。ストップワード除去→`info_tokens`（§5.36）。
- **一致度（類似度）**＝情報本文と アイデア/コンセプト本文の**キーワード重なり／TF-IDF**。**閾値＋上位 N**。**事前計算して `info_links.score` に保存**（都度計算しない・§5.35）。
- **再計算トリガ**＝情報の追加/更新（`POST`/`PATCH /info-items`）／アイデア・コンセプトの保存（D/コンセプト段）。auto リンクは upsert（既定 `kind=related`・人が変えた種別は保持）。
- **反証の揺さぶり**＝`info_links.kind=refuting`（manual）への遷移で post-commit＝対象成果物の作成者＋評価者へ H 通知（`notification_type` は要追加検討＝`idea_updated` 相当 or 新設）＋「要再評価」フラグ（コンセプト機能 §3.5）。1 情報の反証 → 1 前提 → 複数コンセプトへ波及。
- **MVP＝キーワード/TF-IDF**／**Phase2＝埋め込みベクトル（意味的類似）・矛盾の自動検出（LLM 支援は別途コスト/データ保護判断）**。

## N.7 エラー・セキュリティ

- **SSRF＝対象外**（サーバフェッチ無し・手動貼付のみ）。
- **`source_url` は http/https のみ**（それ以外は 422 `invalid_url`）。**本文は表示時サニタイズ**（XSS・コーディング規約 §2.2・[セキュリティ対策一覧](../WEBアプリ開発時のセキュリティ対策一覧.md)）。
- **削除ガード**＝curated 済みの物理削除は 409 `invalid_state`（archive を使う）。
- **著作権/PII**＝外部本文の保存・保持期間の方針は運用で定める（出典 URL 明記で引用性・トレーサビリティ）。
- **テナント分離**＝会社DB（会社横断の知識プール・他テナント参照不可＝404）。

## N.8 画面対応（SC-xx 新規・未採番）

- **情報インプット 一覧**（`GET /info-items`＝DataTable サーバー委譲）／**登録**（`POST`＝低摩擦・全ユーザー）／**詳細**（`GET /info-items/{id}`＝属性付与〔`info_curator`〕・ワードクラウド・関連リンク）。
- 各成果物（アイデア/コンセプト/クエスト）画面の**「関連情報」パネル**＝`GET /{artifact}/related-info`（一致度上位＋`kind` バッジ・手動追加/棄却）。
- 情報判定権限の付与＝会社アカウント管理（SC-90 系）に同居。

## N.9 MVP 境界・Phase2

- **MVP**＝手動貼付＋属性（低摩擦=全ユーザー／curated=`info_curator`）／キーワード類似の**自動リンク（既定=related）**／手動種別変更＋手動追加/棄却／**反証→通知＋要再評価（per-link）**／XSS・URL 検証／ワードクラウド。
- **Phase2**＝埋め込み類似・矛盾の自動検出・LLM 支援・enum の会社ごと拡張（#7/#8）・重複統合（MVP は同一 URL 警告のみ）。
