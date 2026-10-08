# ドメイン F. 評価（テナントプレーン）＝詳細確定（2026-08-07）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可〔クエスト内6権限〕・§1.8 一覧・§1.9 冪等）を参照。認証系は [`A_認証・セッション.md`](./A_認証・セッション.md)、クエスト/パーティー/権限・状態機械/凍結は [`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md)、アイデアは [`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md)、チャットは [`E_チャット・リアクション・魔法発動.md`](./E_チャット・リアクション・魔法発動.md)。本ファイルはドメイン F の分割レビュー成果。

対象画面＝**SC-25（評価画面・モーダル）/ SC-22（§4.6 右レール＝評価結果）**。すべて**テナントAPI**（会社DB＝`evaluations`/`evaluation_scores`/`ideas`〔`is_selected`〕。XP/コイン記帳は `activities`＝ドメイン G 委譲）。データモデル §5.21/§5.22・§3（`evaluation_status`〔draft/submitted〕・`evaluation_visibility`〔party/limited〕・`evaluation_aspect`〔novelty/impact/feasibility/fit/cost〕）・§7（XP/コイン算定）・§8-⑥/§8-⑱。コーディング規約 §1（認可・業務ロジックはサーバー強制・フロントは表示/UX のみ）・§2.2（セキュリティ）準拠。

**この分割レビューでユーザー選択により確定（2026-08-07）**:
- **選定（`is_selected`）は F 保有**＝`POST/DELETE /ideas/{id}/select`（owner/quest_admin・**複数アイデア選定可**）。投稿者へ XP+200・**取消時も剥奪しない**（F.3）。
- **限定公開（`visibility=limited`）は範囲外へ完全非表示**（集計も返さない・F.1）。
- **投稿者コインの確定トリガ**＝**(a) `evaluator` 権限保持者が全員 `submitted` 済み**、**(b) `completed` 遷移**の**いずれか早い方**でアイデア単位に1回（F.4・データモデル §8-⑱）。

## F.0 アクター・認可スコープ（門番＝パーティー所属＋`evaluator` 権限）

**アクセスの門番＝パーティー所属**（ドメイン C.0/D.0/E.0 と同一）。当該アイデアの属するクエストの `quest_members`（`quest_id`×`user_id`）に**有効な行（`removed_at IS NULL`）が無い**ユーザーは、評価の閲覧・入力・選定いずれも **404 `not_found`**（存在秘匿・§1.6・可視範囲＝パーティー内のみ）。また、当該クエストが属する**クエストグループにユーザーが所属していない場合**（`quest_group_members` に `removed_at IS NULL` の行が無い）も同様に 404。**下書き（`draft`）アイデアは評価対象外**（評価は公開済みアイデアに対して行う・非公開は 404 相当で評価導線を出さない）。

| 操作 | 必要な権限（`permission_type`・データモデル §5.9） | 補足 |
| --- | --- | --- |
| 評価結果の閲覧（集計） | **パーティー所属**（＋各評価の `visibility` に従う） | SC-22 §4.6・limited は範囲外に完全非表示（F.1） |
| 自分の評価/下書きの取得・入力 | `evaluator`（作成者は既定で評価者・付与は owner/quest_admin） | SC-25。無い場合は評価導線を出さない（SC-22 §2） |
| アイデア選定/選定解除 | `owner`/`quest_admin` | `is_selected` 変更＝F.3（投稿者へ XP+200） |
| AI 評価の再生成 | `evaluator`（FR-27・当該クエストの評価者権限） | F.7.3。**owner/quest_admin でも評価者権限が無ければ不可**（2026-10-08 決定）。自動起動（共有時）はシステム経路で権限不要（F.7.1） |

