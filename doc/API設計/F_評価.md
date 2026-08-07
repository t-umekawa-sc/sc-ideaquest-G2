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

- **クエスト完了（`quest_status=completed`）で書き込み凍結**（**全体像の単一正＝C.5**・本ドメインは自 EP を再掲）: `PUT /ideas/{id}/evaluation`（下書き/確定）・`POST/DELETE /ideas/{id}/select` は **409 `conflict`（`invalid_state`）**でサーバー拒否＝読み取り専用。※投稿者コインの一括確定は `completed` 遷移の**副作用として実行**されるもので、凍結対象の「書き込み操作」ではない（F.4）。
- 認可失敗＝**403 `forbidden`**／範囲外（非パーティー・他グループ・他テナント・下書き）は**404 `not_found`**／未認証は**401 `unauthenticated`**。
- **`my_permissions`（評価可否・選定可否）はサーバーが算出して返す**（フロントは権限判定を再実装しない・コーディング規約 §1）。UX 便宜であり、実アクションは各 EP で再検証。

---

## F.1 評価の取得（自分の評価・集計結果）

| メソッド/パス | 概要 | リクエスト（パス） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /ideas/{idea_id}/evaluation/me` | 自分の評価/下書きを取得（SC-25 の読み込み） | パス: `idea_id` | 自分の評価（`status`・`scores`〔`{aspect:score}`〕・`comments`〔`{aspect:comment}`〕・`overall_comment`・`visibility`・`submitted_at`）。未作成なら `null`/空 |
| `GET /ideas/{idea_id}/evaluation` | 評価結果の集計を取得（SC-22 §4.6 右レール） | パス: `idea_id` | `aspects`〔観点別平均 `{aspect: avg}`〕・`overall_avg`・`evaluator_count`〔提出済み評価者数〕・`evaluators[]`〔各評価者の氏名/観点別スコア/観点別コメント/総評〕・`coin`〔`{projected, finalized?, finalized_at?}`〕・`my_evaluation`（`me` の要約） |

- **`visibility` の適用（表示制御）**: 各評価（`evaluations.visibility`）ごとに閲覧範囲を判定する。
  - `party` の評価＝パーティー全員に表示。
  - `limited` の評価＝**投稿者＋その評価者＋`owner`/`quest_admin` のみ**に表示。**範囲外には完全非表示**（当該評価のスコア/コメント/総評を一切返さず、集計平均の分母にも含めない＝存在も出さない）。
  - したがって **`GET /ideas/{id}/evaluation` の集計（`aspects`/`overall_avg`/`evaluators[]`/`evaluator_count`）は「閲覧者に可視な評価のみ」で算出**する（サーバーが閲覧者ごとに絞る）。可視な評価が 0 件なら「評価待ち/非公開」を表す空集計を返す。
- **コインの平均は集計表示とは別系統**: 投稿者コインの算定は **`visibility` を無視して全 `submitted` 評価**で行う（`visibility` は表示制御のみ・データモデル §5.18 と同じく評価も「装飾ではなく実データだが公開範囲だけ制御」）。`coin.projected`＝現時点の全 `submitted` 評価からの見込み額、`coin.finalized`＝確定済みなら確定額（F.4）。
- **コスト観点**: `cost` は「低コストほど高得点（★5＝非常に低コスト）」（データモデル §5.22・SC-25 §4.1）。スコアの符号反転はしない（入力値をそのまま平均）。

---

## F.2 評価の登録・更新（下書き / 確定）

| メソッド/パス | 概要 | リクエスト（パス/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `PUT /ideas/{idea_id}/evaluation` | 自分の評価を登録/更新（upsert・`UNIQUE(idea_id, evaluator_id)`） | パス: `idea_id`／ボディ: `{scores:{aspect:1..5}, comments?:{aspect:string}, overall_comment?, visibility:'party'\|'limited', status:'draft'\|'submitted'}` | 200/201＋保存後の自分の評価（F.1 `me` 形）。`status=submitted` で評価者 XP+30・確定トリガ判定（F.4） |

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
| `POST /ideas/{idea_id}/select` | アイデアを選定（`is_selected=true`） | パス: `idea_id` | 200（`{id, is_selected:true}`）。投稿者へ XP+200・`follow_selection` 通知（H） |
| `DELETE /ideas/{idea_id}/select` | 選定を解除（`is_selected=false`） | パス: `idea_id` | 200（`{id, is_selected:false}`）。**XP は剥奪しない** |

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

書込側（F の application）が通知レコード生成をトリガ（配信/テンプレ/多言語/一覧は**ドメイン H**）:

| 契機 | 通知種別（`notification_type`・§3） | 宛先 |
| --- | --- | --- |
| 評価の確定（`submitted`） | `follow_evaluation` | 当該アイデアのフォロワー（`follows`・評価者自身は除外） |
| アイデア選定（`POST /select`） | `follow_selection` | 当該アイデアのフォロワー |

- 通知レコードは `notifications`（§5.24）に `ref_idea_id` を設定。**評価スコアの中身は通知本文に含めない**（`visibility` 尊重・「評価が付きました/選定されました」程度）。投稿者本人向けの専用通知種別は現状無し（XP/コインは `activities`・ダッシュボード〔I〕で確認）＝将来拡張。
- 下書き保存（`draft`）は通知を発火しない。

---

## F.6 他ドメイン境界・残 TBD

- **委譲**: XP/コイン/SP の台帳・残高・算定式の canonical＝**ドメイン G**（`activities`・§7）／通知配信・テンプレ・多言語・一覧＝**H**／`completed` 遷移で (b) 確定フックを呼ぶ主体＝**ドメイン C**（`POST /quests/{id}/transition`。フック内容の正は §7・F.4）。
- **ダッシュボード向けの横断 read（ドメイン I 連携・別 EP は新設しない）**: SC-01 の「全アイデア横断の自分の**下書き評価**一覧」（`evaluator_id=自分 AND status=draft`・採点進捗 `scored/5` 付き）は、本ドメインの repository に read として持ち、**I が `GET /dashboard` 内で合成**する（`I_ダッシュボード集約.md` I.3）。単体画面を持たないため個別 REST は公開しない。
- **確定済み（本レビュー）**: 選定 F 保有・複数可・XP 取消なし／限定公開は完全非表示／コイン確定トリガ (a)(b)・冪等・`reason=evaluation_coin` 新設。
- **残 TBD（軽微・実装で整理）**: 観点別コメントの必須/任意（**現状=任意**）・本文/コメントの文字数上限（実装）・スターの半点（**現状=整数 1..5**）・評価の取り下げ（**draft は上書き破棄で実質可・`submitted` の物理削除は MVP 非対応**＝確定後は編集のみ）・評価可能フェーズの厳格化（現状は「`completed` 以外＋公開済みアイデア」。`evaluating` 限定に絞るかは C.7/実装で検討）。