- **クエスト完了（`quest_status=completed`）で書き込み凍結**（**全体像の単一正＝C.5**・本ドメインは自 EP を再掲）: `PUT /ideas/{id}/evaluation`（下書き/確定）・`POST/DELETE /ideas/{id}/select` は **409 `conflict`（`invalid_state`）**でサーバー拒否＝読み取り専用。※投稿者コインの一括確定は `completed` 遷移の**副作用として実行**されるもので、凍結対象の「書き込み操作」ではない（F.4）。
- 認可失敗＝**403 `forbidden`**／範囲外（非パーティー・他グループ・他テナント・下書き）は**404 `not_found`**／未認証は**401 `unauthenticated`**。
- **`my_permissions`（評価可否・選定可否）はサーバーが算出して返す**（フロントは権限判定を再実装しない・コーディング規約 §1）。UX 便宜であり、実アクションは各 EP で再検証。

---

## F.1 評価の取得（自分の評価・集計結果）

| メソッド/パス | 概要 | リクエスト（パス） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /ideas/{idea_id}/evaluation/me` | 自分の評価/下書きを取得（SC-25 の読み込み） | パス: `idea_id` | 自分の評価（`status`・`scores`〔`{aspect:score}`〕・`comments`〔`{aspect:comment}`〕・`overall_comment`・`visibility`・`submitted_at`）。未作成なら `null`/空 |
| `GET /ideas/{idea_id}/evaluation` | 評価結果の集計を取得（SC-22 §4.6 右レール） | パス: `idea_id` | `aspects`〔観点別平均 `{aspect: avg}`〕・`overall_avg`・`evaluator_count`〔提出済み**人間**評価者数〕・`evaluators[]`〔各**人間**評価者の氏名/**観点別スコア** `{aspect:score}`/**観点別コメント** `{aspect:comment}`/総評/`visibility`/`submitted_at`〕・**`ai_evaluation`**〔AI 評価の別枠ブロック・F.7.4〕・`coin`〔`{projected, finalized?, finalized_at?}`〕・`my_evaluation`（`me` の要約） |

- **`visibility` の適用（表示制御）**: 各評価（`evaluations.visibility`）ごとに閲覧範囲を判定する。
  - `party` の評価＝パーティー全員に表示。
  - `limited` の評価＝**投稿者＋その評価者＋`owner`/`quest_admin` のみ**に表示。**範囲外には完全非表示**（当該評価のスコア/コメント/総評を一切返さず、集計平均の分母にも含めない＝存在も出さない）。
  - `private`（**非公開**・2026-10-08 追加）の評価＝**投稿者＋その評価者のみ**に表示（`limited` より 1 段狭く・**`owner`/`quest_admin` にも非表示**）。範囲外の扱いは `limited` と同じ＝完全非表示（集計の分母にも含めない）。
  - **投稿者（作成者＝被評価者）は常に可視集合に含まれる**（party/limited/private いずれも投稿者は見える）＝自分のアイデアへの全評価を公開範囲に関わらず閲覧できる（#13 評価詳細は投稿者専用＝「範囲外で非表示」は起きない）。
  - したがって **`GET /ideas/{id}/evaluation` の集計（`aspects`/`overall_avg`/`evaluators[]`/`evaluator_count`）は「閲覧者に可視な評価のみ」で算出**する（サーバーが閲覧者ごとに絞る）。可視な評価が 0 件なら「評価待ち/非公開」を表す空集計を返す。
- **コインの平均は集計表示とは別系統**: 投稿者コインの算定は **`visibility` を無視して全 `submitted` 評価**で行う（`visibility` は表示制御のみ・データモデル §5.18 と同じく評価も「装飾ではなく実データだが公開範囲だけ制御」）。`coin.projected`＝現時点の全 `submitted` 評価からの見込み額、`coin.finalized`＝確定済みなら確定額（F.4）。
- **コスト観点**: `cost` は「低コストほど高得点（★5＝非常に低コスト）」（データモデル §5.22・SC-25 §4.1）。スコアの符号反転はしない（入力値をそのまま平均）。
- **AI 評価の算入（FR-50・F.7）**: `evaluator_kind='ai'` の評価も**他の `submitted` 評価と同列で数値集計に含める**（`aspects`/`overall_avg`、及びコイン算定）＝ `evaluator_kind` を区別せず集計する（DRY）。ただし**個票の表示は分離**＝`evaluators[]` は人間評価のみ・AI の個票は `ai_evaluation` 別枠で返す（F.7.4）。`evaluator_count` は人間の提出済み人数（AI は含めない＝人数指標の意味を保つ）。AI 評価も `visibility=party` なので通常は全員に可視。

### F.1.1 コメントの代表表示（SC-22/SC-61 評価パネル・2026-10-08）

評価者が増えても右レールが縦に伸びないよう、**観点別コメントと総評は「代表1件」に絞って表示**する（全件は #13 評価詳細＝F.1.2）。

- **代表の選定**＝パネル上部の**タブで切替**（**高評価**＝その観点で最高得点／**合意**＝その観点の平均に最も近い〔**既定**〕／**懸念**＝最低得点）。タブ UI は**ダッシュボード Zone B（未投票/承認待ち/下書き）と同じ `.dash-tabs/.dash-tab`**（下線タブ）に統一。
- **母集団＝その観点にコメントを付けた評価者**（コメント無しは代表対象外）。総評は**評価者の全体平均**で同基準。**同点は先に確定した評価**（`submitted_at` が早い方）を採る。
- **母集団は閲覧者に可視な評価のみ**（visibility 準拠・§F.1）＝投稿者は全評価・非投稿者は可視範囲内。
- 各代表行に**「他N件 →」**（その観点/総評に付いた他コメント数）を添え、クリックで #13 評価詳細を開く。1件のみなら出さない。
- **選定はクライアント側で行ってよい**（候補数が小さく、タブ切替を無通信で即応させるため）。本 EP の `evaluators[]` が各評価者の観点別スコア・コメント・総評・`submitted_at`（並び順/同点タイブレーク用）を含むので追加 EP は不要。
- **AI 評価は代表選定・タブの対象外**＝常に別枠 `ai_evaluation` に全文表示（F.7.4）。
- 表示順：パネル上から **スコア（観点別平均バー）→ 仕切り線 → 「コメント」見出し（`評価結果` と同格の `card-title`）→ タブ → 総評（代表1）→ 観点別コメント（観点ごと代表1・観点バッジを行頭）**。

### F.1.2 評価詳細モーダル（#13・2026-10-08）

パネルが代表1件に絞るため、**全件（評価者ごとの観点別スコア＋観点別コメント＋総評）を縦に一覧する「評価詳細」モーダル**を SC-22/SC-61 から開く（**URL 付きモーダル**標準・Intercept＋フルページ fallback）。

- **投稿者専用ではなく、閲覧者全員が開ける**（当初の「投稿者のみ」案から変更＝パネルが代表のみになったため非投稿者も全件を見たい）。表示は**各自の可視範囲に従う**（投稿者は自分のアイデアへの全評価・非投稿者は visibility 準拠＝範囲外は含めない）。
- 内容＝**評価者ごとの個別スコアカード**（観点別の得点内訳＋観点別コメント〔未入力は「コメントなし」で行高を揃える〕＋総評）。**AI 評価も1枚のカードとして別枠表示**（紫アクセント・🤖）。
- **データは本 EP（`evaluators[]`＋`ai_evaluation`）を再利用＝新規 EP は作らない**。

---

## F.2 評価の登録・更新（下書き / 確定）

| メソッド/パス | 概要 | リクエスト（パス/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `PUT /ideas/{idea_id}/evaluation` | 自分の評価を登録/更新（upsert・`UNIQUE(idea_id, evaluator_id)`） | パス: `idea_id`／ボディ: `{scores:{aspect:1..5}, comments?:{aspect:string}, overall_comment?, visibility:'party'\|'limited', status:'draft'\|'submitted'}` | 200/201＋保存後の自分の評価（F.1 `me` 形）＋`xp_delta`〔この確定で実際に付与した評価 XP＝初回 submitted は +30・冪等/下書き/参照時は 0＝獲得フィードバック #8・金額の正はサーバー〕。`status=submitted` で評価者 XP+30・確定トリガ判定（F.4） |

- **下書き（`draft`）**: 観点が揃わなくても保存可（部分可・`overall_comment` 空可）。**本人のみ可視**・XP/コイン付与なし。何度でも上書き。
- **確定（`submitted`）**: サーバーが**全5観点（`novelty`/`impact`/`feasibility`/`fit`/`cost`）が 1..5 で揃い、`overall_comment` が非空**であることを検証（未充足は **422 `validation_error`**・`errors[].field`）。初回確定時に `submitted_at` を記録。
  - **評価者 XP+30 を即時付与**（`activities`＝`kind=xp_gain`,`reason=evaluation`,`ref_type=evaluations`,`ref_id=evaluation_id`・ドメイン G の repo を同一 UoW で呼ぶ）。**評価者1人1評価**（`UNIQUE(idea_id, evaluator_id)`）につき**1回のみ**（`activities` の存在で冪等＝再確定/編集で再付与しない）。日次上限の対象外（§8-⑥ の上限リストに評価は無い）。
  - 保存後、**投稿者コインの確定トリガ (a) を判定**（F.4）。
- **再編集**: 確定後も**クエスト完了までは自分の評価を更新可**（スコア/コメント/総評/`visibility`）。ただし**確定済みコインは再計算しない**（F.4・§8-⑥＝スナップショット）。表示平均（F.1）は最新値で再計算される。
- **Mass Assignment 防止**（§2.2）: `evaluator_id`（＝セッションユーザー）・`submitted_at`・監査列はクライアント入力を受けない。`scores` のキーは `evaluation_aspect` enum 限定・値は 1..5（範囲外は 422）。他人の評価は更新不可（`evaluator_id` は常に自分）。
- **完了凍結**: `quest_status=completed` で **409 `invalid_state`**（canonical C.5）。
- **冪等（§1.9）**: PUT はリソース upsert で自然冪等。XP+30 は上記の存在チェックで二重付与を防ぐため、`Idempotency-Key` は任意。

---

## F.3 アイデア選定（`is_selected`・複数可）

| メソッド/パス | 概要 | リクエスト（パス） | レスポンス |
| --- | --- | --- | --- |
| `POST /ideas/{idea_id}/select` | アイデアを選定（`is_selected=true`） | パス: `idea_id` | 200（`{id, is_selected:true, xp_awarded}`）。投稿者へ XP+200・`follow_selection` 通知（H）。`xp_awarded`＝**この呼び出しで新規付与したか**（初回のみ true・冪等＝再選定は false）＝フロントは true の時だけ祝福演出を出す |
| `DELETE /ideas/{idea_id}/select` | 選定を解除（`is_selected=false`） | パス: `idea_id` | 200（`{id, is_selected:false, xp_awarded:false}`）。**XP は剥奪しない** |

- **権限＝`owner`/`quest_admin`**（それ以外は 403）。`is_selected` はクライアント入力では変えられず本 EP 専任（D の Mass Assignment 方針・D 注記「`is_selected` の変更は F/G の責務」）。
- **複数アイデア選定可**（アイデア単位のトグル・上限は設けない）。
- **投稿者 XP+200**（`activities`＝`kind=xp_gain`,`reason=selection`,`ref_type=ideas`,`ref_id=idea_id`・G の repo）: **初回選定時に1回だけ付与**し、**選定解除でも剥奪しない・再選定でも再付与しない**（`activities` 存在で冪等＝「付与後取消なし」方針と一貫・残高マイナス回避）。選定は owner/quest_admin のみのため不正余地は小さい（データモデル §8-⑱）。
- **通知**（H）: 選定で当該アイデアのフォロワーへ `follow_selection`。
- **完了凍結**: `completed` で **409 `invalid_state`**（選定/解除とも）。選定は `evaluating`〜`completed` の過程で行う運用（C.7 の「選定は enum 値ではなく行為」に整合）。

---

## F.4 投稿者コインの一括確定（§7 / §8-⑥/⑱ canonical・F は挙動を規定）

投稿者コインは**評価連動のみ**（希少）。算定と確定は次のとおり（正は データモデル §7／トリガの具体は §8-⑱）。

- **金額**＝`round(当該アイデアの全 submitted 評価者×全5観点スコアの均等平均 avg × 10)`・**最大 50/アイデア**（`avg∈[1,5]`→`coin∈[10,50]`）。`visibility` は無視（全 `submitted` 評価で算定）。提出済み評価が 0 件なら付与なし（0 コイン）。
- **確定トリガ＝アイデア単位で「いずれか早い方」・1回のみ**:
  - **(a) 早期確定**＝`PUT ... submitted` の後、サーバーが「当該クエストの `evaluator` 権限保持者（有効所属 `removed_at IS NULL`）**全員がこのアイデアを `submitted` 済み**」を満たすと判定した瞬間に確定・付与。
  - **(b) 完了時確定**＝クエストが `completed` に遷移した時（**ドメイン C の `POST /quests/{id}/transition`（to=`completed`）の副作用**）に、**未確定の全 published アイデア**をまとめて確定・付与。
- **冪等・不可逆**: 確定は投稿者へ `activities`（`kind=coin_gain`,`reason=evaluation_coin`,`ref_type=ideas`,`ref_id=idea_id`）を**アイデア単位に1行**追記。**同一アイデアに当該行が既にあれば再確定しない**（存在チェック＝投票 XP と同方式）。同時実行（(a) と (b) の競合）は**トランザクション＋存在チェック**（実装では `activities` の当該行に対する部分ユニーク/`INSERT ... ON CONFLICT DO NOTHING` 等）で二重付与を防ぐ。**確定後は再計算・取消をしない**（評価の後編集があってもコインはスナップショット固定・§8-⑥）。
- **評価者集合のスナップショット**＝判定時点の `evaluator` 権限保持者。確定後に評価者を追加/削除しても再計算しない。
- **残高整合**（データモデル §7）: 付与は `activities` 追記＋`users.coin_balance` 更新を同一トランザクションで行う（元帳が真実・残高はキャッシュ）。

---

## F.5 通知連携（ドメイン H 連携点）

書込側（F の application）が**本体コミット後の post-commit で** H の `notify()` を呼ぶ（配信/テンプレ/多言語/一覧は**ドメイン H**・§3.5-(3)）:

| 契機 | 通知種別（`notification_type`・§3） | 宛先 |
| --- | --- | --- |
| 評価の確定（`submitted`） | `follow_evaluation` | 当該アイデアのフォロワー（`follows`・評価者自身は除外） |
| アイデア選定（`POST /select`） | `follow_selection` | 当該アイデアのフォロワー |
| **AI 評価の生成失敗**（`idea_evaluate` job failed・F.7） | `ai_task_failed`（§S・`ref_idea_id`） | **評価者権限〔FR-27〕保持者＋owner/quest_admin**（手動再生成を促す・2026-10-08 決定） |

- 通知レコードは `notifications`（§5.24）に `ref_idea_id` を設定。**評価スコアの中身は通知本文に含めない**（`visibility` 尊重・「評価が付きました/選定されました」程度）。投稿者本人向けの専用通知種別は現状無し（XP/コインは `activities`・ダッシュボード〔I〕で確認）＝将来拡張。
- 下書き保存（`draft`）は通知を発火しない。

---

## F.7 AI 評価（独立した評価者・FR-50）

> アイデアに対し LLM が**独立した評価者**として5観点採点＋観点別コメント＋総評を付与する（正＝[アイデアLLM自動評価 設計](../設計ドラフト/アイデアLLM自動評価_設計.md)）。**AI 評価は `evaluations` に `evaluator_kind='ai'` で記録**し、F.1 集計・F.4 コインに人間評価と同列で算入（表示のみ別枠）。書き込みは**ジョブ経路のみ**（人間の `PUT` からは作れない）。基盤＝ドメイン S（`task_type=idea_evaluate`）。

### F.7.1 自動起動（共有時）
- アイデアが `published` に遷移した時（ドメイン D の公開 EP の post-commit）に `task_type=idea_evaluate`・`ref_idea_id`・**`Idempotency-Key=idea_id＋内容リビジョン`** で enqueue（§S.1・冪等＝再共有の重複起動を防ぐ）。
- 会社でモデル未有効/タスク無効なら**スキップ（graceful）**＝AI 評価は付かず人間評価のみで通常進行。
- **バックフィルはしない**＝既に `published` 済みの既存アイデアへの一括 AI 評価は行わない（新規公開のみ・2026-10-08 決定）。

### F.7.2 ジョブ結果の保存（システム経路）
- `idea_evaluate` ワーカーが構造化 JSON（`{scores:[{aspect,score,comment}], overall_comment}`・5観点必須）を検証し、`evaluations` へ `evaluator_kind='ai'`・`evaluator_id=NULL`・`ai_job_id`・`model`・`status='submitted'`・`visibility='party'` で **upsert**（部分ユニーク `UNIQUE(idea_id) WHERE evaluator_kind='ai'`＝最新1件）。`evaluation_scores` は人間と同一スキーマ。
- **上書き前の旧 AI 評価は版（§5.22b `evaluation_revisions`）へスナップ**（初回自動生成＝初版・`editor_id=NULL`／再生成時は実行者を `editor_id` に記録）。
- **評価者 XP+30 は付けない**（アカウント無し）。保存後、**F.4 コイン確定トリガ (a) を判定**（下記の整合点に注意）。
- **SC-04 所有（2026-10-08 決定）**＝自動起動（F.7.1）ジョブは **system 所有（`ai_jobs.created_by=NULL`）＝誰の個人 SC-04（`GET /ai-jobs` 自分スコープ）にも出さない**（投稿者〔被評価者〕・一般員の処理状況に出さない＝結果は SC-22 で閲覧可）。再生成（F.7.3）は実行者所有で**その評価者権限保持者の SC-04 に出る**。
- **失敗時（2026-10-08 決定）**＝ジョブ failed は AI 評価を付けず（人間評価のみで進行）、**通知で「評価者権限〔FR-27〕保持者＋owner/quest_admin」に知らせる**（F.5・手動再生成を促す）。自動起動は個人 SC-04 に出ないため失敗の可視化は通知が担う。

- **F.4 との整合（重要）**＝確定トリガ (a)「`evaluator` 権限保持者が全員 submitted」の**判定集合は人間の評価者のみ**（AI は権限保持者ではないので人数に数えない）。一方、**コイン金額は `visibility` 無視で全 submitted 評価（AI 含む）の均等平均×10**（F.4）。**AI 単独（人間の提出 0 件）**の場合は (a) では確定せず **(b) quest completed** で確定（AI の点だけで算定）。

### F.7.3 再生成（評価者権限保有者のみ）

| メソッド/パス | 概要 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `POST /ideas/{idea_id}/ai-evaluation/regenerate` | AI 評価を再生成（再 enqueue） | パス: `idea_id`／`Idempotency-Key`（任意） | 202＋`{job_id, status:'queued'}` |

- **権限＝`evaluator`（FR-27・当該クエストの評価者権限保持者）のみ**＝**owner/quest_admin でも評価者権限が無ければ 403**（2026-10-08 ユーザー決定・コスト制御）。
- ジョブ完了時に F.7.2 の保存が走り、**旧 AI 評価は版へスナップして上書き**（`editor_id`＝本 EP を呼んだ評価者）。
- **完了凍結**＝`quest_status=completed` で **409 `invalid_state`**（他の書き込みと同様・C.5）。会社モデル未有効/タスク無効は **422**（§S.2 ガードレール）。
- **冪等**＝連打は `Idempotency-Key`（§1.9）で単一ジョブ化。未指定時も実行中の `idea_evaluate` ジョブがあれば既存ジョブ id を返す（二重起動防止）。

### F.7.4 表示（SC-22 / SC-25）
- F.1 `GET /ideas/{id}/evaluation` は AI 評価を**別枠 `ai_evaluation`** で返す＝`{scores:{aspect:score}, comments:{aspect:comment}, overall_comment, model, generated_at, job_id, revisions?}`（人間の `evaluators[]` とは分離）。
- **数値集計（`aspects`/`overall_avg`／コイン）には AI を算入**（kind 非区別・F.1）。可視性＝`party` なので**作成者〔被評価者〕も全文閲覧可**。
- SC-25（人間の採点モーダル）でも AI ブロックは閲覧可（§5「気づきの好意的影響」）＝**採点中も常に表示**（折り畳みオプションは設けない・2026-10-08 決定）。
- **#13 相乗り**＝本パネル UI 改修に合わせ、作成者（被評価者）が**人間評価の詳細（観点別スコア＋コメント＋総評）**も F.0/F.1 の `visibility` 範囲内で閲覧できる #13 を同時対応（AI・人間の評価詳細を同じ右レールで一貫表示）。

### F.7.5 セキュリティ
- **書き込みはワーカーのシステム経路のみ**＝人間の `PUT /ideas/{id}/evaluation` は `evaluator_kind` を受け取らず常に `human`（Mass Assignment 防止・§2.2）。`kind='ai'` をクライアントから作れない。
- **プロンプトインジェクション**＝アイデア本文/情報/経営資料は system 指示と分離してデータ扱いで引用展開・出力は JSON Schema で検証（スコア 1..5・観点キーは `evaluation_aspect` ホワイトリスト）。詳細＝設計 §3/§8・コーディング規約 §2。

---

## F.6 他ドメイン境界・残 TBD

- **委譲**: XP/コイン/SP の台帳・残高・算定式の canonical＝**ドメイン G**（`activities`・§7）／通知配信・テンプレ・多言語・一覧＝**H**／`completed` 遷移で (b) 確定フックを呼ぶ主体＝**ドメイン C**（`POST /quests/{id}/transition`。フック内容の正は §7・F.4）／**`published` 遷移で AI 評価の自動 enqueue（F.7.1）を呼ぶ主体＝ドメイン D**（アイデア公開 EP の post-commit）・AI ジョブ基盤＝**ドメイン S**（`task_type=idea_evaluate`）。
- **ダッシュボード向けの横断 read（ドメイン I 連携・別 EP は新設しない）**: SC-01 の「全アイデア横断の自分の**下書き評価**一覧」（`evaluator_id=自分 AND status=draft`・採点進捗 `scored/5` 付き）は、本ドメインの repository に read として持ち、**I が `GET /dashboard` 内で合成**する（`I_ダッシュボード集約.md` I.3）。単体画面を持たないため個別 REST は公開しない。
- **確定済み（本レビュー）**: 選定 F 保有・複数可・XP 取消なし／限定公開は完全非表示／コイン確定トリガ (a)(b)・冪等・`reason=evaluation_coin` 新設。
- **残 TBD（軽微・実装で整理）**: 観点別コメントの必須/任意（**現状=任意**）・本文/コメントの文字数上限（実装）・スターの半点（**現状=整数 1..5**）・評価の取り下げ（**draft は上書き破棄で実質可・`submitted` の物理削除は MVP 非対応**＝確定後は編集のみ）・評価可能フェーズの厳格化（現状は「`completed` 以外＋公開済みアイデア」。`evaluating` 限定に絞るかは C.7/実装で検討）。
